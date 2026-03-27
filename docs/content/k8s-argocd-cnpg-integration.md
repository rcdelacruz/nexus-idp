# K8s + ArgoCD + CNPG Integration

**Date:** 2026-03-22
**Status:** Complete and deployed
**Backstage version:** 1.49.1

---

## Overview

This document covers the full setup of three integrations into the Backstage IDP:

1. **Kubernetes plugin** — shows live K8s resources (pods, deployments, ingresses) on entity pages
2. **ArgoCD plugin** — shows deployment history and sync status on entity overview pages
3. **CNPG resources in catalog** — models PostgreSQL databases as `Resource` entities
4. **3-tier app Software Template** — scaffolds a complete frontend + backend + CNPG database with GitOps via ArgoCD

---

## Cluster Context

| Detail | Value |
|--------|-------|
| Cluster | Talos homelab (`talos-homelab`) |
| Control plane | `192.168.2.198` |
| Worker | `192.168.2.199` |
| Backstage namespace | `backstage` |
| Backstage image registry | `192.168.2.101:5000` |
| Backstage Dockerfile | `Dockerfile.with-migrations` |
| ArgoCD location | Embedded in Devtron — `devtroncd` namespace |
| CNPG cluster | `postgres-cluster` in `default` namespace |

---

## What Was Already in Place (Before This Work)

These were already installed and wired — no code changes needed:

| Plugin | Package | Location |
|--------|---------|----------|
| Kubernetes backend | `@backstage/plugin-kubernetes-backend` | `packages/backend/src/index.ts:58` |
| Kubernetes frontend | `@backstage/plugin-kubernetes` | `packages/app/package.json` |
| ArgoCD frontend | `@roadiehq/backstage-plugin-argo-cd ^2.8.6` | `packages/app/package.json` |
| `EntityKubernetesContent` | wired in `EntityPage.tsx` | for `service` and `website` types |
| `EntityArgoCDHistoryCard` | wired in `EntityPage.tsx` | in `overviewContent` (all types) |

The only things missing were **configuration** and the **K8s ServiceAccount credentials**.

---

## Step 1: Kubernetes Plugin

### 1a. Create the ServiceAccount and RBAC

**Created** `k8s-manifests/backstage-k8s-reader.yaml` — a dedicated ServiceAccount with read-only cluster access covering pods, deployments, services, ingresses, statefulsets, daemonsets, jobs, HPAs, PVCs, metrics, and CNPG cluster resources.

**Apply to cluster (one-time):**
```bash
kubectl apply -f k8s-manifests/backstage-k8s-reader.yaml
```

This creates:
- `ServiceAccount/backstage-k8s-reader` in `backstage` namespace
- `ClusterRole/backstage-k8s-reader`
- `ClusterRoleBinding/backstage-k8s-reader`
- `Secret/backstage-k8s-reader-token` — long-lived token (required for Kubernetes 1.24+ static SA tokens)

### 1b. Extract credentials and add to backstage-secrets

```bash
# K8S_SA_TOKEN — decoded service account JWT
kubectl get secret backstage-k8s-reader-token -n backstage \
  -o jsonpath='{.data.token}' | base64 -d

# K8S_SA_CA_DATA — base64-encoded CA cert (keep as-is, do NOT decode)
kubectl get secret backstage-k8s-reader-token -n backstage \
  -o jsonpath='{.data.ca\.crt}'

# Add both to backstage-secrets in one command:
kubectl patch secret backstage-secrets -n backstage \
  --type=merge \
  -p "{\"data\":{
    \"K8S_SA_TOKEN\":\"$(kubectl get secret backstage-k8s-reader-token -n backstage -o jsonpath='{.data.token}')\",
    \"K8S_SA_CA_DATA\":\"$(kubectl get secret backstage-k8s-reader-token -n backstage -o jsonpath='{.data.ca\.crt}')\"
  }}"
```

> Note: `{.data.token}` is already base64 — it needs decoding for actual use but `kubectl patch` with `data` (not `stringData`) expects base64, so pass it directly.

### 1c. Add to app-config.yaml

Added to both `app-config.yaml` and `app-config.production.yaml`:

```yaml
kubernetes:
  serviceLocatorMethod:
    type: 'multiTenant'
  clusterLocatorMethods:
    - type: 'config'
      clusters:
        - name: talos-homelab
          # In-cluster URL — works because Backstage runs inside the same cluster.
          # If running Backstage externally, use: https://192.168.2.198:6443
          url: https://kubernetes.default.svc
          authProvider: serviceAccount
          serviceAccountToken: ${K8S_SA_TOKEN}
          caData: ${K8S_SA_CA_DATA}
          skipTLSVerify: false
          # false is correct — metrics-server is installed (kubectl top nodes works)
          skipMetricsLookup: false
```

