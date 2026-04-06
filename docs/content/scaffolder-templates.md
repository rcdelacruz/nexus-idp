# Scaffolder Templates

**Date:** 2026-04-06
**Status:** Active — nextjs-fullstack, generic-application, and documentation templates in production

---

## Overview

Nexus IDP uses a **multi-skeleton** scaffolder architecture. Templates are composed of independent, reusable skeleton layers that are merged together at generation time.

All templates and skeletons live in the external `engineering-standards` repo:
```
https://github.com/stratpoint-engineering/engineering-standards
templates/
├── projects/              # Template definitions
│   ├── web/
│   │   └── nextjs-fullstack/template.yaml
│   └── cloud/
│       └── generic-application/template.yaml
└── skeletons/             # Reusable skeleton layers
    ├── frameworks/        # Application code (one per framework)
    │   └── nextjs/        # Next.js 16 + tRPC + Prisma + NextAuth + Tailwind
    └── targets/           # Infrastructure & CI/CD (one per deployment target)
        ├── k8s/           # Kubernetes manifests + GitHub Actions deploy workflow
        ├── ecs/           # ECS task definition + deploy workflow
        ├── app-runner/    # App Runner config + deploy workflow
        ├── db-cnpg/       # CNPG PostgreSQL cluster manifests
        └── catalog/       # Backstage catalog-info.yaml
```

---

## How Skeleton Composition Works

Each template runs multiple `fetch:template` steps. The skeletons are merged in order — later skeletons overwrite files from earlier ones if there are filename conflicts.

**Template step order:**
1. `fetch-<framework>` — generates application code (e.g. `fetch-nextjs`)
2. `fetch-<target>` — generates infra/CI files (e.g. `fetch-k8s`)
3. `fetch-<db>` *(optional)* — generates database manifests (e.g. `fetch-db-cnpg`)
4. `fetch-catalog` — always runs last — generates `catalog-info.yaml`

> ⚠️ The catalog step runs **last** intentionally. It overwrites any `catalog-info.yaml` from earlier skeletons to ensure deployment-target-specific annotations (K8s, ECS, ArgoCD) are always generated correctly.

Skeleton URLs are resolved via the `scaffolder:resolve-skeleton-url` custom action, which handles both local development (`file://`) and production (GitHub URLs) transparently.

---

## nextjs-fullstack Template

**File:** `templates/projects/web/nextjs-fullstack/template.yaml`

### Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16.x (App Router, standalone output) |
| Language | TypeScript 5 (strict) |
| Styling | Tailwind CSS v4 + shadcn/ui |
| State | Zustand v5 |
| API | tRPC v11 + TanStack Query v5 |
| Auth | NextAuth v5 (GitHub + Google OAuth) |
| ORM | Prisma v7 (PostgreSQL only) |
| Testing | Vitest v3 |
| Package manager | pnpm |
| Node version | 22 |

### Supported Deployment Targets

| Target | Database Options | CI/CD |
|--------|-----------------|-------|
| `k8s-selfhosted` | None, PostgreSQL (CNPG) | GitHub Actions → GHCR → ArgoCD Image Updater |
| `ecs` | None, PostgreSQL (RDS) | GitHub Actions → ECR → ECS force deploy |
| `app-runner` | None, PostgreSQL (RDS) | GitHub Actions → ECR → App Runner update |

> **MySQL is not supported.** The Next.js skeleton uses the `@prisma/adapter-pg` PostgreSQL adapter. Selecting a different database would require a different skeleton.

### Catalog Annotations Generated

For `k8s-selfhosted`:
```yaml
annotations:
  backstage.io/kubernetes-id: <appName>
  backstage.io/kubernetes-namespace: <appName>-<env>
  argocd/app-name: <appName>-<env>
  argocd/app-namespace: devtroncd
```

For `ecs` and `app-runner`:
```yaml
annotations:
  aws/ecs-service: <appName>-<env>     # ECS only
  aws/app-runner-service: <appName>    # App Runner only
```

### K8s Runtime Secrets

The K8s target generates a `k8s/secret.yaml` with instructions. Before the app can start, create the secret manually:

```bash
kubectl create secret generic <appName>-secrets \
  --namespace <appName>-<env> \
  --from-literal=database-url='postgresql://user:pass@host:5432/db' \
  --from-literal=auth-secret="$(openssl rand -base64 32)" \
  --from-literal=auth-github-id='your-github-oauth-client-id' \
  --from-literal=auth-github-secret='your-github-oauth-client-secret' \
  --from-literal=auth-google-id='your-google-oauth-client-id' \
  --from-literal=auth-google-secret='your-google-oauth-client-secret' \
  --kubeconfig ~/.kube/config-talos
```

### ECS Runtime Secrets

The ECS target references secrets from AWS Secrets Manager automatically. Create them before deploying:

