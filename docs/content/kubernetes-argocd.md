# Kubernetes & ArgoCD

Every component scaffolded through Nexus IDP has two live monitoring tabs: **K8s** (live pod/deployment status) and **CD** (ArgoCD deployment history). This guide explains how to read them.

---

## Kubernetes Tab

The K8s tab shows the live state of your application in the cluster.

### What You'll See

| Section | What it shows |
|---------|--------------|
| **Deployments** | Desired vs. ready replicas, rollout status |
| **Pods** | Individual pod status, restarts, age |
| **Services** | ClusterIP / NodePort / LoadBalancer endpoints |
| **Ingress** | External URLs your app is exposed on |
| **HPA** | Horizontal Pod Autoscaler — current vs. min/max replicas |

### Pod Status Colors

| Color | Meaning |
|-------|---------|
| Green | Running and ready |
| Yellow | Pending or starting |
| Red | CrashLoopBackOff or Error |
| Grey | Completed (init containers, jobs) |

### Viewing Logs

Click any pod → **Logs** to tail the last 100 lines. Useful for debugging crashes without needing `kubectl`.

### Requirements

Your `catalog-info.yaml` must have the Kubernetes annotation:

```yaml
metadata:
  annotations:
    backstage.io/kubernetes-id: my-service
```

The value must match the `app` label on your Kubernetes Deployment. Scaffolded apps set this automatically.

---

## ArgoCD Tab (CD)

The CD tab shows your GitOps deployment history via ArgoCD.

### What You'll See

| Field | Meaning |
|-------|---------|
| **Sync Status** | Synced = cluster matches Git; OutOfSync = drift detected |
| **Health Status** | Healthy / Progressing / Degraded / Suspended |
| **Current Revision** | Git commit SHA currently deployed |
| **History** | Last 20 deployments — commit, author, timestamp |

### Sync Statuses

| Status | Meaning |
|--------|---------|
| Synced | Cluster matches the Git manifest exactly |
| OutOfSync | A manifest changed in Git but hasn't been applied yet |
| Unknown | ArgoCD can't reach the cluster or the app |

### Health Statuses

| Status | Meaning |
|--------|---------|
| Healthy | All pods are running and passing readiness checks |
| Progressing | Rollout in progress — pods being replaced |
| Degraded | One or more pods crashed or failed readiness |
| Suspended | Auto-sync is paused (e.g. during teardown) |

### Requirements

Your `catalog-info.yaml` must have the ArgoCD annotation:

```yaml
metadata:
  annotations:
    argocd/app-name: my-service-dev
```

The value must match the ArgoCD Application name. Scaffolded apps set this automatically (typically `<app-name>-dev`).

---

## Common Situations

**Pods keep restarting (CrashLoopBackOff)**
→ K8s tab → click the pod → Logs — read the last error before crash

**Deployment is OutOfSync**
→ ArgoCD Tab → the sync was likely suspended or a manifest diff exists — contact your team lead or a platform admin to trigger a sync

**K8s tab shows nothing**
→ Check that `backstage.io/kubernetes-id` annotation is set and matches your deployment's `app` label

**CD tab shows nothing**
→ Check that `argocd/app-name` annotation is set and the ArgoCD Application exists
