# Backstage Project - AI Assistant Context

| Field | Value |
|-------|-------|
| **Last Updated** | 2026-03-31 |
| **Project** | Stratpoint Internal Developer Portal |
| **Backstage Version** | 1.49.1 |
| **Status** | Production-ready, deployed on AWS ECS Fargate (portal.stratpoint.io) + k8s homelab |
| **Node.js** | 20.x or 22.x |
| **Package Manager** | Yarn 4.12.0 (Berry with PnP) |

---

## MANDATORY Fix Protocol (non-negotiable)

> Established 2026-03-22. Ronald's time is real. Never say a fix is done without proof.

**BEFORE touching any code:**
1. Read the ENTIRE relevant function/file top-to-bottom — not just the part that looks wrong
2. When a value is added to a filter/condition, grep for every OTHER place in the same file that also needs to handle that value
3. For backend bugs: run a real Node.js test script using actual GitHub/Redis/API data that simulates the exact code path
4. For frontend bugs: get the actual rendered output (DevTools outerHTML, real HTML from backend) — never guess from source alone

**BEFORE saying "fixed", "done", "check it now", or "restart":**
1. Show the test script output in the response — if you cannot show it, the fix is not ready
2. For backend changes: confirm the fix is in the compiled dist (`grep` the dist file), THEN clear Redis cache, THEN tell user to restart
3. For frontend changes: verify the hot-reload applied correctly before saying done

**AFTER making changes:**
1. Update this CLAUDE.md file
2. Only after showing proof: tell user what to do (restart backend, refresh browser, etc.)

**For breaking changes:** Use AskUserQuestion → Explain risks → Get explicit approval

---

## AI Safety Protocol

> Established 2025-12-21 after permission system changes broke authentication flow.

**BEFORE making changes:**
1. Read this CLAUDE.md file completely
2. Use TodoWrite for multi-step tasks
3. Assess impact on: Auth flow, Permissions, Catalog, Plugin dependencies, DB schemas, API contracts

---

## Architecture Overview

### Repository Philosophy
- **Portal only**: This repo contains the Backstage application code
- **Templates separate**: https://github.com/stratpoint-engineering/engineering-standards.git
- **No local template paths**: All template references use GitHub URLs

### Tech Stack
| Layer | Technology |
|-------|------------|
| Frontend | React 18, TypeScript, Material-UI (Geist/Vercel design system) |
| Backend | Node.js, Express (new backend system) |
| Database | PostgreSQL 13.3 |
| Cache | Redis 7 |
| Auth | Google OAuth (@stratpoint.com domain restriction) |

---

## Directory Structure

```
├── packages/
│   ├── app/                          # Frontend React application
│   │   └── src/
│   │       ├── components/
│   │       │   ├── auth/CustomSignInPage.tsx    # Branded sign-in
│   │       │   ├── home/HomePage.tsx            # Custom homepage
│   │       │   └── Root/Root.tsx                # Sidebar navigation
│   │       └── theme.ts                         # Light/Dark themes
│   ├── backend/                      # Backend Node.js services
│   │   └── src/
│   │       ├── index.ts              # Backend entry (createBackend() API)
│   │       └── plugins/
│   │           ├── permission.ts                # Custom RBAC policy
│   │           └── permission-backend-module.ts # Policy registration
│   └── backstage-agent/              # CLI agent for local provisioning
│       └── src/
│           ├── agent/                # Agent core + SSE client
│           ├── auth/                 # OAuth + token management
│           ├── commands/             # login, start, status, logout
│           ├── executor/             # Docker Compose executor
│           └── config/               # Config file management
├── plugins/
│   ├── local-provisioner/            # Frontend plugin (Phase 2)
│   │   └── src/
│   │       ├── api/                  # Client + types + transformers
│   │       ├── hooks/                # useProvisioningTasks, useAgentStatus
│   │       └── components/           # LocalProvisionerPage, TasksList
│   ├── local-provisioner-backend/    # Backend plugin (Phase 1)
│   │   └── src/
│   │       ├── api/                  # agentRoutes, taskRoutes, healthRoutes
│   │       ├── service/              # AgentService, TaskQueueService
│   │       └── database/             # TaskStore + migrations
│   └── project-registration/         # Project wizard (frontend only)
├── stratpoint/                       # Organization catalog
│   ├── org/groups.yaml               # Teams and departments
│   ├── org/users.yaml                # User definitions
│   ├── systems/                      # System definitions
│   └── components/                   # Component catalog
├── docs/                             # Implementation docs
├── app-config.yaml                   # Base configuration
├── app-config.local.yaml             # Local overrides
├── app-config.production.yaml        # Production config
└── docker-compose.yml                # Local PostgreSQL + Redis
```