### 1d. How to annotate any catalog component

For the **Kubernetes tab** to appear on an entity page, two things must both be true:

**1. Add to the entity's `catalog-info.yaml`:**
```yaml
metadata:
  annotations:
    backstage.io/kubernetes-id: my-app        # identifies this entity's K8s resources
    backstage.io/kubernetes-namespace: my-ns  # namespace to search in
```

**2. Add the matching label to `spec.template.metadata.labels` in the K8s Deployment:**
```yaml
spec:
  template:
    metadata:
      labels:
        backstage.io/kubernetes-id: my-app   # must match annotation exactly
```

> ⚠️ **Critical:** The label MUST be in `spec.template.metadata.labels`, not in `metadata.labels`. The plugin matches **Pod labels**, not Deployment labels. Pods inherit labels from `spec.template.metadata.labels` only.

**If patching an existing Helm-managed deployment:**
```bash
# CORRECT — patches the pod template so new pods get the label
kubectl patch deployment <name> -n <namespace> --type=strategic -p '{
  "spec": {
    "template": {
      "metadata": {
        "labels": {
          "backstage.io/kubernetes-id": "<value>"
        }
      }
    }
  }
}'

# WRONG — only labels the Deployment resource itself, pods will NOT have the label
kubectl label deployment <name> -n <namespace> backstage.io/kubernetes-id=<value>
```

The `kubectl patch` on the pod template triggers an automatic rolling restart, so no manual rollout needed.

---

## Step 2: ArgoCD Plugin

### Discovery: ArgoCD is inside Devtron

ArgoCD is **not** a standalone install. It runs inside Devtron in the `devtroncd` namespace:

```
devtroncd/argocd-server              ClusterIP 10.106.31.15  ports 80/443
devtroncd/argocd-application-controller-0
devtroncd/argocd-repo-server
devtroncd/argocd-redis
```

The in-cluster URL for ArgoCD is: `https://argocd-server.devtroncd.svc.cluster.local`

> The `argo` namespace contains **Argo Workflows** (workflow-controller), not ArgoCD — these are different products.

### 2a. Get the ArgoCD token

ArgoCD redirects HTTP → HTTPS, so always use `https://` and `-k` (self-signed cert):

```bash
# Get admin password
ARGOCD_PASS=$(kubectl get secret argocd-initial-admin-secret -n devtroncd \
  -o jsonpath='{.data.password}' | base64 -d)

# Port-forward (ArgoCD has no external LoadBalancer)
kubectl port-forward svc/argocd-server 18080:80 -n devtroncd &
sleep 3

# Get JWT — must use https:// not http:// (ArgoCD redirects HTTP to HTTPS with 307)
ARGOCD_TOKEN=$(curl -sk https://localhost:18080/api/v1/session \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"admin\",\"password\":\"${ARGOCD_PASS}\"}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

echo "Token: ${ARGOCD_TOKEN:0:40}..."

# Kill port-forward when done
kill %1
```

### 2b. Add to backstage-secrets

```bash
ARGOCD_URL="https://argocd-server.devtroncd.svc.cluster.local"
ARGOCD_TOKEN="<jwt from above>"

kubectl patch secret backstage-secrets -n backstage \
  --type=merge \
  -p "{\"stringData\":{
    \"ARGOCD_URL\":\"${ARGOCD_URL}\",
    \"ARGOCD_TOKEN\":\"${ARGOCD_TOKEN}\",
    \"ARGOCD_AUTH_TOKEN\":\"argocd.token=${ARGOCD_TOKEN}\"
  }}"
```

| Secret key | Format | Used by |
|-----------|--------|---------|
| `ARGOCD_URL` | `https://argocd-server.devtroncd.svc.cluster.local` | Both proxy and argocd config block |
| `ARGOCD_TOKEN` | bare JWT | `argocd:` config block |
| `ARGOCD_AUTH_TOKEN` | `argocd.token=<JWT>` | proxy `Cookie` header |

### 2c. app-config.yaml additions

Added to both `app-config.yaml` and `app-config.production.yaml`:

```yaml
proxy:
  endpoints:
    '/argocd/api':
      target: ${ARGOCD_URL}
      changeOrigin: true
      secure: false          # ArgoCD uses a self-signed cert
      headers:
        Cookie: ${ARGOCD_AUTH_TOKEN}

argocd:
  appLocatorMethods:
    - type: 'config'
      instances:
        - name: argocd
          url: ${ARGOCD_URL}
          token: ${ARGOCD_TOKEN}
```

