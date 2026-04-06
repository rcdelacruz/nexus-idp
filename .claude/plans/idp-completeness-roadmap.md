# IDP Completeness Roadmap
_Expert assessment — 2026-03-28_

This plan captures the gaps identified by the Backstage IDP expert audit to make Nexus IDP a production-grade IDP for both product companies and IT outsourcing/professional services organizations.

> **Documentation strategy:** `engineering-docs` plugin is the default documentation tool — GitHub Markdown/MDX, no build step. TechDocs is kept only as a per-component fallback. All platform/portal/hub docs go through engineering-docs sources configured in `app-config.yaml`.

---

## Progress Tracker

| # | Item | Status | Completed |
|---|------|--------|-----------|
| 1 | GitHub catalog autodiscovery | `[x] done` | 2026-03-28 — nested plugin-catalog-node@2.1.0 in github module's node_modules; scanning 48 repos |
| 2 | Project Registration backend | `[x] done` | 2026-03-28 |
| 3 | TechDocs — migrate to S3/GCS | `[~] deferred` | replaced by engineering-docs plugin |
| 4 | Rate limiting on device endpoints | `[x] done` | 2026-03-28 — express-rate-limit on /agent/device/code + /token |
| 5 | SonarQube — wire or remove | `[~] deferred` | maybe later |
| 6 | Scaffolder template visibility by role | `[ ] todo` | — |
| 7 | Client/project scoped permissions | `[ ] todo` | — |
| 8 | Project Registration — Jira/Linear integration | `[ ] todo` | — |
| 9 | SLA / runbook / on-call annotations | `[ ] todo` | — |
| 10 | Incident management integration | `[ ] todo` | — |
| 11 | CI/CD status on entity pages | `[ ] todo` | — |
| 12 | Dependency graph population | `[ ] todo` | — |
| 13 | Cost-per-service FinOps tab | `[ ] todo` | — |
| 14 | Audit log | `[ ] todo` | — |
| 15 | Remove `unsafe-eval` from CSP | `[ ] todo` | — |
| 16 | FinOps permission — proper registration | `[ ] todo` | — |
| 17 | Device token expiry UX | `[ ] todo` | — |
| 18 | Google Workspace user sync | `[~] deferred` | maybe later |
| 19 | Additional scaffolder templates | `[ ] todo` | — |
| 20 | Portal self-health dashboard | `[ ] todo` | — |
| 21 | DB backup and DR documentation | `[ ] todo` | — |
| 22 | Replace /me polling with SSE push | `[ ] todo` | — |

> Update status to `[~] in progress`, `[x] done`, or `[!] blocked` as work progresses. Add date in Completed column when done.

---

## Priority 1 — Operational Blockers

- [x] **#1 — GitHub catalog autodiscovery** _(done 2026-03-28)_
  - `plugin-catalog-backend-module-github` enabled in `packages/backend/src/index.ts`
  - `catalog.providers.github.stratpoint` configured in `app-config.yaml` (30-min schedule, `orphanStrategy: delete`)

- [x] **#2 — Project Registration backend** _(done 2026-03-28)_
  - **Root of the entire cost attribution chain** — Project → Scaffolder tags → AWS resource tags → FinOps cost reporting
  - **No project → no scaffolding** (hard gate; system projects "Internal Tools" + "R&D" pre-seeded so dropdown never empty)
  - Stores AWS-safe tag values (`aws_tag_project`, `aws_tag_client`, `aws_tag_team`) — scaffolder injects into IaC + catalog entities
  - Phase 1 (MVP): DB store + REST API (`@stratpoint/plugin-project-registration-backend`)
  - Phase 2: "Select Project" dropdown in all scaffolder templates
  - Phase 3: Jira integration; Phase 4: FinOps entity cost tab per project
  - _See full plan: `project-registration-backend.md`_

