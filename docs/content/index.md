# Nexus IDP Documentation

Welcome to the Nexus IDP internal documentation — the operational guide for platform engineers and team leads managing the Stratpoint Internal Developer Platform.

## What is Nexus IDP?

Nexus IDP is Stratpoint's Internal Developer Platform, built on Backstage 1.49.1. It serves as the central hub for:

- **Software Catalog** — browse all components, systems, APIs, and resources
- **FinOps Dashboard** — AWS cost and resource monitoring across Non-Prod, Legacy, and Production accounts
- **Engineering Docs** — engineering standards, guides, and golden paths from GitHub
- **Kubernetes Monitoring** — live pod/deployment status via the K8s plugin
- **ArgoCD Integration** — GitOps deployment history and health status
- **Local Provisioner** — spin up local Docker Compose environments via the backstage-agent CLI
- **Software Templates** — scaffold new projects following engineering standards

## User Roles

Nexus IDP uses a 4-tier RBAC system driven by group membership:

| Role | Group | Access |
|------|-------|--------|
| Platform Admin | `backstage-admins` | Full access — catalog CRUD, FinOps, user management |
| Team Lead | `*-lead` (e.g. `web-team-lead`) | Create/edit catalog entries for their team |
| Engineer | `web-team`, `mobile-team`, `data-team`, `cloud-team`, `ai-team`, `qa-team` | Read catalog, use scaffolder, K8s, ArgoCD, Local Provisioner |
| New User | `general-engineers` only | Onboarding flow, Engineering Docs, Tech Radar — limited access until assigned to a team |

New users are auto-provisioned into `general-engineers` on first Google or GitHub sign-in. A platform admin assigns them to the correct department team via the User Management UI.

## Quick Links

- [Permission System](permission-system.md) — how RBAC works
- [User & Group Management](user-group-management.md) — managing users and teams
- [Google OAuth Setup](google-oauth-setup.md) — configuring sign-in
- [K8s + ArgoCD + CNPG Integration](k8s-argocd-cnpg-integration.md) — Kubernetes and GitOps setup

- [Design System](design-system.md) — Geist design tokens, components, and rules for contributors
