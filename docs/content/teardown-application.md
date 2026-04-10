# Teardown Application

This document covers how to safely delete a Backstage-generated application and all its associated resources.

---

## Overview

The teardown script (`scripts/teardown.sh`) discovers and deletes every resource created by a scaffolder template:

- Kubernetes namespace and all resources inside it (deployments, services, CNPG cluster, PVCs)
- ArgoCD applications (across all namespaces)
- GitHub repository
- Backstage catalog entities

**Default mode is dry-run — nothing is deleted unless you pass `--execute`.**

---

## Prerequisites

| Tool | Purpose |
|------|---------|
| `kubectl` | K8s + ArgoCD resource deletion |
| `gh` (GitHub CLI) | GitHub repo deletion |
| `curl` + `jq` | Backstage catalog API calls |

You also need a `BACKSTAGE_SCRIPT_TOKEN` to unregister catalog entities. See [Static Token Setup](#static-token-setup) below.

---

## Usage

```bash
# Dry-run — safe, shows what would be deleted
bash scripts/teardown.sh <app-name>

# Full teardown including catalog unregistration
bash scripts/teardown.sh <app-name> --execute --token <BACKSTAGE_SCRIPT_TOKEN>

# Keep the GitHub repo (delete infra only)
bash scripts/teardown.sh <app-name> --execute --keep-repo --token <BACKSTAGE_SCRIPT_TOKEN>

# Keep S3/database backups
bash scripts/teardown.sh <app-name> --execute --keep-backups --token <BACKSTAGE_SCRIPT_TOKEN>
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `--execute` | off | Actually delete resources. Omit for dry-run. |
| `--keep-repo` | off | Skip GitHub repository deletion |
| `--keep-backups` | off | Skip S3 / CNPG backup deletion reminder |
| `--backstage-url` | `https://backstage.coderstudio.co` | Backstage base URL |
| `--token TOKEN` | — | Static script token for catalog API access |

---

## What Gets Discovered

The script never assumes environment names, ArgoCD namespaces, or GitHub org. It discovers everything from the live cluster:

1. **Namespaces** — `kubectl get namespaces` filtered by `<app-name>-*`
2. **ArgoCD apps** — `kubectl get application --all-namespaces` filtered by app name
3. **GitHub repo** — checks catalog annotation `github.com/project-slug`, then searches known orgs
4. **Catalog entities** — two-pass query: first by `github.com/project-slug` annotation (finds Component), then by `backstage.io/managed-by-origin-location` from that entity (finds co-located System, API, Resource entities)

---

## Deletion Order

Resources are deleted in dependency order to prevent deadlocks:

```
1. Suspend ArgoCD auto-sync (prevents re-creation during teardown)
2. Delete in-namespace ArgoCD apps first (have resources-finalizer — must complete before namespace delete)
3. Delete central ArgoCD apps (devtroncd namespace)
4. Delete Kubernetes namespaces (cascades pods, services, CNPG, PVCs)
   └── If namespace hangs >60s: auto-patch stuck PVC, CNPG, and ArgoCD finalizers
5. Delete GitHub repository
6. Unregister Backstage catalog entities
7. Delete S3 / MinIO CNPG WAL backups (using credentials extracted in Phase 1)
```

---

## Safety Mechanisms

- **Dry-run by default** — must pass `--execute` to delete anything
- **App name confirmation** — must type the exact app name before execution begins
- **Database confirmation** — if a CNPG cluster is found, must separately type `delete my data`
- **Idempotent** — 404 / not-found on any resource is treated as success, not an error. Safe to re-run if a previous attempt failed partway through.
- **RBAC** — the `BACKSTAGE_SCRIPT_TOKEN` has subject `teardown-script`; all calls are audited

---

## Static Token Setup

The script uses a static external access token to authenticate with the Backstage catalog API. This is configured in `app-config.yaml`:

```yaml
backend:
  auth:
    externalAccess:
      - type: static
        options:
          token: ${BACKSTAGE_SCRIPT_TOKEN}
          subject: teardown-script
```

The token is stored in the `backstage-secrets` k8s secret. To retrieve it for use in the script:

```bash
kubectl get secret backstage-secrets -n backstage \
  -o jsonpath='{.data.BACKSTAGE_SCRIPT_TOKEN}' | base64 -d
```

To rotate the token:

```bash
NEW_TOKEN=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
kubectl patch secret backstage-secrets -n backstage \
  --type='json' \
  -p="[{\"op\":\"replace\",\"path\":\"/data/BACKSTAGE_SCRIPT_TOKEN\",\"value\":\"$(echo -n $NEW_TOKEN | base64 -w 0)\"}]"
# Then redeploy Backstage to pick up the new token
bash scripts/deploy.sh
```

---

## Running the Script

```bash
# Get the token
TOKEN=$(kubectl get secret backstage-secrets -n backstage \
  -o jsonpath='{.data.BACKSTAGE_SCRIPT_TOKEN}' | base64 -d)

# Dry-run (on-prem — backstage.coderstudio.co is the default)
bash scripts/teardown.sh my-app --token "$TOKEN"

# Execute
bash scripts/teardown.sh my-app --execute --token "$TOKEN"
```

For production (`portal.stratpoint.io`), pass the URL explicitly:

```bash
bash scripts/teardown.sh my-app --execute \
  --backstage-url https://portal.stratpoint.io \
  --token "$TOKEN"
```

---

## After Teardown

The script automatically deletes S3/MinIO CNPG WAL backups using credentials extracted from the cluster spec during discovery (before namespace deletion). Pass `--keep-backups` to skip this.

The following are **not** automatically cleaned up:

- **GHCR container images** — delete from GitHub → Packages
- **GitHub Actions workflow history** — stays in GitHub, harmless

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Namespace stuck in Terminating | PVC or CNPG finalizer deadlock | Script auto-patches after 60s (PVCs, CNPG clusters, ArgoCD apps); or patch manually: `kubectl patch pvc <name> -n <ns> -p '{"metadata":{"finalizers":[]}}' --type=merge` |
| 401 on catalog API | Wrong or expired token | Re-run token retrieval command above |
| GitHub repo not found | Different org or already deleted | Script warns and continues |
| ArgoCD app not deleted | ArgoCD controller unreachable | Delete manually: `kubectl delete application <name> -n <ns>` |
| Catalog entity not unregistered | No `--token` passed | Re-run with `--token` or unregister from Backstage UI |