---

## Key Systems

### 1. Local Provisioning System (Custom)

A 3-phase implementation for provisioning local development resources via Docker Compose.

**Components:**
| Component | Location | Purpose |
|-----------|----------|---------|
| Backend Plugin | `plugins/local-provisioner-backend/` | Task queue, SSE, agent management |
| Frontend Plugin | `plugins/local-provisioner/` | UI for task management |
| CLI Agent | `packages/backstage-agent/` | Runs on dev machines, executes tasks |

**Database Tables:**
- `provisioning_tasks` - Task queue with status tracking
- `agent_registrations` - Agent registry with machine info

**API Endpoints:**

Public (no auth):
- `GET /api/local-provisioner/health[/ready|/live]` - Health checks
- `POST /api/local-provisioner/agent/device/code` - Generate device code
- `POST /api/local-provisioner/agent/device/token` - Poll for token

Protected (requires auth):
- `POST /api/local-provisioner/agent/register` - Register agent
- `POST /api/local-provisioner/agent/heartbeat` - Agent heartbeat
- `GET /api/local-provisioner/agent/tasks/stream` - SSE task stream
- `GET|POST /api/local-provisioner/tasks` - Task CRUD
- `POST /api/local-provisioner/agent/device/authorize` - Authorize device

### 2. OAuth Device Code Flow (RFC 8628)

Industry-standard CLI authentication (like GitHub CLI, AWS CLI).

**Flow:**
1. CLI calls `POST /agent/device/code` → receives `device_code` + `user_code` (e.g., ABCD-1234)
2. User opens browser to `/device`, enters code
3. User authenticates via Google OAuth in browser
4. Browser calls `POST /agent/device/authorize` with user_code
5. CLI polls `POST /agent/device/token` until authorized
6. CLI receives JWT token, saves to `~/.backstage-agent/config.json`

**Security:**
- Device codes expire in 10 minutes
- User codes: Human-readable (33^8 combinations)
- Device codes: Cryptographic (62^32 combinations)
- Service tokens expire in 30 days
- Tokens include user identity for RBAC

### 3. Permission System

Custom RBAC implementation in `packages/backend/src/plugins/permission.ts`.

| Role | Group | Capabilities |
|------|-------|--------------|
| Admin | `backstage-admins` | Full access, can delete entities |
| User | Any authenticated | Create, read, use scaffolder |

**Grant admin access:** Add `backstage-admins` to user's `memberOf` array in `stratpoint/org/users.yaml`

### 4. Type Transformation Layer

Following Backstage best practices, backend and frontend use different naming conventions:

```
Backend (Database)    →    API Client          →    Frontend (Components)
──────────────────         ──────────────            ────────────────────
snake_case                 transformers.ts           camelCase
task_id                    transformTask()           task.id
agent_id                   transformAgent()          task.agentId
{ tasks, total }           Unwrap + Transform        ProvisioningTask[]
```

**Key files:**
- `plugins/local-provisioner/src/api/types.ts` - Dual type definitions
- `plugins/local-provisioner/src/api/transformers.ts` - Transform functions
- `plugins/local-provisioner/src/api/LocalProvisionerClient.ts` - Auto-transforms

---

## Backend System Patterns

This project uses the **new Backstage backend system** (`createBackend()` API).

### Adding Backend Modules
```typescript
// packages/backend/src/index.ts
backend.add(import('./plugins/custom-module'));
```