- [~] **#3 — TechDocs — migrate to S3/GCS** _(deferred — engineering-docs is the default documentation tool)_
  - **engineering-docs plugin is the primary docs surface** — GitHub Markdown/MDX, no build step needed
  - TechDocs is kept only as a fallback for per-component entity docs (`/docs/:namespace/:kind/:name/*`)
  - `TechDocsRedirect` already redirects to engineering-docs when `engineering-docs/source-id` annotation is present
  - Remaining task: ensure all new components use `engineering-docs/source-id` annotation instead of relying on TechDocs
  - S3/GCS migration only needed if TechDocs fallback becomes heavily used

- [x] **#4 — Rate limiting on device code endpoints** _(done 2026-03-28)_
  - `express-rate-limit` added to `plugins/local-provisioner-backend`
  - 10 req/15min on `POST /agent/device/code`, 130 req/10min on `POST /agent/device/token`

- [~] **#5 — SonarQube — wire or remove** _(deferred — revisit later)_
  - Option A: Add `sonarqube:` config block, wire frontend plugin in `App.tsx` + `EntityPage`
  - Option B: Remove `@backstage-community/plugin-sonarqube-backend` from `index.ts` entirely
  - _Currently running backend with zero UI surface — confuses adopters_

---

## Priority 1b — Role & Access Features

- [ ] **#6 — Scaffolder template visibility by role**
  - Gate template listing via `catalogEntityReadPermission` + `createConditionalDecision` (NOT `scaffolderTemplateReadPermission` — not wired in 1.49.1)
  - Add `trainee-<dept>` synthetic catalog groups; emit from `UserEntityProvider.ts` when `trainee_department` is set
  - Add `trainee_department` DB column to `user_management_users`
  - Re-tag templates in `engineering-standards`: `spec.owner: group:default/trainee-web` for training templates, `web-team` for project templates
  - _See full revised plan: `scaffolder-template-visibility.md`_
  - **Do not inject catalog client into PermissionPolicy — causes circular dependency**

---

## Priority 2 — IT Outsourcing / Professional Services

- [ ] **#7 — Client/project scoped permissions**
  - Implement `createConditionalDecision` in `permission.ts` for entity-level visibility
  - Add `client` or `project` annotation convention to catalog entities
  - Engineers scoped to their client engagements only
  - _Single-org permission model is insufficient for outsourcing_

- [ ] **#8 — Project Registration — Jira/Linear integration**
  - On project creation: create Jira project, GitHub repo, catalog entities, assign engineers, link client billing code
  - Scaffolder handles repo + catalog; backend plugin handles PM system

- [ ] **#8b — Project deletion safety: association guard**
  - When Phase 2 scaffolder integration is live, catalog entities will carry a `project-registration/project-id` annotation
  - Before allowing hard delete of a project, query the catalog for any entities with that annotation pointing to the project ID
  - If associations exist: block delete, return 409 with the list of associated entity refs so the user knows what to clean up first
  - Implementation: `DELETE /projects/:id` calls `catalogApi.getEntities({ filter: { 'metadata.annotations.project-registration/project-id': id } })` before deleting; return error if non-empty
  - Archive (soft delete) should remain allowed even with associations — it's reversible

- [ ] **#9 — SLA / runbook / on-call annotations convention**
  - Define annotation standards: `nexus.io/sla`, `nexus.io/runbook-url`, `nexus.io/oncall-rotation`
  - Add entity content tab to `EntityPage` surfacing these for client-facing services
  - Document in Engineering Hub

---

## Priority 3 — Product Company Features

- [ ] **#10 — Incident management integration**
  - Add PagerDuty (`@backstage/plugin-pagerduty`) or OpsGenie plugin
  - Wire to entity pages: current alert status, recent incidents, on-call owner
  - _Engineers won't open the portal during incidents without this_

- [ ] **#11 — CI/CD status on entity pages**
  - Add GitHub Actions plugin (`@backstage/plugin-github-actions`) to `EntityPage`
  - Show last build status, last deploy, current pipeline state per service
  - ArgoCD covers deployed state — this covers the build/release pipeline

- [ ] **#12 — Dependency graph population**
  - Add `dependsOn`, `providesApis`, `consumesApis` to catalog entity YAML files
  - Document annotation convention in Engineering Hub
  - _Catalog Graph page renders empty — second most valuable thing after service list_

