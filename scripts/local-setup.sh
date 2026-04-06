#!/usr/bin/env bash
#
# local-setup.sh — Full local development setup for the Backstage monorepo.
#
# Usage:
#   ./scripts/local-setup.sh          # Full setup (install + build + infra + dev)
#   ./scripts/local-setup.sh --build  # Skip install, just rebuild plugins + types
#   ./scripts/local-setup.sh --infra  # Only start Docker services (PostgreSQL + Redis)
#   ./scripts/local-setup.sh --check  # Verify prerequisites without changing anything
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# ── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

step()  { echo -e "\n${CYAN}${BOLD}[$1/$TOTAL_STEPS]${NC} $2"; }
ok()    { echo -e "  ${GREEN}✓${NC} $1"; }
warn()  { echo -e "  ${YELLOW}!${NC} $1"; }
fail()  { echo -e "  ${RED}✗${NC} $1"; }
info()  { echo -e "  $1"; }

# ── Parse flags ──────────────────────────────────────────────────────────────
MODE="full"
case "${1:-}" in
  --build) MODE="build" ;;
  --infra) MODE="infra" ;;
  --check) MODE="check" ;;
  --dev)   MODE="dev" ;;
  --help|-h)
    echo "Usage: ./scripts/local-setup.sh [--build|--infra|--check|--dev]"
    echo ""
    echo "  (no flag)  Full setup: check prereqs, install, build, start infra, run dev"
    echo "  --build    Rebuild all plugins and type declarations only"
    echo "  --infra    Start Docker services (PostgreSQL + Redis) only"
    echo "  --check    Verify prerequisites without changing anything"
    echo "  --dev      Start yarn dev + auto-rebuild backend plugins on file changes"
    exit 0
    ;;
esac

# ── Step counts by mode ─────────────────────────────────────────────────────
case "$MODE" in
  full)  TOTAL_STEPS=7 ;;
  build) TOTAL_STEPS=3 ;;
  infra) TOTAL_STEPS=1 ;;
  check) TOTAL_STEPS=1 ;;
  dev)   TOTAL_STEPS=1 ;;
esac