### Public Routes (Critical Pattern)
```typescript
// In plugin.ts, BEFORE httpRouter.use()
httpRouter.addAuthPolicy({
  path: '/health',
  allow: 'unauthenticated',
});
```

### Permission Policy
```typescript
// Use policyExtensionPoint, not createRouter()
policyExtensionPoint.setPolicy(new CustomPermissionPolicy());
```

---

## Environment Variables

```bash
# Database (Required)
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=backstage
POSTGRES_PASSWORD=<password>
POSTGRES_DB=backstage

# Authentication (Required)
AUTH_GOOGLE_CLIENT_ID=<client-id>.apps.googleusercontent.com
AUTH_GOOGLE_CLIENT_SECRET=<secret>
AUTH_GOOGLE_ALLOWED_DOMAINS=stratpoint.com
BACKEND_SECRET=<32-byte-hex>  # Generate: node -p 'require("crypto").randomBytes(32).toString("hex")'

# GitHub Integration
GITHUB_TOKEN=<personal-access-token>
AUTH_GITHUB_CLIENT_ID=<client-id>
AUTH_GITHUB_CLIENT_SECRET=<secret>

# Cache (Required in production — no fallback)
REDIS_URL=redis://localhost:6379
CACHE_STORE=redis

# Kubernetes (in-cluster: pod must run as serviceAccountName: backstage-k8s-reader)
# K8S_SA_TOKEN and K8S_SA_CA_DATA are NO LONGER NEEDED — removed in favour of in-cluster SA token mounting.

# ArgoCD
ARGOCD_AUTH_TOKEN=argocd.token=<token>

# FinOps — AWS account numbers (string values, must be quoted in app-config.yaml substitution)
FINOPS_AWS_ACCOUNT_NONPROD=<12-digit-account-id>
FINOPS_AWS_ACCOUNT_LEGACY=<12-digit-account-id>
FINOPS_AWS_ACCOUNT_PROD=<12-digit-account-id>
```

---

## Deployment — TWO TARGETS (read this every session)

> When the user says "there are new changes/commits on develop" — they mean **run deploy.sh** to deploy to k8s homelab. Do not ask, just confirm and run.

| Target | Trigger phrase | Command |
|--------|---------------|---------|
| **Talos k8s homelab** | "new changes", "new commits", "i-deploy" | `bash scripts/deploy.sh` |
| **AWS ECS Fargate** | "portal.stratpoint.io", "AWS", "ECS", "tofu" | build ECR + `tofu apply` (see AWS ECS section below) |

### Deploy to k8s (homelab)
```bash
bash scripts/deploy.sh
# Pulls latest develop, builds Docker image, pushes to 192.168.2.101:5000, kubectl rollout restart
```

### Deploy to AWS ECS Fargate
```bash
cd infra/
docker build -t 746540123485.dkr.ecr.us-west-2.amazonaws.com/backstage-idp-prod:latest -f packages/backend/Dockerfile .
aws ecr get-login-password --region us-west-2 --profile cost-admin-nonprod | docker login --username AWS --password-stdin 746540123485.dkr.ecr.us-west-2.amazonaws.com
docker push 746540123485.dkr.ecr.us-west-2.amazonaws.com/backstage-idp-prod:latest
AWS_PROFILE=cost-admin-nonprod tofu apply -auto-approve
```

---

## Common Tasks

### Running Locally
```bash
docker-compose up -d          # Start PostgreSQL + Redis
yarn install                  # Install dependencies
yarn dev                      # Start dev server (frontend :3000, backend :7007)
```

### Adding a User
Edit `stratpoint/org/users.yaml`:
```yaml
---
apiVersion: backstage.io/v1alpha1
kind: User
metadata:
  name: firstname.lastname
spec:
  profile:
    email: firstname.lastname@stratpoint.com
    displayName: Firstname Lastname
  memberOf: [backend-team]  # Add backstage-admins for admin access
```