> **proxy format:** `@backstage/plugin-proxy-backend ^0.6.11` uses `proxy.endpoints` (not direct paths under `proxy:`).

### 2d. How to annotate components for ArgoCD

```yaml
metadata:
  annotations:
    argocd/app-name: my-app-dev   # must match metadata.name of ArgoCD Application CRD
```

The `isArgocdAvailable` guard hides the ArgoCD card when this annotation is absent.

> ⚠️ **Only add `argocd/app-name` if an actual ArgoCD `Application` CRD with that exact name exists in the cluster.**
> `isArgocdAvailable` only checks for the annotation's presence — it does NOT verify whether the Application CRD exists.
> If the CRD is missing, the card will render and immediately fail with:
> **"Error occurred while fetching data. Cannot get argo location(s) for service"**
>
> **Rule: Never add `argocd/app-name` to Helm-managed components or anything not deployed through ArgoCD.**

#### backstage-portal (2026-03-22 fix)

The `argocd/app-name: backstage` annotation was initially added to `example-org/components/backstage-portal.yaml` but had to be removed. Backstage itself is deployed via Helm, not ArgoCD — no `Application` CRD named `backstage` exists. The annotation caused the ArgoCD card to error on every page load. After removing the annotation, rebuilding the image, and redeploying, the card was hidden correctly.

### Important: No ArgoCD Application CRDs yet

Devtron's ArgoCD currently returns `items: null` — Devtron manages its own deployments internally without creating standard `Application` CRDs. The ArgoCD history card will show data only once apps are deployed using the 3-tier template (which creates real `Application` CRDs in the `argocd` namespace).

Only then should you add `argocd/app-name` to the corresponding catalog entity.

---

## Step 3: CNPG Resources in Catalog

**Created** `example-org/systems/platform-databases.yaml` — auto-discovered via `example-org/catalog-info.yaml` → `targets: ./systems/*.yaml`.

| Entity name | Kind | Type | Description |
|-------------|------|------|-------------|
| `postgres-cluster-main` | Resource | database | Shared CNPG cluster — K8s annotated with `backstage.io/kubernetes-id: postgres-cluster` |
| `backstage-db` | Resource | database | Backstage IDP's own DB, `dependencyOf: component:default/backstage-portal` |
| `n8n-db` | Resource | database | n8n workflow automation DB |

---

## Step 4: 3-Tier App Software Template

**Location in this repo:** `templates/three-tier-app/`
**Deployed to:** `engineering-standards` repo at `templates/projects/cloud/three-tier-app/`
**Referenced in:** `templates/projects/catalog-info.yaml` targets list

### File structure

```
templates/three-tier-app/
├── template.yaml                      # Backstage Software Template definition
└── skeleton/
    ├── catalog-info.yaml              # Generated: System + 2 Components + Resource
    ├── README.md                      # Generated: app README with URLs and commands
    └── k8s/
        ├── namespace.yaml             # Generated: K8s Namespace
        ├── frontend.yaml              # Generated: Deployment + Service + Ingress
        ├── backend.yaml               # Generated: Deployment + Service + Ingress
        ├── database.yaml              # Generated: CNPG Cluster + optional PgBouncer Pooler
        └── argocd-application.yaml    # Generated: ArgoCD Application (GitOps)
```

### What the template generates

When a user fills out the form in Backstage Scaffolder, it:

1. **Creates a GitHub repo** in `your-org` org (private)
2. **Generates all skeleton files** with values substituted (Nunjucks templating)
3. **Registers 4 catalog entities:** `System` + `Component` (website) + `Component` (service) + `Resource` (database)
4. **Generates K8s manifests** ready for ArgoCD to sync from `k8s/` directory

### Generated Deployments include the correct pod template label

The skeleton Deployments are pre-annotated correctly:
```yaml
# skeleton/k8s/frontend.yaml
spec:
  template:
    metadata:
      labels:
        backstage.io/kubernetes-id: ${{ values.appName }}-frontend  # ← in pod template
```

### Template parameters

| Parameter | Options |
|-----------|---------|
| App name | lowercase, hyphens, 4–50 chars |
| Owner | OwnerPicker (Groups from catalog) |
| Environment | `dev`, `staging`, `prod` |
| Backend language | Node.js, Python (FastAPI), Go |
| DB instances | 1 (dev), 2 (staging), 3 (prod HA) |
| DB storage | 1Gi – 100Gi (Longhorn) |
| Connection pooling | PgBouncer toggle |