# ═══════════════════════════════════════════════════════════════════════════════
# STEP: Check prerequisites
# ═══════════════════════════════════════════════════════════════════════════════
check_prereqs() {
  local s="${1:-1}"
  step "$s" "Checking prerequisites"
  local failed=0

  # Node.js
  if command -v node &>/dev/null; then
    local node_ver
    node_ver="$(node -v)"
    local major="${node_ver#v}"
    major="${major%%.*}"
    if [[ "$major" == "20" || "$major" == "22" ]]; then
      ok "Node.js $node_ver"
    else
      fail "Node.js $node_ver — need 20.x or 22.x"
      failed=1
    fi
  else
    fail "Node.js not found — install 20.x or 22.x"
    failed=1
  fi

  # Yarn
  if command -v yarn &>/dev/null; then
    local yarn_ver
    yarn_ver="$(yarn -v 2>/dev/null)"
    if [[ "$yarn_ver" == 4.* ]]; then
      ok "Yarn $yarn_ver"
    else
      fail "Yarn $yarn_ver — need 4.x (Berry)"
      failed=1
    fi
  else
    fail "Yarn not found — run: corepack enable && corepack prepare yarn@4.12.0 --activate"
    failed=1
  fi

  # Docker
  if command -v docker &>/dev/null; then
    if docker info &>/dev/null; then
      ok "Docker running"
    else
      fail "Docker installed but daemon not running — start Docker Desktop"
      failed=1
    fi
  else
    fail "Docker not found — install Docker Desktop"
    failed=1
  fi

  # .env file
  if [[ -f "$ROOT_DIR/.env" ]]; then
    ok ".env file exists"
    # Check critical vars
    local missing_vars=()
    for var in POSTGRES_HOST POSTGRES_PASSWORD BACKEND_SECRET AUTH_GOOGLE_CLIENT_ID AUTH_GOOGLE_CLIENT_SECRET GITHUB_TOKEN; do
      if ! grep -q "^${var}=" "$ROOT_DIR/.env" 2>/dev/null; then
        missing_vars+=("$var")
      fi
    done
    if [[ ${#missing_vars[@]} -gt 0 ]]; then
      warn "Missing env vars: ${missing_vars[*]}"
      info "Copy .env.example to .env and fill in values"
    else
      ok "Critical env vars present"
    fi
  else
    fail ".env file missing — run: cp .env.example .env"
    failed=1
  fi

  # app-config.local.yaml
  if [[ -f "$ROOT_DIR/app-config.local.yaml" ]]; then
    ok "app-config.local.yaml exists"
  else
    warn "app-config.local.yaml missing — backend will use defaults from app-config.yaml"
  fi

  if [[ $failed -ne 0 ]]; then
    echo ""
    fail "Prerequisites check failed — fix the issues above and re-run."
    exit 1
  fi
}

# ═══════════════════════════════════════════════════════════════════════════════
# STEP: Start Docker infrastructure
# ═══════════════════════════════════════════════════════════════════════════════
start_infra() {
  local s="${1:-2}"
  step "$s" "Starting Docker services (PostgreSQL + Redis)"

  docker compose up -d db redis 2>/dev/null || docker-compose up -d db redis

  # Wait for healthy
  local retries=30
  while [[ $retries -gt 0 ]]; do
    local db_health redis_health
    db_health="$(docker inspect --format='{{.State.Health.Status}}' "$(docker compose ps -q db 2>/dev/null)" 2>/dev/null || echo "waiting")"
    redis_health="$(docker inspect --format='{{.State.Health.Status}}' "$(docker compose ps -q redis 2>/dev/null)" 2>/dev/null || echo "waiting")"
    if [[ "$db_health" == "healthy" && "$redis_health" == "healthy" ]]; then
      break
    fi
    sleep 1
    retries=$((retries - 1))
  done

  if [[ $retries -eq 0 ]]; then
    warn "Services may still be starting — check: docker compose ps"
  else
    ok "PostgreSQL ready on :5432"
    ok "Redis ready on :6379"
  fi
}

# ═══════════════════════════════════════════════════════════════════════════════
# STEP: Install dependencies
# ═══════════════════════════════════════════════════════════════════════════════
install_deps() {
  local s="${1:-3}"
  step "$s" "Installing dependencies (yarn install)"
  yarn install
  ok "Dependencies installed"
}

# ═══════════════════════════════════════════════════════════════════════════════
# STEP: Generate TypeScript declarations (dist-types/)
# ═══════════════════════════════════════════════════════════════════════════════
generate_types() {
  local s="${1:-4}"
  step "$s" "Generating TypeScript declarations (yarn tsc)"
  info "This generates dist-types/ that backend plugins need before they can build."

  # tsc may fail on first run if some plugin dist/ are missing (circular dep).
  # We run it, capture errors, and proceed — the build step will resolve it.
  if yarn tsc 2>/dev/null; then
    ok "TypeScript declarations generated — zero errors"
  else
    warn "tsc had errors (expected on first setup — backend plugins not yet built)"
    info "Will resolve after plugin builds below."
  fi
}

# ═══════════════════════════════════════════════════════════════════════════════
# STEP: Build backend plugins (dist/)
#
# ORDER MATTERS:
#   1. user-management-backend — other plugins and backend/src/index.ts import from it
#   2. All other backend plugins (parallel)
#   3. Re-run tsc to pick up newly-built plugins
# ═══════════════════════════════════════════════════════════════════════════════
build_plugins() {
  local s="${1:-5}"
  step "$s" "Building backend plugins"

  # Phase 1: Build the foundational plugin first (others depend on its exports)
  info "Phase 1: user-management-backend (depended on by other plugins)"
  yarn workspace @stratpoint/plugin-user-management-backend build
  ok "user-management-backend"

  # Phase 2: Build remaining backend plugins in parallel
  info "Phase 2: remaining backend plugins (parallel)"
  local backend_plugins=(
    "@stratpoint/plugin-project-registration-backend"
    "@stratpoint/plugin-local-provisioner-backend"
    "@stratpoint/plugin-finops-backend"
    "@stratpoint/plugin-engineering-docs-backend"
  )
  local pids=()
  local names=()
  for plugin in "${backend_plugins[@]}"; do
    yarn workspace "$plugin" build &>/dev/null &
    pids+=($!)
    names+=("$plugin")
  done

  local build_failed=0
  for i in "${!pids[@]}"; do
    if wait "${pids[$i]}"; then
      ok "${names[$i]##*/}"
    else
      fail "${names[$i]} — run manually: yarn workspace ${names[$i]} build"
      build_failed=1
    fi
  done

  if [[ $build_failed -ne 0 ]]; then
    warn "Some plugins failed to build — check errors above"
  fi
}

# ═══════════════════════════════════════════════════════════════════════════════
# STEP: Final tsc pass (now that all dist/ exist)
# ═══════════════════════════════════════════════════════════════════════════════
final_typecheck() {
  local s="${1:-6}"
  step "$s" "Final TypeScript check"
  if yarn tsc 2>/dev/null; then
    ok "Zero errors — all types resolve"
  else
    warn "tsc still has errors — run 'yarn tsc' to see details"
  fi
}

# ═══════════════════════════════════════════════════════════════════════════════
# STEP: Start dev server
# ═══════════════════════════════════════════════════════════════════════════════
start_dev() {
  local s="${1:-7}"
  step "$s" "Starting dev server"
  info "Frontend → http://localhost:3000"
  info "Backend  → http://localhost:7007"
  info "Press Ctrl+C to stop"
  echo ""
  exec yarn dev
}

# ═══════════════════════════════════════════════════════════════════════════════
# STEP: Watch backend plugins for changes and auto-rebuild
#
# Polls every 2s for .ts file changes inside plugins/*-backend/src/.
# When a change is detected, rebuilds only the affected plugin.
# ═══════════════════════════════════════════════════════════════════════════════

plugin_workspace_name() {
  case "$1" in
    user-management-backend)        echo "@stratpoint/plugin-user-management-backend" ;;
    project-registration-backend)   echo "@stratpoint/plugin-project-registration-backend" ;;
    local-provisioner-backend)      echo "@stratpoint/plugin-local-provisioner-backend" ;;
    finops-backend)                 echo "@stratpoint/plugin-finops-backend" ;;
    engineering-docs-backend)       echo "@stratpoint/plugin-engineering-docs-backend" ;;
    *) echo "" ;;
  esac
}