### Adding a Team
Edit `stratpoint/org/groups.yaml`:
```yaml
---
apiVersion: backstage.io/v1alpha1
kind: Group
metadata:
  name: new-team
spec:
  type: team
  parent: engineering-dept
  children: []
```

### Integrating a Frontend Plugin
1. Add dependency to `packages/app/package.json`
2. Run `yarn install`
3. Import in `packages/app/src/App.tsx`
4. Add route: `<Route path="/my-plugin" element={<MyPluginPage />} />`
5. Add sidebar item in `packages/app/src/components/Root/Root.tsx`

---

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| Login redirect fails | Permission module misconfigured | Ensure `permission-backend-module.ts` uses `policyExtensionPoint` |
| 401 on health endpoints | Auth policy missing | Add `httpRouter.addAuthPolicy()` BEFORE `httpRouter.use()` |
| Catalog not loading | Invalid paths/YAML | Check paths relative to `packages/backend/`, validate YAML |
| Permission denied | User not in correct group | Check `memberOf` in `stratpoint/org/users.yaml` |
| Module not found | Missing workspace dependency | Add plugin to `packages/app/package.json`, run `yarn install` |
| Device code flow fails | Expired codes | Codes expire in 10 min, restart flow |
| Auth plugin "Migration table locked" | Concurrent migrations from pod restarts | See "Recent Issue: Migration Lock Recovery" section for fix |

---

## Changelog

| Date | Change |
|------|--------|
| 2026-03-31 | AWS ECS Fargate deployment: OpenTofu-managed infra in `infra/` — VPC, RDS PostgreSQL 13.20, ElastiCache Redis 7.1, ECR, ECS Fargate, Secrets Manager, CloudWatch. Cloudflare Tunnel `backstage-aws-prod` routes `portal.stratpoint.io`. 4-container task: create-db (init) → db-migrations (init) → backstage (main) → cloudflared (sidecar). S3 backend `stratpoint-tofu-state-prod`. ~$90/month. |
| 2026-03-31 | Admin onboarding bug documented: admins bypass `POST /register` (step 1 auto-done), so `user_management_users` has no row → `updateOnboardingStep` silently fails for steps 3 & 4. Fix planned as Admin Setup Portal (see `.claude/plans/user-management-onboarding-roadmap.md`). |
| 2026-03-28 | P1 features: GitHub catalog autodiscovery (plugin-catalog-backend-module-github + orphanStrategy:delete), rate limiting on device endpoints (express-rate-limit, 10/15min for code, 130/10min for token), Project Registration backend plugin (`@stratpoint/plugin-project-registration-backend`) — DB store, REST API, leads+admins RBAC, system project pre-seeding; frontend wired to real API |
| 2026-03-28 | Security audit round 2: CSP frame-src cleaned (removed redundant APP_BASE_URL), AWS account IDs moved to env vars (FINOPS_AWS_ACCOUNT_NONPROD/LEGACY/PROD) with quoted substitution to preserve string type, DEPT_TEAM_IDS/JWT moved to onboarding/src/constants.ts (clean re-export, no shared-config package — backend cannot consume src/index.ts workspace deps), useUserRole 30s GitHub poll removed (single mount-time check sufficient) |
| 2026-03-28 | Security audit follow-up: purgeExpired scheduler (hourly via coreServices.scheduler), DEPT_TEAMS unified to DEPT_TEAM_IDS_JWT single source of truth, finopsReadPermission moved to frontend-safe finopsPermissions.ts (removes node:assert bundle error), migration path fixed src/ not dist/, Dockerfile.with-migrations restored as production pipeline, dependenciesMeta.built:false for keytar/cpu-features |
| 2026-03-28 | Security + config hardening: 16-item audit — removed dead permission.policies YAML, fixed Redis cache fallback, added FinOps RequirePermission guard, fixed !user/isAdmin ordering, in-cluster k8s SA token, Dockerfile sqlite3 cleanup, sharedStore logging, deprecated Dockerfile.with-migrations |
| 2026-03-22 | K8s + ArgoCD + CNPG integration — SA, secrets, config, 3-tier template. See `docs/K8S_ARGOCD_CNPG_INTEGRATION.md` |
| 2026-03-22 | Merged `feature/finops-dashboard` → upgraded Backstage to 1.49.1, added FinOps dashboard + Engineering Docs plugins |
| 2026-03-22 | Fixed `Dockerfile.with-migrations` — added node_modules symlinks + npm-installed missing deps for new plugins |
| 2026-03-22 | Added `GITHUB_TOKEN` to `backstage-secrets` k8s secret (required by engineering-docs plugin) |
| 2026-03-22 | Fixed production CSS mismatch — MUI v4 compresses class names in prod, breaking `[class*="Backstage*"]` selectors; moved all Backstage component styles to `theme.ts` styleOverrides |
| 2026-03-22 | Switched theme registration to `createApp({ themes })` + `appThemeApiRef` — eliminates double ThemeProvider collision |
| 2025-12-27 | OAuth Device Code Flow (RFC 8628) for CLI authentication |
| 2025-12-26 | Local Provisioner Phase 3: Agent CLI package complete |
| 2025-12-26 | Local Provisioner Phase 1 & 2: Backend + Frontend plugins complete |
| 2025-12-26 | Fixed 401 errors on health endpoints (httpRouter.addAuthPolicy pattern) |
| 2025-12-21 | Custom RBAC permission system implemented |
| 2025-12-21 | Templates externalized to engineering-standards repo |
| 2025-12-21 | Coolify deployment preparation (COOLIFY_DEPLOYMENT_PLAN.md) |
| 2026-02-14 | **RECOVERED**: Migration lock issue after ZFS worker node migration |