### Key design decisions

| Decision | Value |
|----------|-------|
| Storage class | `longhorn` |
| DB backup bucket | `cnpg-backups` on MinIO `192.168.2.103:9000` |
| DB backup secret | `cnpg-minio-creds` (same as platform CNPG) |
| Ingress | Traefik, pattern `<app>.<env>.coderstudio.co` |
| Database URL | CNPG auto-creates secret `<cluster>-app`, key `uri` |
| ArgoCD sync | `automated.prune: true`, `selfHeal: true`, `CreateNamespace: true` |

> ⚠️ CNPG backup uses `barmanObjectStore` (deprecated in 1.28, removed in 1.29+). Migrate to barman-cloud plugin before upgrading CNPG.

---

## Deployment Procedure

### How to rebuild and redeploy after any config/catalog change

The config files and `example-org/` catalog are **baked into the Docker image**. Any change to these files requires a rebuild.

```bash
cd /root/Projects/backstage-main

# 1. Build (fast — only last 3 layers re-run, ~5 seconds total)
docker build -f Dockerfile.with-migrations -t 192.168.2.101:5000/backstage:latest .

# 2. Push to local registry
docker push 192.168.2.101:5000/backstage:latest

# 3. Restart (rolling restart, no downtime)
kubectl rollout restart deployment/backstage -n backstage

# 4. Wait for completion
kubectl rollout status deployment/backstage -n backstage --timeout=120s
```

### After restarting — trigger catalog refresh in the UI

The catalog reads updated entities from the database on a refresh schedule. After restarting with a new image, the catalog may still serve the old entity from the database until the next refresh cycle. To force an immediate update:

1. Open the entity page in Backstage UI
2. Click the **three-dot menu (⋮)** in the top-right of the entity page
3. Click **"Schedule entity refresh"**
4. The page will reload with updated annotations within seconds

Alternatively, wait ~30–60 seconds for the automatic file location refresh to run.

---

## Complete Secrets Reference

All secrets in `backstage-secrets` (backstage namespace):

| Key | Purpose | Added |
|-----|---------|-------|
| `AUTH_GOOGLE_CLIENT_ID` | Google OAuth | Pre-existing |
| `AUTH_GOOGLE_CLIENT_SECRET` | Google OAuth | Pre-existing |
| `BACKEND_SECRET` | Backstage backend signing key | Pre-existing |
| `GITHUB_TOKEN` | GitHub integration + scaffolder | Pre-existing |
| `POSTGRES_PASSWORD` | CNPG backstage user password | Pre-existing |
| `AWS_ACCESS_KEY_ID` | FinOps — nonprod account | Pre-existing |
| `AWS_ACCESS_KEY_ID_LEGACY` | FinOps — legacy account | Pre-existing |
| `AWS_ACCESS_KEY_ID_PROD` | FinOps — prod account | Pre-existing |
| `AWS_SECRET_ACCESS_KEY` | FinOps — nonprod | Pre-existing |
| `AWS_SECRET_ACCESS_KEY_LEGACY` | FinOps — legacy | Pre-existing |
| `AWS_SECRET_ACCESS_KEY_PROD` | FinOps — prod | Pre-existing |
| `K8S_SA_TOKEN` | Kubernetes plugin SA token | **2026-03-22** |
| `K8S_SA_CA_DATA` | Kubernetes plugin CA cert (base64) | **2026-03-22** |
| `ARGOCD_URL` | `https://argocd-server.devtroncd.svc.cluster.local` | **2026-03-22** |
| `ARGOCD_TOKEN` | Bare JWT for `argocd:` config block | **2026-03-22** |
| `ARGOCD_AUTH_TOKEN` | `argocd.token=<JWT>` for proxy cookie | **2026-03-22** |

---

## Verification Commands

```bash
# Confirm SA permissions
kubectl auth can-i list pods --as=system:serviceaccount:backstage:backstage-k8s-reader -A
kubectl auth can-i list deployments --as=system:serviceaccount:backstage:backstage-k8s-reader -A
kubectl auth can-i list clusters.postgresql.cnpg.io --as=system:serviceaccount:backstage:backstage-k8s-reader -A

# Confirm metrics-server is available (required for skipMetricsLookup: false)
kubectl top nodes

# Confirm all 5 new secrets exist
kubectl get secret backstage-secrets -n backstage -o jsonpath='{.data}' \
  | python3 -c "import sys,json; print('\n'.join(sorted(json.load(sys.stdin).keys())))" \
  | grep -E "K8S|ARGOCD"

# Confirm plugin startup in logs
kubectl logs -n backstage deployment/backstage --since=5m \
  | grep -E "Initializing Kubernetes|HPM.*Proxy created|Plugin initialization complete"

# Confirm a pod has the kubernetes-id label (for backstage-portal test entity)
kubectl get pods -n backstage --show-labels | grep "kubernetes-id"
```

