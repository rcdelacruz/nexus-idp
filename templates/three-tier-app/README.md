# 3-Tier Application Template

Scaffolds a production-ready 3-tier application deployed to Kubernetes via ArgoCD.

## What It Creates

| Component | Technology | Details |
|-----------|-----------|---------|
| Frontend | React 19 + Vite 6 + TypeScript | SPA with dark/light mode, CRUD demo UI |
| Backend | Express 5 + TypeScript + Knex | REST API with Zod validation, Pino logging, health endpoints |
| Database | CloudNativePG PostgreSQL | HA cluster with WAL backup to MinIO, PgBouncer pooler |
| CI/CD | GitHub Actions | Test → build → push to GHCR on every push to main |
| GitOps | ArgoCD + Kustomize | Auto-sync from k8s/overlays/<env> with per-environment scaling |
| Ingress | Traefik | Auto-configured hostname via `SCAFFOLDER_INGRESS_DOMAIN` |
| Catalog | Backstage | System + Frontend Component + Backend Component + Database Resource |

## Prerequisites

### One-Time Platform Setup

These are configured once by the platform admin. Scaffolded apps inherit them automatically.

#### 1. Kubernetes Cluster

- CNPG operator installed (`cnpg-system` namespace)
- Traefik ingress controller with MetalLB (or any LB providing external IP)
- Longhorn storage class (for CNPG persistent volumes)
- MinIO or S3-compatible storage for WAL backups
- Secret `cnpg-minio-creds` in `default` namespace:
  ```yaml
  apiVersion: v1
  kind: Secret
  metadata:
    name: cnpg-minio-creds
    namespace: default
  stringData:
    ACCESS_KEY_ID: <minio-access-key>
    ACCESS_SECRET_KEY: <minio-secret-key>
  ```

#### 2. ArgoCD

- Running in `devtroncd` namespace
- GitHub repo credentials for cloning private repos:
  ```yaml
  apiVersion: v1
  kind: Secret
  metadata:
    name: github-repo-creds
    namespace: devtroncd
    labels:
      argocd.argoproj.io/secret-type: repo-creds
  stringData:
    type: git
    url: https://github.com/<github-org>
    password: <github-pat>
    username: argocd
  ```

#### 3. Backstage Environment Variables (`.env`)

```bash
# Already exists — used by all GitHub integrations
GITHUB_TOKEN=ghp_...

# Ingress domain for scaffolded apps
# nip.io:     <traefik-external-ip>.nip.io  (zero-config, auto-resolves)
# Custom:     apps.yourdomain.com           (requires DNS A record → traefik IP)
# Tailscale:  apps.your-tailnet.ts.net      (requires MagicDNS)
# Cloudflare: apps.yourdomain.com           (requires tunnel config)
SCAFFOLDER_INGRESS_DOMAIN=192.168.2.210.nip.io
```

#### 4. Backstage `app-config.yaml`

The scaffolder reads `SCAFFOLDER_INGRESS_DOMAIN` from config:
```yaml
scaffolder:
  ingressDomain: ${SCAFFOLDER_INGRESS_DOMAIN}
```

Already configured — no action needed if `.env` is set.

#### 5. Kubeconfig Access

The Backstage backend needs cluster access for the `kubernetes:apply` and `kubernetes:create-pull-secret` scaffolder actions:

- **Local dev:** `~/.kube/config-talos` or `KUBECONFIG` env var
- **In-cluster (K8s pod):** Service account with permissions to create namespaces, secrets, and ArgoCD Applications
- **ECS/external:** Kubeconfig mounted via secrets

## Scaffolder Flow

