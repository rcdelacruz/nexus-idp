# Getting Started

Welcome to Nexus IDP — Stratpoint's Internal Developer Platform. This guide walks you through your first login and the core things you'll do day-to-day.

---

## Signing In

1. Go to [backstage.coderstudio.co](https://backstage.coderstudio.co) (on-prem) or [portal.stratpoint.io](https://portal.stratpoint.io) (production)
2. Click **Sign in with Google**
3. Use your `@stratpoint.com` Google account

On first login, your account is automatically created and placed in the `general-engineers` group. You'll have access to Engineering Docs, Tech Radar, and the Software Catalog in read-only mode.

A platform admin will assign you to your team group (e.g. `web-team`, `backend-team`). Once assigned, you'll have full access to the Scaffolder, Kubernetes tab, and ArgoCD integration.

---

## Navigation

The sidebar on the left is your main navigation:

| Section | What it is |
|---------|-----------|
| **Home** | Dashboard — quick links and recent activity |
| **Catalog** | All registered services, APIs, systems, and resources |
| **Create** | Scaffolder — spin up new projects from templates |
| **Docs** | Engineering Docs — standards, guides, golden paths |
| **Search** | Search across the entire catalog |
| **Tech Radar** | Technology adoption recommendations |
| **Local Provisioner** | Spin up local dev resources (Kafka, Postgres, Redis) |
| **FinOps** | AWS cost dashboard (admins and leads only) |

---

## Finding Your Team's Services

1. Click **Catalog** in the sidebar
2. Use the **Owner** filter on the left to select your team (e.g. `web-team`)
3. Or use the **Kind** filter to narrow by `Component`, `API`, `System`, etc.

You can also use the global **Search** (top of sidebar or `Ctrl+K`) to find any entity by name.

---

## Your First Actions

| Goal | Where to go |
|------|------------|
| Find a service | Catalog → filter by Owner or search by name |
| See live pod status | Open a Component → K8s tab |
| See deployment history | Open a Component → CD (ArgoCD) tab |
| Create a new project | Create → pick a template |
| Read engineering standards | Docs → Engineering Hub |
| Spin up a local database | Local Provisioner |

---

## Getting Help

- Ask in `#nexus-idp` on Slack
- For access issues (wrong team, missing permissions): contact a platform admin
- To register a new service: see [Importing Projects](importing-projects.md)
- To scaffold a new project: see [Scaffolder Templates](scaffolder-templates.md)
