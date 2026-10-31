# Pattern: UI shortcuts must match RBAC template visibility

**Discovered:** 2026-10-30, building the "For your team" home tiles (persona coverage Phase 1).

## Constraint

`packages/backend/src/plugins/permission.ts` filters `catalog.entity.read` for templates by
**owner**, not by type:

| Group | Templates visible |
|---|---|
| `backstage-admins` | all |
| `devops-team` | all |
| `*-lead` | all **except** devops-team-owned, plus `type: governance` |
| assigned engineer | all **except** devops-team-owned |
| unassigned (`general-engineers`) | `type: training` only |

In engineering-standards, **every** `infrastructure` template, `service-k8s/ecs/lambda/app-runner`,
`three-tier-app`, `documentation`, governance, and **all three training templates** are owned by
`group:default/devops-team`. So a link like `/create?filters[type]=infrastructure` opens an
**empty list** for a cloud-team engineer. Assigned engineers can't see training templates at all;
only unassigned trainees can.

The scaffolder list also has its own UI gates (`CustomScaffolderListPage.tsx`):
- training templates are hidden unless `trainingAccess=1` is in the URL;
- `destructive`-tagged templates (teardown-app) are never listed.

## How to apply

- Before adding any link into `/create?filters[type]=...` for a role, check template **owners** in
  engineering-standards against the table above. A shortcut that opens an empty list is worse than
  no shortcut.
- `rolePaths.test.ts` enforces this for the home tiles: only `DEVOPS_TEMPLATE_TEAMS` may link to
  infrastructure, governance or training template lists.
- Whether cloud-team should be able to run infrastructure templates is an RBAC/product decision.
  Change ownership or the policy, never the UI link.