---

## Recent Issue: Migration Lock Recovery (2026-02-14)

### What Happened
After ZFS worker node migration, Backstage failed to start with:
```
Plugin 'auth' startup failed; caused by MigrationLocked: Migration table is already locked
```

**Root Cause**: Simultaneous pod restarts created a race condition where multiple Backstage instances tried to run migrations concurrently, leaving duplicate lock entries in the `knex_migrations_lock` table.

### The Fix
Backstage expert cleaned up duplicate migration locks directly in PostgreSQL:
```sql
DELETE FROM knex_migrations_lock;
INSERT INTO knex_migrations_lock (index, is_locked) VALUES (1, 0);
```

This removed duplicate entries and allowed the auth plugin to proceed.

### Prevention for Future Events

**When doing cluster maintenance (node drains, ZFS migrations, etc.):**

1. **Drain nodes one at a time** - Don't restart all pods simultaneously
   - Sequential node maintenance prevents concurrent migrations

2. **Monitor init container** - Watch logs during deployment:
   ```bash
   kubectl logs -n backstage deployment/backstage -c db-migrations -f
   ```

3. **Watch for duplicate locks** - If readiness fails after pod restart:
   ```bash
   # Check lock table state
   kubectl run -n backstage psql-check --rm -it --restart=Never \
     --image=postgres:13.3 \
     --env="PGPASSWORD=<password>" \
     --command -- psql \
     -h postgres-cluster-rw.default.svc.cluster.local \
     -U backstage -d backstage_plugin_auth \
     -c "SELECT * FROM knex_migrations_lock;"

   # If more than 1 row exists, clean it up (see above SQL)
   ```

4. **Key setting to maintain**: `replicaCount: 1` in `backstage-values.yaml`
   - Prevents multiple concurrent migration attempts

5. **Configuration consistency**:
   - Init container and main backend must use same `POSTGRES_DB` value
   - Don't use `pluginDivisionMode: 'schema'` unless you plan schema-based architecture (requires separate migration strategy)

---

## AWS ECS Fargate Deployment

Infrastructure is fully managed by OpenTofu in `infra/`. **Never configure manually — always use `tofu apply`.**

### Key facts
- **URL:** `https://portal.stratpoint.io` via Cloudflare Tunnel `backstage-aws-prod`
- **AWS account:** 746540123485 (nonprod), profile: `cost-admin-nonprod`, region: `us-west-2`
- **State backend:** S3 `stratpoint-tofu-state-prod` + DynamoDB lock
- **Cost:** ~$90-95/month (ECS Fargate + RDS db.t4g.small + ElastiCache cache.t4g.small)

