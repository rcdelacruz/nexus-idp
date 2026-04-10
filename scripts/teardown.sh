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
#
# Examples:
#   bash scripts/teardown.sh demo-for-syl
#   bash scripts/teardown.sh demo-for-syl --execute --token <token>
#   bash scripts/teardown.sh demo-for-syl --execute --keep-repo
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
BACKSTAGE_URL="https://backstage.coderstudio.co"
BACKSTAGE_TOKEN=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --execute)       EXECUTE=true ;;
    --keep-repo)     KEEP_REPO=true ;;
    --keep-backups)  KEEP_BACKUPS=true ;;
    --backstage-url) BACKSTAGE_URL="$2"; shift ;;
    --token)         BACKSTAGE_TOKEN="$2"; shift ;;
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
  for org in strat-main-team stratpoint-engineering; do
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

# ── Step 1/5: Suspend ArgoCD auto-sync on all apps ───────────────────────────
step "1/5" "Suspending ArgoCD auto-sync (prevents re-creation during teardown)..."
for full_ref in "${FOUND_ARGOCD_APPS[@]+"${FOUND_ARGOCD_APPS[@]}"}"; do
  ns="${full_ref%%/*}"; name="${full_ref##*/}"
  progress "Suspending ${full_ref}..."
  kubectl patch application "${name}" -n "${ns}" \
    --type='merge' -p '{"spec":{"syncPolicy":{"automated":null}}}' &>/dev/null 2>&1 \
    && ok "Auto-sync suspended: ${full_ref}" \
    || warn "Could not suspend: ${full_ref}"
done

# ── Step 2/5: Delete ArgoCD Applications ─────────────────────────────────────
# Delete in-namespace apps first (they have resources-finalizer — must complete
# before namespace deletion, or the finalizer will deadlock namespace termination)
step "2/5" "Deleting ArgoCD applications (cascade-deletes all synced k8s resources)..."
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

# ── Step 3/5: Delete Kubernetes Namespaces ───────────────────────────────────
step "3/5" "Deleting Kubernetes namespaces (cascades pods, services, CNPG, PVCs)..."
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

# ── Step 4/5: Delete GitHub Repository ───────────────────────────────────────
step "4/5" "Deleting GitHub repository..."
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

# ── Step 5/5: Unregister Backstage Catalog Entities ──────────────────────────
step "5/5" "Unregistering Backstage catalog entities..."
for entry in "${CATALOG_ENTITIES[@]+"${CATALOG_ENTITIES[@]}"}"; do
  ref="${entry%/*}"; uid="${entry##*/}"
  progress "Unregistering ${ref} (uid: ${uid})..."
  http_status=$(curl -s -o /dev/null -w "%{http_code}" \
    -X DELETE \
    -H "Authorization: Bearer ${BACKSTAGE_TOKEN}" \
    "${BACKSTAGE_URL}/api/catalog/entities/by-uid/${uid}" 2>/dev/null || echo "000")
  if [[ "$http_status" == "204" || "$http_status" == "200" ]]; then
    ok "Unregistered: ${ref}"
  else
    warn "Catalog unregistration HTTP ${http_status} for ${ref} — may need manual cleanup"
    warn "  curl -X DELETE -H 'Authorization: Bearer <token>' ${BACKSTAGE_URL}/api/catalog/entities/by-uid/${uid}"
  fi
done

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