```
/<appName>/<env>/database-url
/<appName>/<env>/auth-secret
/<appName>/<env>/auth-github-id
/<appName>/<env>/auth-github-secret
/<appName>/<env>/auth-google-id
/<appName>/<env>/auth-google-secret
/<appName>/<env>/app-url
```

---

## CI/CD Workflows

### K8s target — `.github/workflows/deploy.yml`

Triggers on push to `main`. Builds Docker image, pushes to GHCR (`ghcr.io/<owner>/<repo>`), then ArgoCD Image Updater automatically picks up the new tag and rolls out.

No manual ArgoCD sync step needed — Image Updater is configured with `newest-build` strategy.

**Required GitHub repo secrets:** None — uses `GITHUB_TOKEN` (auto-provided).

### ECS / App Runner target — `.github/workflows/deploy.yml`

Triggers on push to `main`. Uses AWS OIDC (no long-lived AWS credentials needed).

**Required GitHub repo secrets:**
| Secret | Description |
|--------|-------------|
| `AWS_ROLE_ARN` | IAM role ARN with ECR push + ECS/App Runner deploy permissions |
| `AWS_REGION` | AWS region (e.g. `us-west-2`) |
| `ECS_CLUSTER` | ECS cluster name (ECS only) |
| `APP_RUNNER_SERVICE_ARN` | App Runner service ARN (App Runner only) |

### Framework CI — `.github/workflows/ci.yml`

Runs on every push to `main` and every pull request. Covers: install → Prisma generate → DB schema push → lint → typecheck → test → build.

No secrets required — uses hardcoded CI values for `DATABASE_URL`, `AUTH_SECRET`, `NEXT_PUBLIC_APP_URL`. A PostgreSQL service container is spun up automatically.

---

## Documentation Template

**File:** `templates/documentation/template.yaml` (in this repo, not engineering-standards)

Registers an existing docs repo in the Engineering Hub, or scaffolds a new documentation site.

### Modes

| Mode | Action | What happens |
|------|--------|-------------|
| **Register** | `register` | Opens a PR adding `catalog-info.yaml` to an existing repo |
| **Create → existing repo** | `create` + `existing` | Opens a PR adding the doc skeleton + `catalog-info.yaml` |
| **Create → new repo** | `create` + `new` | Creates a new GitHub repo, pushes skeleton, auto-registers in catalog |

### Supported Formats

| Format | Description |
|--------|-------------|
| `mkdocs` | Markdown, simple and widely used |
| `nextra` | MDX, supports React components |
| `docusaurus` | MDX + versioning, ideal for open-source style docs |

### Skeleton Layout

```
templates/documentation/
├── template.yaml
└── skeleton/
    ├── register/          # catalog-info.yaml only (register flow)
    ├── common/            # catalog-info.yaml + README (create flow)
    ├── mkdocs/            # mkdocs.yml + docs/index.md
    ├── nextra/            # next.config.js + pages/index.mdx
    └── docusaurus/        # docusaurus.config.js + docs/intro.md
```

### Custom Actions Used

| Action | Purpose |
|--------|---------|
| `fetch:template` | Render skeleton files with template values |
| `publish:github` | Create new repo (create → new flow) |
| `publish:github:pull-request` | Open PR into existing repo |
| `catalog:register` | Auto-register in Backstage catalog (create → new flow) |

---

## Custom Scaffolder Actions (Backend)

These are registered in `packages/backend/src/plugins/scaffolder-actions-module.ts`.

### `catalog:fetch-entity-info`

Reads entity annotations from the catalog to auto-populate template fields (repo owner/name, container port, owner, description). Eliminates manual re-entry.

```yaml
- id: fetch-entity
  action: catalog:fetch-entity-info
  input:
    entityRef: ${{ parameters.entityRef }}
# outputs: repoOwner, repoName, containerPort, owner, description
```

Requires `github.com/project-slug` annotation on the entity. Falls back to `backstage.io/source-location`.

### `infra:tofu-apply`

Runs `tofu init + apply` (or `destroy`) directly in the scaffolder workspace. Used by infra templates to provision infrastructure without waiting for GitHub Actions.

```yaml
- id: tofu-apply
  action: infra:tofu-apply
  input:
    workingDir: infra/
    autoApprove: true
    vars:
      aws_region: us-west-2
# output: outputs (record of tofu output values)
```

**Requirements:** OpenTofu installed in the backend environment; AWS credentials via env vars or instance profile.

**Security:** Only `AWS_*` and `TF_*` env vars are passed to the subprocess — backend secrets (DB passwords, OAuth secrets) are not exposed. `workingDir` is validated against the workspace root to prevent path traversal.

### `github:repo:set-secret`

Sets `GH_PAT` as a GitHub Actions secret on a newly scaffolded repo, enabling CI/CD to push to GHCR.

```yaml
- id: set-cr-pat
  action: github:repo:set-secret
  input:
    repoOwner: ${{ parameters.repoOrg }}
    repoName: ${{ parameters.repoName }}
```