---

## Test Results (2026-03-22)

| Test | Result |
|------|--------|
| SA permissions (pods, deployments, CNPG) | ✅ all `yes` |
| Metrics server (`kubectl top nodes`) | ✅ works |
| Kubernetes plugin init (no errors) | ✅ `Initializing Kubernetes backend` |
| ArgoCD proxy created | ✅ `[HPM] Proxy created: /argocd/api → devtroncd` |
| K8s tab visible on `backstage-portal` | ✅ `POST /api/kubernetes/services/backstage-portal 200` |
| Catalog entity refresh (manual) | ✅ `POST /api/catalog/refresh 200` |
| ArgoCD card (0 apps — no CRDs yet) | ✅ hidden correctly after removing `argocd/app-name` from backstage-portal |
| Template in engineering-standards | ✅ pushed to `templates/projects/cloud/three-tier-app/` |
| All rollouts successful | ✅ |

---

## Lessons Learned / Common Mistakes

### 1. Pod template labels vs Deployment labels

`kubectl label deployment <name> ...` patches the **Deployment's own `metadata.labels`**, not the pod template. The Kubernetes plugin finds resources by matching **Pod labels** — Pods only inherit labels from `spec.template.metadata.labels`.

**Wrong:**
```bash
kubectl label deployment my-app -n my-ns backstage.io/kubernetes-id=my-app
# ❌ This labels the Deployment object only. Pods are unaffected.
# ❌ The K8s plugin will find 0 resources.
```

**Correct:**
```bash
kubectl patch deployment my-app -n my-ns --type=strategic -p '{
  "spec": {"template": {"metadata": {"labels": {"backstage.io/kubernetes-id": "my-app"}}}}
}'
# ✅ This updates the pod template. New pods will have the label.
# ✅ Triggers an automatic rolling restart.
```

Or set it from the start in the Deployment YAML:
```yaml
spec:
  template:
    metadata:
      labels:
        backstage.io/kubernetes-id: my-app   # ← here, not under metadata.labels at the top
```

### 2. Catalog refresh after image rebuild

After rebuilding the image with updated catalog YAML files, the entity in the Backstage database may still reflect the old version. The new image's files are processed on the next catalog refresh cycle (~30s for file locations). Use **"Schedule entity refresh"** from the entity page menu to force immediate processing.

### 3. ArgoCD HTTP vs HTTPS

ArgoCD's server redirects HTTP to HTTPS with a 307 redirect. Using `curl http://...` returns an empty body. Always use `curl -sk https://...` when talking to ArgoCD via port-forward.

### 4. ArgoCD inside Devtron has no standalone Application CRDs

Devtron manages its own deployments internally. The ArgoCD API returns `items: null` for applications because no standard `Application` CRDs have been created outside Devtron. The ArgoCD plugin in Backstage will show data only for apps deployed via the 3-tier template (which creates `Application` CRDs directly in the `argocd` namespace).

### 5. ArgoCD annotation without a matching Application CRD causes a card error

**Symptom:** ArgoCD card on the entity overview shows: *"Error occurred while fetching data. Cannot get argo location(s) for service"*

**Root cause:** The `argocd/app-name` annotation was present on the entity, so `isArgocdAvailable` returned `true` and rendered the card. But the `Application` CRD with that name did not exist, so every API call to ArgoCD failed.

**Fix:**
1. Remove `argocd/app-name` from the entity's `catalog-info.yaml` (or `example-org/` YAML)
2. Rebuild + redeploy the image (config is baked in)
3. Force a catalog refresh from the entity page
4. The card is hidden — `isArgocdAvailable` returns `false` when annotation is absent

**Prevention:** Before adding `argocd/app-name` to any entity, verify the CRD exists:
```bash
kubectl get applications.argoproj.io -A | grep <app-name>
```
If the command returns nothing, do not add the annotation.

---

## Pending Items

| Item | Status |
|------|--------|
| ArgoCD token — create dedicated `backstage` SA instead of admin token | Pending |
| CNPG barmanObjectStore → barman-cloud migration | Pending (before CNPG 1.29+) |
| ArgoCD Application CRDs will appear after first 3-tier app deploy | Waiting on usage |