### Deploy workflow
```bash
cd infra/

# 1. Build & push image
docker build -t 746540123485.dkr.ecr.us-west-2.amazonaws.com/backstage-idp-prod:latest .
aws ecr get-login-password --region us-west-2 --profile cost-admin-nonprod | docker login --username AWS --password-stdin 746540123485.dkr.ecr.us-west-2.amazonaws.com
docker push 746540123485.dkr.ecr.us-west-2.amazonaws.com/backstage-idp-prod:latest

# 2. Apply (force_new_deployment=true triggers redeployment automatically)
AWS_PROFILE=cost-admin-nonprod tofu apply -auto-approve
```

### 4-container task design
| Container | Image | Role | depends on |
|-----------|-------|------|------------|
| `create-db` | postgres:18 | Creates `backstage_plugin_local-provisioner` DB | — |
| `db-migrations` | backstage image | Runs Knex migrations for local-provisioner-backend | create-db SUCCESS |
| `backstage` | backstage image | Main app | db-migrations SUCCESS |
| `cloudflared` | cloudflare/cloudflared:2025.4.0 | Tunnel sidecar | backstage HEALTHY |

### Critical ECS lessons (do not repeat)
1. **k8s → ECS mapping:** k8s `command` = ECS `entryPoint`, k8s `args` = ECS `command`. No `args` field in ECS.
2. **Shell quoting:** `$VAR` inside single quotes is NOT expanded. Use double quotes or remove the variable reference.
3. **No curl in image:** `node:20-bookworm-slim` has no `curl`. Use Node.js for health checks: `node -e "require('http').get('http://localhost:7007/.backstage/health/v1/liveness',(r)=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"`
4. **dependsOn:** Always use `condition = "SUCCESS"`, never `"COMPLETE"`.
5. **Secrets after destroy:** 7-day recovery window blocks re-apply. Force-delete with `--force-delete-without-recovery` before re-applying.
6. **ElastiCache snapshotting:** `ListTagsForResource` returns 404 during snapshot. Wait for `available` before applying.

### Cloudflare Tunnels
| Tunnel | Account | Routes |
|--------|---------|--------|
| `backstage-aws-prod` (ID: a6f27602) | stratpoint.io | `portal.stratpoint.io` → `localhost:7007` |
| `argocd-k8s` | coderstudio.co | `argocd.coderstudio.co` → homelab ArgoCD |

---

## Known Issues & Next Steps

### Known Issues
| Priority | Issue | Location |
|----------|-------|----------|
| Medium | Project Registration Phase 2: "Select Project" dropdown in scaffolder templates | `plugins/project-registration-backend/`, `templates/` |
| Medium | Project Registration Phase 3: Jira integration (create project in Jira on submit) | `plugins/project-registration-backend/src/service/router.ts` |
| Medium | FinOps route guard uses `catalogLocationDeletePermission` as a proxy (admin-only by coincidence). Should be a proper `finops.read` BasicPermission registered via permissions extension point in `plugins/finops-backend`. | `packages/app/src/App.tsx:130`, `plugins/finops-backend/` |
| Medium | User provisioning is manual | `stratpoint/org/users.yaml` |
| Medium | TechDocs uses local storage | `app-config.yaml` |
| Low | Limited test coverage | All plugins |

### Next Steps
1. Annotate existing components with `backstage.io/kubernetes-id` to show K8s tab
2. Push `templates/three-tier-app/` to `engineering-standards` repo to activate template
3. Create dedicated ArgoCD service account for Backstage (instead of admin token)
4. Create `/device` frontend UI for device code entry
5. Update CLI to use device code flow (not manual token)
6. Wire "Select Project" dropdown into scaffolder templates (Project Registration Phase 2)
7. Add Jira integration to Project Registration (Phase 3)
8. Implement Google Workspace user sync

---

## Files Quick Reference

