# Monitoring & Ops Links

Every service in the catalog can show its **Grafana dashboards and alerts** (the **Monitoring** tab) and its **runbook, dashboard and on-call links** (the **Links** card on Overview). Both are driven by `catalog-info.yaml` — this page is the convention.

---

## Monitoring Tab

The tab appears on **service** and **website** components only when the entity has at least one `grafana/*` annotation. Without one, there is no tab — nothing to configure, nothing broken.

```yaml
metadata:
  annotations:
    # Dashboards: a query over Grafana dashboard tags (operators: @>, ==, !=, &&, ||, !)
    grafana/dashboard-selector: "tags @> 'my-service' || tags @> 'kubernetes-mixin'"
    # Alerts (opt-in): label=value pairs, comma-separated for several
    grafana/alert-label-selector: "service=my-service"
```

| Annotation | Shows | Notes |
|------------|-------|-------|
| `grafana/dashboard-selector` | Dashboards card (Monitoring tab) | Tag your Grafana dashboards with the service name to list them. `kubernetes-mixin` adds the standard Kubernetes dashboards. |
| `grafana/alert-label-selector` | Alerts card (Monitoring tab + Overview) | Lists **Grafana-managed** alert rules only. Prometheus/Alertmanager rules (the built-in kube-prometheus-stack alerts) are not shown — create the rule in Grafana's alerting UI with the matching label. |

Services scaffolded to **Talos Homelab (k8s-selfhosted)** get `grafana/dashboard-selector` automatically. The alert selector is left commented in `catalog-info.yaml` until you create a Grafana-managed rule.

> Grafana works only on instances where the Grafana proxy is configured (`app-config.on-prem.yaml`). Dashboard and alert links open Grafana itself.

---

## Ops Links

Add runbook, dashboard and on-call links to `metadata.links`. They render in the **Links** card on the Overview tab — no plugin needed.

```yaml
metadata:
  links:
    - url: https://github.com/my-org/my-service/blob/main/docs/runbook.md
      title: Runbook
      icon: docs
    - url: https://grafana.example.com/d/abc123
      title: Dashboard
      icon: dashboard
    - url: https://example.com/on-call/my-service
      title: On-call
      icon: alert
```

| Title | Use for |
|-------|---------|
| `Runbook` | What to do when this service's alerts fire — first checks, known failure modes, rollback |
| `Dashboard` | The one dashboard to open first during an incident |
| `On-call` | Who to escalate to |

Keep the titles exactly as above so they read the same on every service.

---

## Ops Readiness Scorecard

Every **service** and **website** shows an **Ops readiness** card on its Overview tab
(Tech Insights). It checks the conventions on this page, so fixing a failing check is just
editing `catalog-info.yaml`:

| Check | Passes when |
|-------|-------------|
| Owned by a group | `spec.owner` is a group (anything not starting with `user:`) |
| Has a description | `metadata.description` is set |
| Has a runbook link | a `metadata.links` entry titled `Runbook` |
| Has a dashboard link | a `metadata.links` entry titled `Dashboard` |
| Has an on-call link | a `metadata.links` entry titled `On-call` |
| Has Grafana monitoring | a `grafana/dashboard-selector` or `grafana/alert-label-selector` annotation |

Facts are collected **hourly**, so a just-registered or just-changed service shows "Not evaluated
yet" until the next run. Checks and schedules live under `techInsights` in `app-config.yaml`; the
link and annotation facts come from `packages/backend/src/plugins/techInsightsOpsFacts.ts`.

---

## For Your Team (Home Page)

The home page shows a **For your team** section with shortcuts for your team's role — application templates for software teams, running services and monitoring for cloud and QA, databases for data, architecture views for solution architects, infrastructure and governance templates for DevOps. Each team also gets an **AI** tile linking to the part of the [nexus-dev toolkit docs](https://nexus.coderstudio.co/docs) that fits the role (EPAV loop, `/database-review`, `/deployment-review`, `/monitoring-review`, architecture docs). Tiles only link to templates your role can actually use. They come from `packages/app/src/components/home/rolePaths.ts`; users in several teams see all their teams' tiles.
