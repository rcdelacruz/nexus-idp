# Importing Existing Projects into the Catalog

This guide explains the different ways to register an existing project, service, or resource into the Nexus IDP Software Catalog.

---

## Option 1 — GitHub Autodiscovery (Recommended)

The portal automatically scans two GitHub organizations every 30 minutes for any repository that has a `catalog-info.yaml` file on the `main` branch:

- `stratpoint-engineering` — main Stratpoint org
- `strat-main-team` — Stratpoint main team org

**What you need to do:** Add a `catalog-info.yaml` to the root of your repo.

```yaml
# catalog-info.yaml
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: my-service
  description: Short description of your service
  annotations:
    github.com/project-slug: stratpoint-engineering/my-repo  # or strat-main-team/my-repo
    backstage.io/kubernetes-id: my-service    # optional — links the K8s tab
spec:
  type: service          # service | website | library | documentation
  lifecycle: production  # development | staging | production
  owner: backend-team    # must match a group in stratpoint/org/groups.yaml
  system: internal-platform  # optional — groups related services together
```

Push the file to `main` — the catalog will pick it up within 30 minutes. You can also trigger an immediate refresh from the entity page in the UI.

### Component types

| Type | When to use |
|------|-------------|
| `service` | Backend APIs, workers, microservices |
| `website` | Frontend apps, portals |
| `library` | Shared packages, SDKs, utilities |
| `documentation` | Docs sites (MkDocs, Nextra, Docusaurus) |

### Lifecycle values

| Value | When to use |
|-------|-------------|
| `production` | Live, customer-facing |
| `staging` | Pre-production / QA environment |
| `development` | In active development, not yet released |
| `deprecated` | Being phased out |

---

## Option 2 — Register via UI (Immediate, One-Off)

For repos not in the `stratpoint-engineering` org (personal repos, external projects), use the manual registration flow:

1. Go to **Catalog → Register Existing Component** (or navigate to `/catalog-import`)
2. Paste the URL to your `catalog-info.yaml`:
   ```
   https://github.com/stratpoint-engineering/my-repo/blob/main/catalog-info.yaml
   ```
3. Click **Analyze** → **Import**

The entity is registered immediately and tracked by URL. Changes to the file are picked up on the next poll cycle.

---

## Option 3 — Add to `stratpoint/components/` (Curated, Manual)

For internal tools, services, or infrastructure that don't have their own GitHub repo, add a YAML file directly to the portal repository:

1. Create `stratpoint/components/my-project.yaml`:

```yaml
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: my-project
  description: Description of the project
spec:
  type: service
  lifecycle: production
  owner: cloud-team
  system: internal-platform
```

2. Reference it from `stratpoint/catalog-info.yaml`:

```yaml
---
apiVersion: backstage.io/v1alpha1
kind: Location
metadata:
  name: stratpoint-catalog
spec:
  targets:
    - ./components/my-project.yaml   # add this line
```

3. Commit and deploy.

---

## Option 4 — External URL Location (Other Orgs / Accounts)

For repos in a different GitHub organization or account, add a URL-based location to `app-config.production.yaml`:

```yaml
catalog:
  locations:
    - type: url
      target: https://github.com/other-org/repo/blob/main/catalog-info.yaml
```

This requires a config change and redeployment, so use Option 2 (UI registration) for one-off imports from external repos.

---

## Which Option to Use

| Scenario | Recommended method |
|----------|--------------------|
| Repo is in `stratpoint-engineering` or `strat-main-team` GitHub org | **Option 1** — add `catalog-info.yaml` to the repo |
| Repo is external / personal | **Option 2** — Register via UI |
| Internal tool with no GitHub repo | **Option 3** — add to `stratpoint/components/` |
| Entire external org to bulk-import | **Option 4** — URL location in config |

---

## Linking Optional Integrations

Add these annotations to `catalog-info.yaml` to unlock additional catalog tabs:

```yaml
metadata:
  annotations:
    # Kubernetes — shows live pod/deployment status
    backstage.io/kubernetes-id: my-service

    # ArgoCD — shows GitOps deployment history
    argocd/app-name: my-service-dev

    # Engineering Docs — links to a docs source in the portal
    engineering-docs/source-id: my-docs-source-id

    # GitHub — links to the source repo
    github.com/project-slug: stratpoint-engineering/my-repo
```

---

## Ownership

Every component must have an `owner` that maps to an existing group in `stratpoint/org/groups.yaml`. Current teams:

| Group name | Department |
|------------|------------|
| `web-team` | Web/Frontend |
| `mobile-team` | Mobile |
| `data-team` | Data Engineering |
| `cloud-team` | Cloud / Platform |
| `ai-team` | AI/ML |
| `qa-team` | QA |
| `backend-team` | Backend |

If your team is not listed, ask a platform admin to add it to `stratpoint/org/groups.yaml`.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Entity not appearing after 30 min | Invalid YAML or wrong branch | Validate YAML, confirm file is on `main` |
| `owner` shows as unknown | Group doesn't exist | Check spelling against `stratpoint/org/groups.yaml` |
| K8s tab missing | Missing annotation | Add `backstage.io/kubernetes-id` annotation |
| ArgoCD tab missing | Missing annotation | Add `argocd/app-name` annotation |
| Entity disappears after registering | Orphan strategy deletes it | The `catalog-info.yaml` must remain in the repo; don't delete the file |