Prefers `GHCR_TOKEN` (packages:write scope only) over `GITHUB_TOKEN`. Retries up to 8× with 5s delay while GitHub Actions API initializes on new repos.

---

## Deployment Targets API

**Plugin:** `scaffolder-targets` (`packages/backend/src/plugins/scaffolderTargetsApi.ts`)

Exposes `GET /api/scaffolder-targets/targets?framework=<framework>` — returns deployment targets from `app-config.yaml`, optionally filtered by framework compatibility.

Used by the `DeploymentTargetPicker` custom field extension in the frontend.

Requires authentication (no unauthenticated access). Config path: `scaffolder.targets.kubernetes[]` and `scaffolder.targets.aws[]`.

---

## Task Page Step Filtering

The `CustomTaskPage` (`packages/app/src/components/scaffolder/CustomTaskPage.tsx`) filters which steps are shown to the user:

```typescript
.filter(step => !step.id.startsWith('resolve-') && !step.id.startsWith('fetch-'))
```

| Prefix | Reason hidden |
|--------|--------------|
| `resolve-` | Internal URL resolution steps (e.g. `resolve-skeleton-url`) |
| `fetch-` | Internal skeleton fetching steps (e.g. `fetch-common`, `fetch-mkdocs`) |

Only user-visible steps like `create-repo`, `register`, `deploy-argocd`, `set-cr-pat` are shown.

---

## Adding a New Template

1. Create skeleton layer(s) in `engineering-standards/templates/skeletons/`
2. Create the template YAML in `engineering-standards/templates/projects/`
3. Test locally: run `pnpm install && pnpm lint && pnpm typecheck && pnpm build` in the skeleton directory before running the template
4. Run the template in Backstage (dev mode) with a test name
5. Verify: CI passes, Docker build succeeds, ArgoCD syncs (for K8s target), pod starts
6. Cleanup: delete GitHub repo + ArgoCD app (patch finalizers first) + K8s namespace + unregister catalog entity
7. Commit both repos only after end-to-end test confirms working

---

## Cleanup Procedure (After Testing)

Always delete all 4 traces after a test run:

```bash
# 1. GitHub repo (list first to get exact name)
gh repo list strat-main-team --limit 20
gh repo delete strat-main-team/<name> --yes

# 2. ArgoCD application (patch finalizers first to unblock deletion)
kubectl patch application <appName>-<env> -n devtroncd \
  --kubeconfig ~/.kube/config-talos \
  --type json -p '[{"op":"remove","path":"/metadata/finalizers"}]'
kubectl delete application <appName>-<env> -n devtroncd \
  --kubeconfig ~/.kube/config-talos

# 3. Kubernetes namespace
kubectl delete namespace <appName>-<env> --kubeconfig ~/.kube/config-talos

# 4. Backstage catalog entity — unregister manually via the Backstage UI
#    (entity page → three-dot menu → Unregister entity)
```

---

## Lessons Learned

| # | Lesson |
|---|--------|
| 1 | `next lint` was removed in Next.js 16 — use `eslint <dirs>` directly in `package.json` scripts |
| 2 | `eslint-config-next` 16 has native flat config exports — do NOT use `FlatCompat`, import directly with `import nextConfig from "eslint-config-next/core-web-vitals"` |
| 3 | `prisma generate` must run before `next build` in Docker — add `RUN pnpm db:generate` before `RUN pnpm build` in the builder stage |
| 4 | ArgoCD Application finalizer `resources-finalizer.argocd.argoproj.io` blocks deletion when the app is stuck terminating — always patch finalizers before deleting |
| 5 | `catalog:register` returns 409 if the location is already registered from a previous run — use `optional: true` |
| 6 | ArgoCD is in `devtroncd` namespace (not `argocd`) — all ArgoCD manifests and annotations must use `devtroncd` |
| 7 | Backstage config arrays require `getOptionalConfigArray()` not `getOptionalString('path.0.key')` — numeric path segments are not supported |
| 8 | The `catalog` skeleton must run last in the template step order — it overwrites any `catalog-info.yaml` from framework or target skeletons |
| 9 | GitHub Actions expressions (`${{ github.actor }}`) inside Backstage scaffolder templates must be double-escaped: `${{ '${{ github.actor }}' }}` |
| 10 | App Runner uses `nodejs22` runtime — `nodejs18` is mismatched with the skeleton's `.nvmrc` (Node 22) |
| 11 | `pnpm db:push` is correct for CI (no migration files); `pnpm db:migrate` is for development only |
| 12 | Backstage scaffolder backend on Node.js 20+ requires `NODE_OPTIONS=--no-node-snapshot` — nunjucks template engine conflicts with V8 snapshot changes in Node 20. Set this env var on the backend deployment. |
| 13 | Template step IDs prefixed with `fetch-` or `resolve-` are internal plumbing — they are filtered out of the `CustomTaskPage` UI. Keep user-visible steps named without these prefixes. |