- [ ] **#13 — Cost-per-service FinOps tab**
  - **Depends on #2 (Project Registration)** — requires `project-registration/project-id` annotation on catalog entities (set by scaffolder in Phase 2)
  - Lookup entity's `aws_tag_project`/`aws_tag_client`/`aws_tag_team` from project record via annotation
  - Add `finops` entity tab on `EntityPage` showing filtered AWS cost for that service's project
  - Full chain: entity → project-id → project record → AWS tags → FinOps cost filter

---

## Priority 4 — Security & Compliance

- [ ] **#14 — Audit log**
  - Adopt `coreServices.auditLogger` from `@backstage/plugin-audit-log-node`
  - Instrument: `user-management-backend` (promote/delete), `finops-backend`, `local-provisioner-backend`
  - _SOC 2 / ISO 27001 blocker — currently only stdout logging_

- [ ] **#15 — Remove `unsafe-eval` from CSP**
  - Investigate which bundle requires it (MUI / Backstage)
  - Remove or document with explicit justification
  - Applies to both `app-config.yaml` and `app-config.production.yaml`

- [ ] **#16 — FinOps permission — proper registration**
  - Register `finopsReadPermission` through the permissions extension point in `plugins/finops-backend`
  - Remove reliance on name-prefix matching in `permission.ts`
  - _Works today but will break under policy-as-config migration_

- [ ] **#17 — Device token expiry UX**
  - Add expiry detection in the CLI agent (`packages/backstage-agent`)
  - Surface re-auth prompt before silent failure at 30-day mark
  - Build `/device` frontend page (user-code entry form) — currently route exists but no UI

---

## Priority 5 — Operational Maturity

- [~] **#18 — Google Workspace user sync** _(deferred — revisit later)_
  - Enable `plugin-catalog-backend-module-google` for automatic user ingestion
  - Deprecate manual `stratpoint/org/users.yaml` edits for user creates
  - Keep `user-management-backend` for role assignment / revocation
  - _See existing plan: `google-workspace-provisioning.md`_

- [ ] **#19 — Additional scaffolder templates**
  - Lambda/serverless service template
  - Data pipeline template
  - Frontend-only static site template
  - Library/npm package template
  - _Only `three-tier-app` (K8s + ArgoCD + CNPG) exists today_

- [ ] **#20 — Portal self-health dashboard**
  - Frontend page showing: catalog entity count, last catalog refresh time, search index age, plugin error rates
  - Can use existing health endpoints + catalog stats API

- [ ] **#21 — DB backup and disaster recovery documentation**
  - Document PostgreSQL backup schedule (CNPG has built-in backup to S3)
  - Document restore procedure and tested recovery path
  - Add to Engineering Hub

- [ ] **#22 — Replace `/me` polling with SSE push**
  - Currently the frontend polls `GET /api/user-management/me` every 30 seconds to detect role changes and session revocation
  - At scale this creates thousands of unnecessary requests per minute
  - Replace with SSE push from user-management-backend — only fires when an admin changes a user's role, team, or revokes their session
  - Local provisioner backend already has SSE infrastructure — reuse the pattern
  - Fallback: single check on mount + SSE event listener, no interval polling

---

## Summary

| Priority | Items | Key Blocker |
|----------|-------|-------------|
| P1 — Blockers | #1–#5 | Catalog autodiscovery, Project Registration backend |
| P1b — Role/Access | #6 | Scaffolder template visibility (see `scaffolder-template-visibility.md`) |
| P2 — Pro Services | #7–#9, #8b | Client-scoped permissions, project deletion safety |
| P3 — Product Companies | #10–#13 | Incident management, CI/CD status |
| P4 — Security/Compliance | #14–#17 | Audit log, unsafe-eval |
| P5 — Ops Maturity | #18–#22 | Google Workspace sync, polling optimization |

**Start here:** #1 GitHub autodiscovery → #2 Project Registration backend → #6 Scaffolder template visibility → #7 Client-scoped permissions
