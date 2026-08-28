#!/usr/bin/env bash
# =============================================================================
# teardown.sh — Teardown a Backstage-generated application and all its resources
#
# Intelligent discovery: queries the cluster and catalog — never assumes
# environment names, ArgoCD namespace, or GitHub org.
#
# Usage:
#   bash scripts/teardown.sh <app-name> [OPTIONS]
#
# Options:
#   --execute          Actually delete resources (default: dry-run)
#   --keep-repo        Skip GitHub repository deletion
#   --keep-backups     Skip S3 / CNPG backup deletion
#   --backstage-url    Backstage base URL (default: http://localhost:7007)
#   --token TOKEN      Backstage token — enables catalog lookup + unregistration
#   --aws-profile      AWS CLI profile for tofu destroy (default: default)
#   --aws-region       AWS region (default: us-west-2)
#   --skip-aws         Skip AWS infrastructure destruction
#
# Env vars:
#   TEARDOWN_GITHUB_ORGS   Comma-separated GitHub orgs to search as a fallback when a repo slug cannot be resolved from the catalog
#
# Examples:
#   bash scripts/teardown.sh demo-for-syl
#   bash scripts/teardown.sh demo-for-syl --execute --token <token>
#   bash scripts/teardown.sh demo-for-syl --execute --keep-repo
#   bash scripts/teardown.sh shared-rds-infra --execute --token <token>   # AWS-only teardown
#   bash scripts/teardown.sh my-app --execute --skip-aws --token <token>  # k8s-only teardown
#
# Dependencies: kubectl, gh (GitHub CLI), curl, jq
# =============================================================================

set -euo pipefail

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'
CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; RESET='\033[0m'

log()    { echo -e "${CYAN}[teardown]${RESET} $*"; }
step()   { echo -e "${CYAN}[teardown]${RESET} ${BOLD}Step $1:${RESET} $2"; }
ok()     { echo -e "${GREEN}  ✓${RESET} $*"; }
warn()   { echo -e "${YELLOW}  ⚠${RESET}  $*"; }
found()  { echo -e "${GREEN}  ✓${RESET} $*"; }
skip()   { echo -e "${DIM}  –${RESET} $*${DIM} (not found)${RESET}"; }
err()    { echo -e "${RED}  ✗${RESET} $*" >&2; }
die()    { err "$*"; exit 1; }
progress() { echo -e "  ${DIM}  ↳ $*${RESET}"; }

check_deps() {
  local missing=()
  for cmd in kubectl gh curl jq; do
    command -v "$cmd" &>/dev/null || missing+=("$cmd")
  done
  [[ ${#missing[@]} -eq 0 ]] || die "Missing required tools: ${missing[*]}"
}

# ── Arguments ─────────────────────────────────────────────────────────────────
APP_NAME="${1:-}"
[[ -n "$APP_NAME" ]] || die "Usage: bash scripts/teardown.sh <app-name> [OPTIONS]"
shift

EXECUTE=false
KEEP_REPO=false
KEEP_BACKUPS=false
BACKSTAGE_URL="http://localhost:7007"
BACKSTAGE_TOKEN=""
AWS_PROFILE="${AWS_PROFILE:-default}"
AWS_REGION="${AWS_REGION:-us-west-2}"
SKIP_AWS=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --execute)       EXECUTE=true ;;
    --keep-repo)     KEEP_REPO=true ;;
    --keep-backups)  KEEP_BACKUPS=true ;;
    --backstage-url) BACKSTAGE_URL="$2"; shift ;;
    --token)         BACKSTAGE_TOKEN="$2"; shift ;;
    --aws-profile)   AWS_PROFILE="$2"; shift ;;
    --aws-region)    AWS_REGION="$2"; shift ;;
    --skip-aws)      SKIP_AWS=true ;;
    *) die "Unknown option: $1" ;;
  esac
  shift
done

# ── Banner ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║         Backstage Application Teardown Script        ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════╝${RESET}"
echo ""
echo -e "  App:   ${BOLD}${APP_NAME}${RESET}"
echo -e "  Mode:  $(
  if $EXECUTE; then echo -e "${RED}${BOLD}EXECUTE — resources will be permanently deleted${RESET}"
  else echo -e "${YELLOW}${BOLD}DRY-RUN — no changes will be made${RESET}"; fi
)"
echo ""

# ── Safety confirmation (execute mode only) ───────────────────────────────────
if $EXECUTE; then
  echo -e "${RED}${BOLD}⚠  WARNING: This action is IRREVERSIBLE.${RESET}"
  echo ""
  read -rp "$(echo -e "${BOLD}  Type the application name to confirm: ${RESET}")" CONFIRMATION
  [[ "$CONFIRMATION" == "$APP_NAME" ]] || die "Confirmation mismatch — aborting. Nothing was deleted."
  echo ""
fi

check_deps

# =============================================================================
# PHASE 1: DISCOVER — query the actual cluster, never assume
# =============================================================================
log "Phase 1: Discovering resources for '${APP_NAME}'..."
echo ""

# ── 1a. All namespaces matching <app-name>-* ──────────────────────────────────
log "Scanning namespaces..."
mapfile -t FOUND_NAMESPACES < <(
  kubectl get namespaces -o jsonpath='{.items[*].metadata.name}' 2>/dev/null \
    | tr ' ' '\n' \
    | grep -E "^${APP_NAME}-" \
    || true
)