```
User fills template form in Nexus IDP
    │
    ├─ 1. Discover ingress domain (from SCAFFOLDER_INGRESS_DOMAIN)
    ├─ 2. Generate project files from skeleton
    ├─ 3. Create private GitHub repo
    ├─ 4. Set GH_PAT secret on repo (for GHCR push in CI)
    ├─ 5. Push generated code to repo
    ├─ 6. Create GHCR pull secret in K8s namespace
    ├─ 7. Apply ArgoCD Application manifest to cluster
    └─ 8. Register entities in Backstage catalog
              │
              ▼
GitHub Actions CI triggers automatically
    ├─ Test frontend (npm install + build)
    ├─ Test backend (npm install + build + test)
    └─ Build & push Docker images to GHCR
              │
              ▼
ArgoCD detects new Application
    ├─ Syncs Kustomize overlay (k8s/overlays/<env>)
    ├─ Creates namespace
    ├─ Deploys frontend (nginx + React SPA)
    ├─ Deploys backend (Express + init-container for DB migration)
    ├─ Creates CNPG PostgreSQL cluster + PgBouncer pooler
    └─ Configures Traefik ingress
              │
              ▼
App accessible at <appName>-<env>.<ingressDomain>
API accessible at api.<appName>-<env>.<ingressDomain>
```

## Custom Scaffolder Actions

These are registered in `packages/backend/src/plugins/scaffolder-actions-module.ts`:

| Action ID | File | Purpose |
|-----------|------|---------|
| `kubernetes:apply` | `scaffolder/actions/kubernetesApply.ts` | Applies K8s manifests via K8s API (supports SA token, kubeconfig, client certs) |
| `kubernetes:create-pull-secret` | `scaffolder/actions/createPullSecret.ts` | Creates GHCR docker-registry secret in a namespace |
| `kubernetes:get-ingress-domain` | `scaffolder/actions/getIngressDomain.ts` | Reads `SCAFFOLDER_INGRESS_DOMAIN` from env |
| `github:repo:set-secret` | `scaffolder/actions/setRepoSecret.ts` | Sets `GH_PAT` repo secret for CI GHCR access |

All actions support:
- Local dev (kubeconfig file with client cert auth)
- In-cluster (mounted SA token)
- External (KUBECONFIG env var)

## Environment Scaling

| Setting | Dev | Staging | Prod |
|---------|-----|---------|------|
| Frontend replicas | 1 | 2 | 3 |
| Backend replicas | 1 | 2 | 3 |
| DB instances | 1 | 2 (1 standby) | 3 (HA) |
| DB storage | 1Gi | 5Gi | 25Gi |
| Frontend CPU | 25m–200m | 50m–200m | 100m–500m |
| Backend CPU | 50m–500m | 100m–500m | 200m–1000m |

## App URLs

| Environment | Frontend | API |
|-------------|----------|-----|
| Dev | `<app>-dev.<domain>` | `api.<app>-dev.<domain>` |
| Staging | `<app>-staging.<domain>` | `api.<app>-staging.<domain>` |
| Prod | `<app>.<domain>` | `api.<app>.<domain>` |

## ArgoCD Image Updater (Auto-Deploy)

ArgoCD Image Updater runs in the cluster and watches GHCR for new image builds. When CI pushes a new image, Image Updater detects it within 2 minutes and automatically updates the deployment — no manual rollout or commit-back needed.

### How It Works
1. CI pushes `ghcr.io/<org>/<repo>-frontend:<sha>` and `ghcr.io/<org>/<repo>-backend:<sha>`
2. Image Updater polls GHCR, detects new SHA tag
3. Image Updater patches the ArgoCD Application with the new image override
4. ArgoCD syncs the change → pods restart with new image

### Configuration
The ArgoCD Application has these annotations:
```yaml
annotations:
  argocd-image-updater.argoproj.io/image-list: >-
    frontend=ghcr.io/<org>/<repo>-frontend,
    backend=ghcr.io/<org>/<repo>-backend
  argocd-image-updater.argoproj.io/frontend.update-strategy: newest-build
  argocd-image-updater.argoproj.io/backend.update-strategy: newest-build
  argocd-image-updater.argoproj.io/write-back-method: argocd
```

