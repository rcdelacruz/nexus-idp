# Deployment Operations

**Date:** 2026-04-06
**Status:** Active

Operational guide for deploying and maintaining the Nexus IDP k8s homelab instance.

---

## Deployment Targets

| Target | URL | Trigger |
|--------|-----|---------|
| **k8s homelab (Talos)** | `https://backstage.coderstudio.co` | `bash scripts/deploy.sh` |
| **AWS ECS Fargate** | `https://portal.stratpoint.io` | ECR push + `tofu apply` |

---

## k8s Homelab Deploy

```bash
bash scripts/deploy.sh
```

The script:
1. `git pull origin develop`
2. `yarn workspace app build && yarn build:backend`
3. `docker build . -f Dockerfile.with-migrations --squash --tag 192.168.2.101:5000/backstage:latest`
4. `docker push 192.168.2.101:5000/backstage:latest`
5. `kubectl apply -f k8s-manifests/backstage-deployment.yaml`
6. `kubectl rollout restart deployment/backstage -n backstage`
7. Health check via `curl`

---

## Deployment Manifest

The authoritative deployment spec is `k8s-manifests/backstage-deployment.yaml`. This file is applied on every `deploy.sh` run (`kubectl apply`).

**To change env vars, resource limits, or init containers** — edit `k8s-manifests/backstage-deployment.yaml` and commit. Do not use `kubectl set env` or `kubectl patch` directly, as those changes are not persisted to the repo.

---

## Dockerfile.with-migrations Rules

`Dockerfile.with-migrations` extends `FROM 192.168.2.101:5000/backstage:latest` (itself). This causes layer accumulation — every build adds layers on top of the previous image.

### Mandatory: always build with `--squash`

```bash
docker build . -f Dockerfile.with-migrations --squash --tag 192.168.2.101:5000/backstage:latest
```

Without `--squash`, the image accumulates layers across every deploy. At ~452 layers the overlay2 filesystem hits the mount options length limit (~4096 bytes) and pods crash with:
```
mount options is too long
```

### Mandatory: `WORKDIR /app` must be explicit

`--squash` flattens the image to a single layer and loses all metadata inherited from the base image (WORKDIR, ENV). Without an explicit `WORKDIR /app` in `Dockerfile.with-migrations`, Node.js starts in `/` and fails:
```
Error: Cannot find module '/packages/backend'
```

The `WORKDIR /app` line must appear immediately after `FROM`.

### Mandatory: copy `packages/backend/config.d.ts`

Backstage's config schema loader reads `packages/backend/config.d.ts` at startup. This file is **not** included in `packages/backend/dist/bundle.tar.gz`. Without it:
```
Error: Invalid schema in packages/backend/config.d.ts, missing Config export
```

The Dockerfile must include:
```dockerfile
COPY --chown=node:node packages/backend/config.d.ts /app/packages/backend/config.d.ts
```

---

## Required Environment Variables

### Cluster Secret (`backstage-secrets`)

| Key | Description |
|-----|-------------|
| `POSTGRES_PASSWORD` | PostgreSQL password |
| `GITHUB_TOKEN` | GitHub PAT (catalog autodiscovery, engineering-docs) |
| `AUTH_GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `AUTH_GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `AUTH_GITHUB_CLIENT_ID` | GitHub OAuth client ID |
| `AUTH_GITHUB_CLIENT_SECRET` | GitHub OAuth client secret |
| `BACKEND_SECRET` | 32-byte hex string (`node -p 'require("crypto").randomBytes(32).toString("hex")'`) |
| `ARGOCD_AUTH_TOKEN` | ArgoCD API token |
| `REDIS_URL` | Redis connection URL |
| `GHCR_TOKEN` | GitHub token with `packages:write` scope (for scaffolder `set-cr-pat` action) |

### Deployment Env Vars (in `backstage-deployment.yaml`)

| Variable | Value | Why |
|----------|-------|-----|
| `NODE_OPTIONS` | `--no-node-snapshot` | Required for scaffolder nunjucks engine on Node.js 20+ |
| `APP_CONFIG_backend_listen_port` | `7007` | Backend listen port |
| `APP_BASE_URL` | `https://backstage.coderstudio.co` | Frontend base URL |

---

## Troubleshooting

### `mount options is too long`

Image has too many layers (>~450). Rebuild with `--squash`:
```bash
docker build . -f Dockerfile.with-migrations --squash --tag 192.168.2.101:5000/backstage:latest
```

### `Cannot find module '/packages/backend'`

`WORKDIR` lost after squash. Verify `Dockerfile.with-migrations` has `WORKDIR /app` after the `FROM` line.

### `Invalid schema in packages/backend/config.d.ts, missing Config export`

`config.d.ts` not in image. Verify the Dockerfile has:
```dockerfile
COPY --chown=node:node packages/backend/config.d.ts /app/packages/backend/config.d.ts
```

### `NODE_OPTIONS=--no-node-snapshot` error in scaffolder

Scaffolder backend requires this flag on Node.js 20+. Verify `k8s-manifests/backstage-deployment.yaml` has:
```yaml
- name: NODE_OPTIONS
  value: --no-node-snapshot
```

### Migration lock (`Migration table is already locked`)

Multiple pods raced to run migrations. Fix:
```sql
DELETE FROM knex_migrations_lock;
INSERT INTO knex_migrations_lock (index, is_locked) VALUES (1, 0);
```
Run against the affected plugin DB (e.g. `backstage_plugin_auth`). See `CLAUDE.md` for full kubectl commands.

---

## React Import Rule for Frontend Plugins

Backstage uses the **classic JSX runtime** — `React` must be in scope in every `.tsx` file. Always use:

```typescript
import React, { useState, useEffect } from 'react';
```

Never remove the `React` default import. Doing so causes `ReferenceError: React is not defined` at runtime even though TypeScript and lint pass.

After any bulk lint-fix run, verify no `.tsx` files lost their React import:
```bash
grep -rL "import React" plugins/*/src --include="*.tsx"
```