if [[ ${#FOUND_NAMESPACES[@]} -gt 0 ]]; then
  for ns in "${FOUND_NAMESPACES[@]}"; do
    found "Namespace: ${ns}"
  done
else
  skip "No namespaces matching ${APP_NAME}-*"
fi

# ── 1b. CNPG clusters and PVCs inside discovered namespaces ───────────────────
FOUND_CNPG_CLUSTERS=()      # "ns/name"
CNPG_BACKUP_PATHS=()        # "ns/name|s3://bucket/prefix|endpointURL|access_key_value|secret_key_value"
FOUND_PVC_COUNTS=()

for ns in "${FOUND_NAMESPACES[@]+"${FOUND_NAMESPACES[@]}"}"; do
  # CNPG clusters
  mapfile -t clusters < <(
    kubectl get cluster -n "${ns}" -o jsonpath='{.items[*].metadata.name}' 2>/dev/null \
      | tr ' ' '\n' | grep . || true
  )
  for c in "${clusters[@]+"${clusters[@]}"}"; do
    FOUND_CNPG_CLUSTERS+=("${ns}/${c}")
    warn "CNPG cluster with data: ${ns}/${c}"

    # Extract backup config NOW — namespace will be deleted before Phase 4
    dest=$(kubectl get cluster "${c}" -n "${ns}" \
      -o jsonpath='{.spec.backup.barmanObjectStore.destinationPath}' 2>/dev/null || true)
    endpoint=$(kubectl get cluster "${c}" -n "${ns}" \
      -o jsonpath='{.spec.backup.barmanObjectStore.endpointURL}' 2>/dev/null || true)

    if [[ -n "$dest" ]]; then
      # Read actual key names from the cluster spec (may differ: SECRET_ACCESS_KEY vs ACCESS_SECRET_KEY)
      secret_name=$(kubectl get cluster "${c}" -n "${ns}" \
        -o jsonpath='{.spec.backup.barmanObjectStore.s3Credentials.accessKeyId.name}' 2>/dev/null || true)
      access_key_field=$(kubectl get cluster "${c}" -n "${ns}" \
        -o jsonpath='{.spec.backup.barmanObjectStore.s3Credentials.accessKeyId.key}' 2>/dev/null || true)
      secret_key_field=$(kubectl get cluster "${c}" -n "${ns}" \
        -o jsonpath='{.spec.backup.barmanObjectStore.s3Credentials.secretAccessKey.key}' 2>/dev/null || true)

      # Resolve actual values from the secret while the namespace still exists
      access_key_val=""
      secret_key_val=""
      if [[ -n "$secret_name" && -n "$access_key_field" ]]; then
        # Try the cluster's own namespace first, fall back to default
        access_key_val=$(kubectl get secret "${secret_name}" -n "${ns}" \
          -o jsonpath="{.data.${access_key_field}}" 2>/dev/null | base64 -d 2>/dev/null \
          || kubectl get secret "${secret_name}" -n default \
          -o jsonpath="{.data.${access_key_field}}" 2>/dev/null | base64 -d 2>/dev/null \
          || true)
        secret_key_val=$(kubectl get secret "${secret_name}" -n "${ns}" \
          -o jsonpath="{.data.${secret_key_field}}" 2>/dev/null | base64 -d 2>/dev/null \
          || kubectl get secret "${secret_name}" -n default \
          -o jsonpath="{.data.${secret_key_field}}" 2>/dev/null | base64 -d 2>/dev/null \
          || true)
      fi

      CNPG_BACKUP_PATHS+=("${ns}/${c}|${dest}|${endpoint}|${access_key_val}|${secret_key_val}")
      warn "  Backup path: ${dest} (endpoint: ${endpoint:-aws})"
    fi
  done

  # PVC count
  pvc_count=$(kubectl get pvc -n "${ns}" --no-headers 2>/dev/null | wc -l | tr -d ' ')
  if [[ "$pvc_count" -gt 0 ]]; then
    FOUND_PVC_COUNTS+=("${ns}:${pvc_count}")
    warn "PVCs in ${ns}: ${pvc_count} (may need finalizer patch)"
  fi
done

# ── 1c. All ArgoCD Applications matching <app-name>-* across ALL namespaces ───
log "Scanning ArgoCD applications across all namespaces..."
mapfile -t FOUND_ARGOCD_APPS < <(
  kubectl get application --all-namespaces --no-headers 2>/dev/null \
    | awk -v app="${APP_NAME}" '$2 ~ "^" app "($|-)" { print $1 "/" $2 }' \
    || true
)

if [[ ${#FOUND_ARGOCD_APPS[@]} -gt 0 ]]; then
  for app in "${FOUND_ARGOCD_APPS[@]}"; do
    # Warn if it has the resources-finalizer (cascade deletion)
    ns="${app%%/*}"; name="${app##*/}"
    finalizer=$(kubectl get application "${name}" -n "${ns}" \
      -o jsonpath='{.metadata.finalizers[0]}' 2>/dev/null || true)
    if [[ "$finalizer" == *"resources-finalizer"* ]]; then
      found "ArgoCD app: ${app}  ${DIM}(has resources-finalizer — will cascade-delete)${RESET}"
    else
      found "ArgoCD app: ${app}"
    fi
  done
else
  skip "No ArgoCD applications matching ${APP_NAME}-*"
fi

# ── 1d. GitHub repository — discover from catalog annotation or search GitHub ─
log "Looking up GitHub repository..."
GITHUB_REPO_SLUG=""   # format: owner/repo
GITHUB_REPO_EXISTS=false

# Try catalog first (most reliable — uses the annotation the template wrote)
if [[ -n "$BACKSTAGE_TOKEN" ]]; then
  for kind in component system; do
    slug=$(curl -s \
      -H "Authorization: Bearer ${BACKSTAGE_TOKEN}" \
      "${BACKSTAGE_URL}/api/catalog/entities/by-name/${kind}/default/${APP_NAME}" 2>/dev/null \
      | jq -r '.metadata.annotations["github.com/project-slug"] // empty' 2>/dev/null || true)
    if [[ -n "$slug" ]]; then
      GITHUB_REPO_SLUG="$slug"
      break
    fi
  done
fi

# Fallback: try GitHub search across known orgs
if [[ -z "$GITHUB_REPO_SLUG" ]]; then
  for org in ${TEARDOWN_GITHUB_ORGS:-}; do
    if gh repo view "${org}/${APP_NAME}" &>/dev/null 2>&1; then
      GITHUB_REPO_SLUG="${org}/${APP_NAME}"
      break
    fi
  done
fi

if [[ -n "$GITHUB_REPO_SLUG" ]]; then
  # Verify it actually exists right now
  if gh repo view "${GITHUB_REPO_SLUG}" &>/dev/null 2>&1; then
    GITHUB_REPO_EXISTS=true
    found "GitHub repo: ${GITHUB_REPO_SLUG}"
  else
    skip "GitHub repo ${GITHUB_REPO_SLUG} (from catalog annotation — no longer exists)"
  fi
else
  skip "GitHub repo (not found in catalog or known orgs)"
fi

# ── 1e. Backstage catalog entities ────────────────────────────────────────────
# Query by source location (GitHub repo slug annotation) — catches ALL entities
# that belong to this app regardless of their name (e.g. demo-for-syl-db, -api, etc.)
log "Looking up Backstage catalog entities..."
CATALOG_ENTITIES=()   # array of "kind/namespace/name/uid"

if [[ -n "$BACKSTAGE_TOKEN" ]]; then
  SEEN_ENTITY_UIDS=()

  add_catalog_entity() {
    local entry="$1"
    local uid="${entry##*/}"
    # Skip entities with null UID — incomplete ingestion; no valid entity to delete
    [[ "$uid" == "null" || -z "$uid" ]] && return
    # Deduplicate by UID
    for seen in "${SEEN_ENTITY_UIDS[@]+"${SEEN_ENTITY_UIDS[@]}"}"; do
      [[ "$seen" == "$uid" ]] && return
    done
    SEEN_ENTITY_UIDS+=("$uid")
    CATALOG_ENTITIES+=("$entry")
    local kind="${entry%%/*}"; local rest="${entry#*/}"; local ns="${rest%%/*}"; rest="${rest#*/}"; local name="${rest%%/*}"
    found "Catalog entity: ${kind}:${ns}/${name}"
  }

  if [[ -n "$GITHUB_REPO_SLUG" ]]; then
    # Pass 1: filter by github.com/project-slug — typically finds Component entities
    mapfile -t entity_refs < <(
      curl -s \
        -H "Authorization: Bearer ${BACKSTAGE_TOKEN}" \
        "${BACKSTAGE_URL}/api/catalog/entities?filter=metadata.annotations.github.com%2Fproject-slug=${GITHUB_REPO_SLUG}" \
        2>/dev/null \
        | jq -r '.[] | "\(.kind)/\(.metadata.namespace)/\(.metadata.name)/\(.metadata.uid)"' \
        2>/dev/null || true
    )
    for entry in "${entity_refs[@]+"${entity_refs[@]}"}"; do
      add_catalog_entity "$entry"
    done

    # Pass 2: use backstage.io/managed-by-origin-location from any found entity
    # to discover ALL co-located entities (system, resource, api) that share the
    # same catalog-info.yaml source but don't carry the project-slug annotation.
    ORIGIN_LOCATION=""
    if [[ ${#CATALOG_ENTITIES[@]} -gt 0 ]]; then
      first_kind="${CATALOG_ENTITIES[0]%%/*}"
      first_rest="${CATALOG_ENTITIES[0]#*/}"; first_ns="${first_rest%%/*}"; first_rest="${first_rest#*/}"; first_name="${first_rest%%/*}"
      ORIGIN_LOCATION=$(curl -s \
        -H "Authorization: Bearer ${BACKSTAGE_TOKEN}" \
        "${BACKSTAGE_URL}/api/catalog/entities/by-name/${first_kind}/${first_ns}/${first_name}" 2>/dev/null \
        | jq -r '.metadata.annotations["backstage.io/managed-by-origin-location"] // empty' 2>/dev/null || true)
    fi

    if [[ -n "$ORIGIN_LOCATION" ]]; then
      # URL-encode the origin location value for the filter query
      ORIGIN_ENCODED=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$ORIGIN_LOCATION" 2>/dev/null \
        || printf '%s' "$ORIGIN_LOCATION" | jq -sRr @uri 2>/dev/null \
        || true)
      if [[ -n "$ORIGIN_ENCODED" ]]; then
        mapfile -t origin_refs < <(
          curl -s \
            -H "Authorization: Bearer ${BACKSTAGE_TOKEN}" \
            "${BACKSTAGE_URL}/api/catalog/entities?filter=metadata.annotations.backstage.io%2Fmanaged-by-origin-location=${ORIGIN_ENCODED}" \
            2>/dev/null \
            | jq -r '.[] | "\(.kind)/\(.metadata.namespace)/\(.metadata.name)/\(.metadata.uid)"' \
            2>/dev/null || true
        )
        for entry in "${origin_refs[@]+"${origin_refs[@]}"}"; do
          add_catalog_entity "$entry"
        done
      fi
    fi
  fi

  # Fallback: name-exact lookup if nothing found via annotations
  if [[ ${#CATALOG_ENTITIES[@]} -eq 0 ]]; then
    for kind in component system api resource; do
      result=$(curl -s \
        -H "Authorization: Bearer ${BACKSTAGE_TOKEN}" \
        "${BACKSTAGE_URL}/api/catalog/entities/by-name/${kind}/default/${APP_NAME}" 2>/dev/null || true)
      uid=$(echo "$result" | jq -r '.metadata.uid // empty' 2>/dev/null || true)
      if [[ -n "$uid" ]]; then
        add_catalog_entity "${kind}/default/${APP_NAME}/${uid}"
      fi
    done
  fi

  [[ ${#CATALOG_ENTITIES[@]} -gt 0 ]] || skip "No catalog entities found for ${APP_NAME}"
else
  warn "No --token provided — catalog entities will not be discovered or unregistered"
fi

# ── 1f. AWS infra repos (tofu-managed resources) ──────────────────────────────
# Strategy 1: from catalog — Resource entities with AWS spec.type carry the repo slug
# Strategy 2: fallback — GitHub search for backstage-infra topic repos matching app name
FOUND_AWS_INFRA_REPOS=()  # entries: "owner/repo|resource-type"

if ! $SKIP_AWS; then
  log "Scanning for AWS infrastructure repos..."

  # AWS spec.types created by infra templates
  AWS_RESOURCE_TYPES=("rds-instance" "ecs-cluster" "eks-cluster" "aws-ec2-instance")

  if [[ -n "$BACKSTAGE_TOKEN" ]]; then
    # Build a deduplicated list of Resource entity names to query:
    # - from already-discovered CATALOG_ENTITIES (if any)
    # - plus a direct catalog filter by app name (catches Resource entities whose
    #   infra repo name doesn't contain the app name — e.g. infra-for-deletion vs project-for-deletion)
    declare -A _AWS_RESOURCE_SEEN=()

    _check_aws_resource_entity() {
      local ns="$1" name="$2"
      local key="${ns}/${name}"
      [[ -n "${_AWS_RESOURCE_SEEN[$key]:-}" ]] && return
      _AWS_RESOURCE_SEEN[$key]=1

      local entity_json
      entity_json=$(curl -s \
        -H "Authorization: Bearer ${BACKSTAGE_TOKEN}" \
        "${BACKSTAGE_URL}/api/catalog/entities/by-name/resource/${ns}/${name}" 2>/dev/null || true)

      local spec_type
      spec_type=$(echo "$entity_json" | jq -r '.spec.type // empty' 2>/dev/null || true)
      local is_aws=false
      for t in "${AWS_RESOURCE_TYPES[@]}"; do
        [[ "$spec_type" == "$t" ]] && is_aws=true && break
      done
      $is_aws || return

      local repo_slug
      repo_slug=$(echo "$entity_json" | jq -r \
        '.metadata.annotations["github.com/project-slug"] // empty' 2>/dev/null || true)
      [[ -z "$repo_slug" ]] && return

      local already=false
      for existing in "${FOUND_AWS_INFRA_REPOS[@]+"${FOUND_AWS_INFRA_REPOS[@]}"}"; do
        [[ "${existing%%|*}" == "$repo_slug" ]] && already=true && break
      done
      $already && return

      FOUND_AWS_INFRA_REPOS+=("${repo_slug}|${spec_type}")
      found "AWS infra repo: ${repo_slug}  ${DIM}(${spec_type})${RESET}"

      # Also register this Resource entity in CATALOG_ENTITIES so Step 6 unregisters it
      local uid
      uid=$(echo "$entity_json" | jq -r '.metadata.uid // empty' 2>/dev/null || true)
      [[ -n "$uid" ]] && add_catalog_entity "Resource/${ns}/${name}/${uid}"
    }

    # Pass 1: from already-discovered catalog entities
    for entry in "${CATALOG_ENTITIES[@]+"${CATALOG_ENTITIES[@]}"}"; do
      kind="${entry%%/*}"
      [[ "${kind,,}" != "resource" ]] && continue
      rest="${entry#*/}"; ns="${rest%%/*}"; rest="${rest#*/}"; name="${rest%%/*}"
      _check_aws_resource_entity "$ns" "$name"
    done

    # Pass 2: direct catalog query for Resource entities whose name contains the app name
    # (catches cases where the Resource entity was not picked up by the earlier entity scan,
    # e.g. the infra repo has a different name and no github.com/project-slug on the Component)
    mapfile -t _direct_resources < <(
      curl -s \
        -H "Authorization: Bearer ${BACKSTAGE_TOKEN}" \
        "${BACKSTAGE_URL}/api/catalog/entities?filter=kind=Resource&limit=500" \
        2>/dev/null \
        | jq -r --arg app "${APP_NAME}" \
          '.[] | select(.metadata.name | test($app)) | "\(.metadata.namespace)/\(.metadata.name)"' \
        2>/dev/null || true
    )
    for ref in "${_direct_resources[@]+"${_direct_resources[@]}"}"; do
      _ns="${ref%%/*}"; _name="${ref##*/}"
      _check_aws_resource_entity "$_ns" "$_name"
    done

    unset _AWS_RESOURCE_SEEN
  fi

  # Fallback: GitHub topic search if catalog yielded nothing
  if [[ ${#FOUND_AWS_INFRA_REPOS[@]} -eq 0 ]]; then
    for org in ${TEARDOWN_GITHUB_ORGS:-}; do
      while IFS= read -r repo_name; do
        [[ -z "$repo_name" ]] && continue
        # Must contain the app name somewhere in the repo name
        [[ "$repo_name" == *"${APP_NAME}"* ]] || continue

        topics=$(gh repo view "${org}/${repo_name}" \
          --json repositoryTopics --jq '[.repositoryTopics[].name] | join(",")' 2>/dev/null || true)
        resource_type="aws-infra"
        [[ "$topics" == *"aws-rds"* ]]         && resource_type="rds-instance"
        [[ "$topics" == *"aws-ecs-cluster"* ]] && resource_type="ecs-cluster"
        [[ "$topics" == *"aws-eks-cluster"* ]] && resource_type="eks-cluster"
        [[ "$topics" == *"aws-ec2"* ]]         && resource_type="aws-ec2-instance"

        FOUND_AWS_INFRA_REPOS+=("${org}/${repo_name}|${resource_type}")
        found "AWS infra repo (GitHub): ${org}/${repo_name}  ${DIM}(${resource_type})${RESET}"
      done < <(gh repo list "$org" --topic backstage-infra \
        --json name --jq '.[].name' 2>/dev/null || true)
    done
  fi

  [[ ${#FOUND_AWS_INFRA_REPOS[@]} -gt 0 ]] || skip "No AWS infra repos found for ${APP_NAME}"
fi

echo ""

# =============================================================================
# PHASE 2: SUMMARY
# =============================================================================
log "Phase 2: Deletion summary"
echo ""

TOTAL_FOUND=0

if $EXECUTE; then
  echo -e "  ${RED}The following resources WILL BE PERMANENTLY DELETED:${RESET}"
else
  echo -e "  ${YELLOW}The following resources WOULD BE deleted (dry-run):${RESET}"
fi
echo ""

for app in "${FOUND_ARGOCD_APPS[@]+"${FOUND_ARGOCD_APPS[@]}"}"; do
  printf '  • ArgoCD app:       %s\n' "${app}"; (( TOTAL_FOUND++ )) || true
done
for c in "${FOUND_CNPG_CLUSTERS[@]+"${FOUND_CNPG_CLUSTERS[@]}"}"; do
  printf '  • CNPG cluster:     %s  ⚠  DATA LOSS\n' "${c}"; (( TOTAL_FOUND++ )) || true
done
for ns in "${FOUND_NAMESPACES[@]+"${FOUND_NAMESPACES[@]}"}"; do
  printf '  • K8s namespace:    %s\n' "${ns}"; (( TOTAL_FOUND++ )) || true
done
if $GITHUB_REPO_EXISTS; then
  if $KEEP_REPO; then
    printf '  • GitHub repo:      %s  (KEPT — --keep-repo)\n' "${GITHUB_REPO_SLUG}"
  else
    printf '  • GitHub repo:      %s\n' "${GITHUB_REPO_SLUG}"; (( TOTAL_FOUND++ )) || true
  fi
fi
for entry in "${FOUND_AWS_INFRA_REPOS[@]+"${FOUND_AWS_INFRA_REPOS[@]}"}"; do
  repo_slug="${entry%%|*}"; rtype="${entry##*|}"
  printf '  • AWS infra (tofu): %s  ⚠  AWS RESOURCES DESTROYED\n' "${repo_slug} (${rtype})"
  (( TOTAL_FOUND++ )) || true
done
for entry in "${CATALOG_ENTITIES[@]+"${CATALOG_ENTITIES[@]}"}"; do
  ref="${entry%/*}"   # strip uid
  printf '  • Catalog entity:   %s\n' "${ref}"; (( TOTAL_FOUND++ )) || true
done

echo ""

if [[ $TOTAL_FOUND -eq 0 ]]; then
  warn "No resources found for '${APP_NAME}' — nothing to delete."
  echo ""
  exit 0
fi

if ! $EXECUTE; then
  echo -e "  ${YELLOW}Run with --execute to actually delete these resources.${RESET}"
  echo ""
  exit 0
fi

# Extra confirmation when database exists
if [[ ${#FOUND_CNPG_CLUSTERS[@]} -gt 0 ]]; then
  echo -e "${RED}${BOLD}  ⚠  DATABASE DATA LOSS${RESET}"
  echo -e "${RED}  PostgreSQL data will be permanently destroyed. There is NO UNDO.${RESET}"
  echo ""
  read -rp "$(echo -e "${BOLD}  Type 'delete my data' to confirm: ${RESET}")" DATA_CONFIRM
  [[ "$DATA_CONFIRM" == "delete my data" ]] || die "Data loss not confirmed — aborting."
  echo ""
fi

# =============================================================================
# PHASE 3: EXECUTE — delete in dependency order
# =============================================================================
log "Phase 3: Deleting resources..."
echo ""

EXIT_CODE=0

# ── Step 1/6: Suspend ArgoCD auto-sync on all apps ───────────────────────────
step "1/6" "Suspending ArgoCD auto-sync (prevents re-creation during teardown)..."
for full_ref in "${FOUND_ARGOCD_APPS[@]+"${FOUND_ARGOCD_APPS[@]}"}"; do
  ns="${full_ref%%/*}"; name="${full_ref##*/}"
  progress "Suspending ${full_ref}..."
  kubectl patch application "${name}" -n "${ns}" \
    --type='merge' -p '{"spec":{"syncPolicy":{"automated":null}}}' &>/dev/null 2>&1 \
    && ok "Auto-sync suspended: ${full_ref}" \
    || warn "Could not suspend: ${full_ref}"
done

# ── Step 2/6: Delete ArgoCD Applications ─────────────────────────────────────
# Delete in-namespace apps first (they have resources-finalizer — must complete
# before namespace deletion, or the finalizer will deadlock namespace termination)
step "2/6" "Deleting ArgoCD applications (cascade-deletes all synced k8s resources)..."
IN_NS_APPS=(); CENTRAL_APPS=()
for full_ref in "${FOUND_ARGOCD_APPS[@]+"${FOUND_ARGOCD_APPS[@]}"}"; do
  ns="${full_ref%%/*}"; name="${full_ref##*/}"
  if kubectl get namespace "${ns}" &>/dev/null 2>&1 \
     && [[ " ${FOUND_NAMESPACES[*]+"${FOUND_NAMESPACES[*]}"} " == *" ${ns} "* ]]; then
    IN_NS_APPS+=("${full_ref}")
  else
    CENTRAL_APPS+=("${full_ref}")
  fi
done

for full_ref in "${IN_NS_APPS[@]+"${IN_NS_APPS[@]}"}" "${CENTRAL_APPS[@]+"${CENTRAL_APPS[@]}"}"; do
  ns="${full_ref%%/*}"; name="${full_ref##*/}"
  progress "Deleting ${full_ref} (waiting for ArgoCD finalizer to cascade)..."
  if kubectl delete application "${name}" -n "${ns}" --timeout=120s 2>/dev/null; then
    ok "Deleted: ${full_ref}"
  else
    warn "Not found or already deleted: ${full_ref}"
  fi
done

if [[ ${#FOUND_ARGOCD_APPS[@]} -gt 0 ]]; then
  progress "Waiting 10s for ArgoCD cascade to settle..."
  sleep 10
fi

# ── Step 3/6: Delete Kubernetes Namespaces ───────────────────────────────────
step "3/6" "Deleting Kubernetes namespaces (cascades pods, services, CNPG, PVCs)..."
for ns in "${FOUND_NAMESPACES[@]+"${FOUND_NAMESPACES[@]}"}"; do
  progress "Issuing delete for namespace ${ns}..."
  kubectl delete namespace "${ns}" --timeout=120s 2>/dev/null || true

  progress "Waiting for namespace ${ns} to fully terminate..."
  WAIT=0
  while kubectl get namespace "${ns}" &>/dev/null 2>&1; do
    if [[ $WAIT -ge 60 ]]; then
      warn "Still terminating after 60s — patching stuck finalizers in ${ns}..."
      # Patch PVCs
      while IFS= read -r pvc; do
        [[ -z "$pvc" ]] && continue
        progress "Patching PVC finalizer: ${pvc}"
        kubectl patch "${pvc}" -n "${ns}" -p '{"metadata":{"finalizers":[]}}' --type=merge 2>/dev/null \
          && ok "Patched finalizer: ${pvc}" || true
      done < <(kubectl get pvc -n "${ns}" -o name 2>/dev/null || true)
      # Patch CNPG clusters (can also have finalizers)
      while IFS= read -r cluster; do
        [[ -z "$cluster" ]] && continue
        progress "Patching CNPG cluster finalizer: ${cluster}"
        kubectl patch "${cluster}" -n "${ns}" -p '{"metadata":{"finalizers":[]}}' --type=merge 2>/dev/null \
          && ok "Patched finalizer: ${cluster}" || true
      done < <(kubectl get cluster -n "${ns}" -o name 2>/dev/null || true)
      # Patch any remaining ArgoCD Application CRs (resources-finalizer can block namespace)
      while IFS= read -r app; do
        [[ -z "$app" ]] && continue
        progress "Patching ArgoCD application finalizer: ${app}"
        kubectl patch "${app}" -n "${ns}" -p '{"metadata":{"finalizers":[]}}' --type=merge 2>/dev/null \
          && ok "Patched finalizer: ${app}" || true
      done < <(kubectl get application -n "${ns}" -o name 2>/dev/null || true)
      # Wait up to 30s more for namespace to finish terminating after finalizer patch
      progress "Waiting for namespace to finish terminating after finalizer patch..."
      for _ in $(seq 1 6); do
        sleep 5
        kubectl get namespace "${ns}" &>/dev/null 2>&1 || break
      done
      break
    fi
    sleep 5; (( WAIT+=5 )) || true
    progress "Namespace ${ns} still terminating... ${WAIT}s elapsed (auto-patch at 60s)"
  done
  echo ""

  if ! kubectl get namespace "${ns}" &>/dev/null 2>&1; then
    ok "Namespace deleted: ${ns}"
  else
    # Give it one final 15s wait before declaring failure — finalizer patch may still be processing
    progress "Namespace still present — waiting 15s for finalizer patch to take effect..."
    sleep 15
    if ! kubectl get namespace "${ns}" &>/dev/null 2>&1; then
      ok "Namespace deleted: ${ns}"
    else
      err "Namespace ${ns} still present after finalizer patch — manual cleanup needed:"
      err "  kubectl delete namespace ${ns} --force --grace-period=0"
      EXIT_CODE=1
    fi
  fi
done

# ── Step 4/6: Destroy AWS Infrastructure (tofu destroy) ──────────────────────
step "4/6" "Destroying AWS infrastructure via OpenTofu..."
if [[ ${#FOUND_AWS_INFRA_REPOS[@]} -eq 0 ]] || $SKIP_AWS; then
  skip "No AWS infra repos to destroy"
else
  # Check tofu is available
  if ! command -v tofu &>/dev/null; then
    warn "OpenTofu (tofu) not found — skipping AWS destroy. Install from https://opentofu.org"
    EXIT_CODE=1
  else
    TOFU_TMPDIR=$(mktemp -d)

    # TF_VAR_* — read from environment (must be exported before running this script)
    for var in AWS_VPC_ID AWS_VPC_CIDR AWS_PRIVATE_SUBNET_IDS TOFU_STATE_BUCKET TOFU_LOCK_TABLE; do
      [[ -z "${!var:-}" ]] && warn "Env var ${var} is not set — tofu destroy may prompt for it"
    done

    # Convert comma-separated subnet IDs to HCL list format required by TF_VAR for list(string)
    # e.g. "subnet-aaa,subnet-bbb" → ["subnet-aaa","subnet-bbb"]
    if [[ -n "${AWS_PRIVATE_SUBNET_IDS:-}" ]]; then
      SUBNET_LIST="[\"$(echo "${AWS_PRIVATE_SUBNET_IDS}" | sed 's/,/","/g')\"]"
    else
      SUBNET_LIST='[]'
    fi

    for entry in "${FOUND_AWS_INFRA_REPOS[@]+"${FOUND_AWS_INFRA_REPOS[@]}"}"; do
      repo_slug="${entry%%|*}"; resource_type="${entry##*|}"
      clone_dir="${TOFU_TMPDIR}/${repo_slug//\//-}"

      progress "Cloning ${repo_slug}..."
      if ! gh repo clone "${repo_slug}" "${clone_dir}" -- --depth=1 --quiet 2>/dev/null; then
        warn "Could not clone ${repo_slug} — skipping tofu destroy"
        EXIT_CODE=1
        continue
      fi

      progress "Running tofu destroy for ${repo_slug} (${resource_type})..."

      # Run in subshell to isolate env exports and cd; capture exit code explicitly
      set +e
      (
        cd "${clone_dir}"
        export TF_VAR_aws_region="${AWS_REGION}"
        export TF_VAR_vpc_id="${AWS_VPC_ID:-}"
        export TF_VAR_vpc_cidr="${AWS_VPC_CIDR:-}"
        export TF_VAR_private_subnet_ids="${SUBNET_LIST}"
        export TF_VAR_tofu_state_bucket="${TOFU_STATE_BUCKET:-your-org-tofu-state-prod}"
        export TF_VAR_tofu_state_region="${AWS_REGION}"
        export TF_VAR_tofu_lock_table="${TOFU_LOCK_TABLE:-terraform-locks}"

        AWS_PROFILE="${AWS_PROFILE}" tofu init -reconfigure -no-color
        AWS_PROFILE="${AWS_PROFILE}" tofu destroy -auto-approve -no-color
      )
      tofu_exit=$?
      set -e

      if [[ $tofu_exit -eq 0 ]]; then
        ok "AWS resources destroyed: ${repo_slug}"
      else
        err "tofu destroy failed for ${repo_slug} (exit ${tofu_exit}) — manual cleanup may be needed"
        EXIT_CODE=1
      fi
    done

    rm -rf "${TOFU_TMPDIR}"
  fi
fi

# ── Step 5/6: Delete GitHub Repository ───────────────────────────────────────
step "5/6" "Deleting GitHub repository..."
if $GITHUB_REPO_EXISTS && ! $KEEP_REPO; then
  progress "Deleting ${GITHUB_REPO_SLUG}..."
  if gh repo delete "${GITHUB_REPO_SLUG}" --yes 2>/dev/null; then
    ok "Deleted: ${GITHUB_REPO_SLUG}"
  else
    warn "Could not delete ${GITHUB_REPO_SLUG} (check permissions or already deleted)"
  fi
elif $KEEP_REPO; then
  skip "GitHub repo kept (--keep-repo): ${GITHUB_REPO_SLUG}"
else
  skip "GitHub repo (nothing to delete)"
fi

# Also delete AWS infra repos (tofu already destroyed the AWS resources above)
if ! $KEEP_REPO; then
  for entry in "${FOUND_AWS_INFRA_REPOS[@]+"${FOUND_AWS_INFRA_REPOS[@]}"}"; do
    repo_slug="${entry%%|*}"
    progress "Deleting infra repo ${repo_slug}..."
    if gh repo delete "${repo_slug}" --yes 2>/dev/null; then
      ok "Deleted infra repo: ${repo_slug}"
    else
      warn "Could not delete ${repo_slug} (check permissions or already deleted)"
    fi
  done
fi

# ── Step 6/6: Unregister Backstage Catalog Entities + Locations ──────────────
step "6/6" "Unregistering Backstage catalog entities and locations..."

# Delete entities first
for entry in "${CATALOG_ENTITIES[@]+"${CATALOG_ENTITIES[@]}"}"; do
  ref="${entry%/*}"; uid="${entry##*/}"
  progress "Unregistering entity ${ref} (uid: ${uid})..."
  http_status=$(curl -s -o /dev/null -w "%{http_code}" \
    -X DELETE \
    -H "Authorization: Bearer ${BACKSTAGE_TOKEN}" \
    "${BACKSTAGE_URL}/api/catalog/entities/by-uid/${uid}" 2>/dev/null || echo "000")
  if [[ "$http_status" == "204" || "$http_status" == "200" ]]; then
    ok "Unregistered entity: ${ref}"
  else
    warn "Catalog entity unregistration HTTP ${http_status} for ${ref} — may need manual cleanup"
    warn "  curl -X DELETE -H 'Authorization: Bearer <token>' ${BACKSTAGE_URL}/api/catalog/entities/by-uid/${uid}"
  fi
done

# Delete catalog locations — entities deleted above but the location URL record persists
# and causes 409 Conflict on re-scaffolding the same repo name.
# Build list of expected catalog-info.yaml URLs from all repos involved.
if [[ -n "$BACKSTAGE_TOKEN" ]]; then
  LOCATION_URLS=()
  _add_location_url() {
    local url="$1"
    for existing in "${LOCATION_URLS[@]+"${LOCATION_URLS[@]}"}"; do
      [[ "$existing" == "$url" ]] && return
    done
    LOCATION_URLS+=("$url")
  }
  [[ -n "$GITHUB_REPO_SLUG" ]] && \
    _add_location_url "https://github.com/${GITHUB_REPO_SLUG}/blob/main/catalog-info.yaml"
  for entry in "${FOUND_AWS_INFRA_REPOS[@]+"${FOUND_AWS_INFRA_REPOS[@]}"}"; do
    repo_slug="${entry%%|*}"
    _add_location_url "https://github.com/${repo_slug}/blob/main/catalog-info.yaml"
  done

  if [[ ${#LOCATION_URLS[@]} -gt 0 ]]; then
    # Fetch all registered locations once
    ALL_LOCATIONS=$(curl -s \
      -H "Authorization: Bearer ${BACKSTAGE_TOKEN}" \
      "${BACKSTAGE_URL}/api/catalog/locations" 2>/dev/null || echo "[]")

    for target_url in "${LOCATION_URLS[@]}"; do
      location_id=$(echo "$ALL_LOCATIONS" \
        | jq -r --arg url "$target_url" '.items[] | select(.target == $url) | .id' 2>/dev/null || true)

      if [[ -n "$location_id" ]]; then
        progress "Deleting catalog location: ${target_url}..."
        http_status=$(curl -s -o /dev/null -w "%{http_code}" \
          -X DELETE \
          -H "Authorization: Bearer ${BACKSTAGE_TOKEN}" \
          "${BACKSTAGE_URL}/api/catalog/locations/${location_id}" 2>/dev/null || echo "000")
        if [[ "$http_status" == "204" || "$http_status" == "200" ]]; then
          ok "Deleted catalog location: ${target_url}"
        else
          warn "Could not delete catalog location HTTP ${http_status}: ${target_url}"
        fi
      else
        skip "Catalog location not found (already removed?): ${target_url}"
      fi
    done
  fi
fi

# =============================================================================
# PHASE 4: REPORT
# =============================================================================
echo ""
log "Phase 4: Report"
echo ""

if [[ $EXIT_CODE -eq 0 ]]; then
  echo -e "  ${GREEN}${BOLD}✓ Teardown completed successfully.${RESET}"
else
  echo -e "  ${YELLOW}${BOLD}⚠  Completed with warnings — re-run to retry remaining resources.${RESET}"
fi

if [[ ${#CNPG_BACKUP_PATHS[@]} -gt 0 ]]; then
  echo ""
  SEEN_BACKUP_PATHS=()
  for entry in "${CNPG_BACKUP_PATHS[@]}"; do
    dest=$(echo "$entry" | cut -d'|' -f2)
    endpoint=$(echo "$entry" | cut -d'|' -f3)

    # Deduplicate by destination path
    already_seen=false
    for seen in "${SEEN_BACKUP_PATHS[@]+"${SEEN_BACKUP_PATHS[@]}"}"; do
      [[ "$seen" == "$dest" ]] && already_seen=true && break
    done
    $already_seen && continue
    SEEN_BACKUP_PATHS+=("$dest")

    if $KEEP_BACKUPS; then
      warn "S3 backups kept (--keep-backups): ${dest}"
    else
      log "Deleting CNPG backups: ${dest}..."
      # Credentials were extracted during Phase 1 while the namespace still existed
      access_key=$(echo "$entry" | cut -d'|' -f4)
      secret_key=$(echo "$entry" | cut -d'|' -f5)

      endpoint_flag=""
      [[ -n "$endpoint" ]] && endpoint_flag="--endpoint-url ${endpoint}"

      if [[ -z "$access_key" || -z "$secret_key" ]]; then
        warn "Could not resolve MinIO credentials — skipping S3 deletion"
        warn "  Manual: AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... aws s3 rm ${dest} --recursive ${endpoint_flag}"
      elif AWS_ACCESS_KEY_ID="${access_key}" AWS_SECRET_ACCESS_KEY="${secret_key}" \
         aws s3 rm "${dest}" --recursive ${endpoint_flag} 2>/dev/null; then
        ok "Deleted backups: ${dest}"
      else
        warn "Could not delete backups: ${dest}"
        warn "  Manual: AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... aws s3 rm ${dest} --recursive ${endpoint_flag}"
      fi
    fi
  done
fi

echo ""
exit $EXIT_CODE