### Prerequisites (one-time cluster setup)
- ArgoCD Image Updater installed in `devtroncd` namespace
- GHCR credentials in `argocd-image-updater-secret`
- ClusterRole/ClusterRoleBinding for the image updater service account

## ArgoCD + CNPG Integration

CNPG mutates the Cluster spec/status after creation, causing perpetual OutOfSync in ArgoCD. The Application uses `ignoreDifferences` to handle this:

```yaml
ignoreDifferences:
  - group: postgresql.cnpg.io
    kind: Cluster
    jqPathExpressions:
      - .spec
      - .status
```

Do NOT use `ServerSideApply` with CNPG — it causes `terminatingReplicas: field not declared in schema` errors.

## Skeleton Structure

```
skeleton/
├── frontend/                   # React + Vite
│   ├── src/App.tsx             # CRUD demo with search, pagination, dark/light
│   ├── Dockerfile              # Multi-stage → nginx
│   └── nginx.conf              # SPA routing + /api/ proxy to backend
├── backend/                    # Express + TypeScript
│   ├── src/
│   │   ├── index.ts            # Server with graceful shutdown
│   │   ├── routes/health.ts    # /health, /ready, /live
│   │   ├── routes/items.ts     # CRUD with Zod validation + pagination
│   │   ├── middleware/         # Error handler, Pino logger
│   │   └── db/                 # Knex connection + config
│   ├── migrations/             # 001_create_items.ts (with seed data)
│   └── Dockerfile              # Multi-stage → tini + non-root user
├── k8s/
│   ├── base/                   # Kustomize base
│   │   ├── kustomization.yaml
│   │   ├── namespace.yaml
│   │   ├── frontend/           # Deployment + Service + Ingress
│   │   ├── backend/            # Deployment (init migrate) + Service + Ingress
│   │   └── database/           # CNPG Cluster + PgBouncer Pooler
│   ├── overlays/               # Environment patches
│   │   ├── dev/
│   │   ├── staging/
│   │   └── prod/
│   └── argocd-application.yaml
├── .github/workflows/ci.yaml   # Test + build + push to GHCR
├── catalog-info.yaml           # Backstage entities
├── .env.example
└── README.md
```

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `ImagePullBackOff` | GHCR pull secret missing | Check `ghcr-pull-secret` in namespace — scaffolder creates it automatically |
| `ImagePullBackOff` | CI hasn't pushed images | Wait for GitHub Actions to complete |
| `write_package` denied in CI | `GH_PAT` secret not set | Scaffolder sets it automatically — check Actions secrets on the repo |
| ArgoCD `ComparisonError` | Can't clone private repo | Add `github-repo-creds` secret in `devtroncd` namespace |
| ArgoCD `OutOfSync` on CNPG | CNPG mutates spec | Fixed via `ignoreDifferences` in argocd-application.yaml |
| `terminatingReplicas` schema error | ServerSideApply + CNPG | Don't use `ServerSideApply` — use `RespectIgnoreDifferences` only |
| 404 on `/api/*` | nginx strips prefix | `proxy_pass` must NOT have trailing `/` |
| Backend `CrashLoopBackOff` | DB not ready | Check CNPG cluster status, `cnpg-minio-creds` secret |
| DNS not resolving | No DNS record | Use nip.io (`<ip>.nip.io`) or configure DNS |
| `npm ci` fails in Docker | No lock file | Dockerfiles use `npm install` (scaffolder doesn't generate lock files) |

## Known Limitations

1. **Single backend language:** Currently only Node.js/Express. Python (FastAPI) and Go (Gin) are template parameters but not implemented in the skeleton.
2. **No TLS:** Ingress uses HTTP only. Add cert-manager + Let's Encrypt for HTTPS.
3. **No HPA:** Horizontal Pod Autoscaler not configured. Static replica counts per environment.
4. **CNPG backup assumes MinIO:** Backup config hardcodes MinIO endpoint. Adapt for S3/GCS.
5. **nip.io only works on local network:** For external access, use a real domain with DNS.