| Purpose | Key Files |
|---------|-----------|
| Auth Config | `app-config.yaml:93-112`, `CustomSignInPage.tsx` |
| Permissions | `permission.ts`, `permission-backend-module.ts` |
| K8s + ArgoCD config | `app-config.yaml` (kubernetes/proxy/argocd blocks), `app-config.production.yaml` |
| K8s RBAC manifest | `k8s-manifests/backstage-k8s-reader.yaml` |
| CNPG catalog entities | `stratpoint/systems/platform-databases.yaml` |
| 3-tier app template | `templates/three-tier-app/template.yaml` + `skeleton/` |
| Integration docs | `docs/K8S_ARGOCD_CNPG_INTEGRATION.md` |
| Themes | `packages/app/src/theme.ts` |
| Users/Groups | `stratpoint/org/users.yaml`, `stratpoint/org/groups.yaml` |
| Local Provisioner API | `plugins/local-provisioner-backend/src/api/*.ts` |
| Agent CLI Entry | `packages/backstage-agent/bin/backstage-agent.js` |
| Backend Entry | `packages/backend/src/index.ts` |
| Production Config | `app-config.production.yaml` |
| Deployment Guide | `COOLIFY_DEPLOYMENT_PLAN.md` |

---

## Vercel Geist Design System (Mandatory)

> All frontend code MUST follow the Vercel Geist design system. Do NOT use default Backstage/Material-UI styling patterns.

### Rules
1. **Icons**: Use `lucide-react` exclusively — NEVER `@material-ui/icons`. Always `size={16} strokeWidth={1.5}` (14 in small contexts)
2. **Colors**: Use CSS variables (`var(--ds-background-200)`, `var(--fg-primary)`, `var(--border)`, etc.) or theme palette tokens — never hardcode hex values outside `theme.ts`
3. **Typography**: Geist font, tight letter-spacing (`-0.006em` body, `-0.025em` headings). Section labels: `0.6875rem, weight 600, tracking 0.06em, UPPERCASE`
4. **Spacing**: Page padding `48px 32px`, card padding `20px`, grid gaps `10-12px`
5. **Borders**: `1px solid var(--border)`, radius `8px` for cards/containers, `6px` for buttons/inputs
6. **Buttons**: No `text-transform`, no `box-shadow`, `fontWeight: 500`, height `40px` (small `32px`)
7. **Destructive actions**: Red (`#e5484d`), never purple `color="secondary"`
8. **Hover**: Border color change only — no shadow, no scale transform
9. **Theme file**: `packages/app/src/theme.ts` is the single source of truth for MUI overrides
10. **Design tokens reference**: See memory file `project_design_system.md` for full token list

### Quick Reference
| Element | Pattern |
|---------|---------|
| Icon in card | `<Icon size={14} strokeWidth={1.5} color="var(--fg-secondary)" />` |
| Icon in table/button | `<Icon size={16} strokeWidth={1.5} />` |
| Section label | `fontSize: 0.6875rem, fontWeight: 600, letterSpacing: 0.06em, uppercase` |
| Card | `bg: var(--ds-background-100), border: 1px solid var(--border), radius: 8px, padding: 20px` |
| Badge/pill | `border: 1px solid var(--border), radius: 100px, padding: 5px 12px` |

---

## AI Assistant Reminders

1. **New backend system**: Use `createBackend()`, `policyExtensionPoint`, `httpRouter.addAuthPolicy()`
2. **Organization location**: `stratpoint/` (not `examples/`)
3. **Templates location**: External repo via GitHub URLs
4. **Auth restriction**: Google OAuth, `@stratpoint.com` domain only
5. **Type safety**: Full TypeScript, snake_case ↔ camelCase transformation layer
6. **Test auth flow**: Always verify login works after permission/auth changes
7. **Config hierarchy**: `app-config.yaml` → `app-config.local.yaml` → `app-config.production.yaml`
8. **Geist design system**: All frontend must use Vercel Geist tokens, `lucide-react` icons, and patterns from `theme.ts` — never default Material-UI styling

---

*Update this file when making significant architecture, configuration, or implementation changes.*