dir_checksum() {
  find "$1" -name '*.ts' -exec stat -f '%m' {} + 2>/dev/null | sort | md5
}

watch_backend_plugins() {
  info "Watching backend plugins for changes (polling every 2s)..."
  info "Edit any file in plugins/*-backend/src/ and it will auto-rebuild."
  echo ""

  # Store initial checksums in temp files
  local checksum_dir
  checksum_dir="$(mktemp -d)"
  trap "rm -rf '$checksum_dir'" RETURN

  for dir in "$ROOT_DIR"/plugins/*-backend/src; do
    local plugin_name
    plugin_name="$(basename "$(dirname "$dir")")"
    dir_checksum "$dir" > "$checksum_dir/$plugin_name"
  done

  while true; do
    sleep 2
    for dir in "$ROOT_DIR"/plugins/*-backend/src; do
      local plugin_name current_checksum prev_checksum ws
      plugin_name="$(basename "$(dirname "$dir")")"
      current_checksum="$(dir_checksum "$dir")"
      prev_checksum="$(cat "$checksum_dir/$plugin_name" 2>/dev/null || echo "")"

      if [[ "$prev_checksum" != "$current_checksum" ]]; then
        echo "$current_checksum" > "$checksum_dir/$plugin_name"
        ws="$(plugin_workspace_name "$plugin_name")"
        if [[ -n "$ws" ]]; then
          echo -e "${YELLOW}[watch]${NC} Change detected in ${BOLD}$plugin_name${NC} — rebuilding..."
          if yarn workspace "$ws" build 2>&1 | tail -3; then
            echo -e "${GREEN}[watch]${NC} ${BOLD}$plugin_name${NC} rebuilt — backend will auto-restart"
          else
            echo -e "${RED}[watch]${NC} ${BOLD}$plugin_name${NC} build failed"
          fi
        fi
      fi
    done
  done
}

start_dev_with_watch() {
  local s="${1:-1}"
  step "$s" "Starting dev server with backend plugin watcher"
  info "Frontend → http://localhost:3000"
  info "Backend  → http://localhost:7007"
  info "Backend plugins will auto-rebuild on file changes."
  info "Press Ctrl+C to stop all."
  echo ""

  # Start yarn dev in background
  yarn dev &
  local dev_pid=$!

  # Cleanup on exit
  trap "kill $dev_pid 2>/dev/null; exit" INT TERM

  # Start watcher in foreground
  watch_backend_plugins
}

# ═══════════════════════════════════════════════════════════════════════════════
# Run
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${BOLD}Backstage Local Setup${NC} — mode: ${CYAN}$MODE${NC}"

case "$MODE" in
  check)
    check_prereqs 1
    echo ""
    ok "All prerequisites met — run ./scripts/local-setup.sh to start"
    ;;
  infra)
    start_infra 1
    ;;
  build)
    generate_types 1
    build_plugins 2
    final_typecheck 3
    echo ""
    ok "All plugins built. Run 'yarn dev' to start."
    ;;
  dev)
    start_dev_with_watch 1
    ;;
  full)
    check_prereqs 1
    start_infra 2
    install_deps 3
    generate_types 4
    build_plugins 5
    final_typecheck 6
    start_dev 7
    ;;
esac
