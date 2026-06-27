# Plan: Teardown Application Feature

**Created:** 2026-04-09  
**Status:** Design complete, not yet implemented  
**Priority:** V1 = K8s target; V2 = AWS/OpenTofu target

> ⚠️ **CRITICAL ACTION** — This feature permanently destroys GitHub repos, Kubernetes namespaces, databases, and AWS infrastructure. It cannot be undone. Every safety mechanism listed in this plan is mandatory for V1. Nothing ships without all guards in place.

---

## What Gets Created (Resource Inventory)

### K8s Deployment Target
| Resource | Created By | Cascade On Namespace Delete? |
|----------|------------|------------------------------|
| Namespace `<appName>-<env>` | `kubernetes:create-pull-secret` | N/A — this IS the cascade root |
| Secret `ghcr-pull-secret` | `kubernetes:create-pull-secret` | Yes |
| Secret `<appName>-secrets` | `kubernetes:create-app-secrets` | Yes |
| Deployment (frontend, backend) | ArgoCD sync | Yes |
| Service, Ingress, ConfigMap | ArgoCD sync | Yes |
| CNPG Cluster | `kubernetes:apply` | Yes (but data + PVCs need explicit cleanup) |
| CNPG Pooler | `kubernetes:apply` | Yes |
| PersistentVolumeClaims | CNPG operator | Yes (Longhorn PVs linger — see edge cases) |
| ArgoCD Application CR | `kubernetes:apply` | **No** — lives in `argocd` namespace |
| S3 WAL backups | CNPG scheduled backup | **No** — lives in S3, never auto-deleted |

### AWS Deployment Target (OpenTofu-managed)
| Resource | Notes |
|----------|-------|
| ECS Service + Task Definition | tofu state |
| ECR Repository + images | tofu state — needs `force_delete = true` |
| RDS/Aurora database | tofu state — has deletion protection |
| Secrets Manager entries | 7-day recovery window |
| Lambda Function + IAM roles | tofu state |
| App Runner Service | tofu state |
| CloudWatch Log Groups | **NOT** in tofu state — orphaned |
| S3 state file `<appName>.tfstate` | In `TOFU_STATE_BUCKET` |
| DynamoDB lock entry | Auto-released after `tofu destroy` |

### GitHub
| Resource | Notes |
|----------|-------|
| Repository | `github:repo:create` |
| Repository Secret `GH_PAT` | `github:repo:set-secret` |
| Environment `staging` | `github:repo:setup-promotion` |
| Environment `production` | `github:repo:setup-promotion` |
| GHCR images `ghcr.io/<owner>/<repo>-*` | Pushed by CI — **not in any tofu state** |

### Backstage Catalog
| Resource | Notes |
|----------|-------|
| System entity | via `catalog:register` |
| Component entities (1-2) | via `catalog:register` |
| API entity | via `catalog:register` |
| Resource entity (database) | via `catalog:register` |
| Location entity | registered by `catalog:register` |

---

## Implementation Architecture

### Entity Page Card → Scaffolder Template

The teardown lives **on the entity catalog page** as a "Danger Zone" card — not discoverable from `/create`. Clicking "Teardown" opens a multi-step dialog (or navigates to the scaffolder form with entityRef pre-filled).

```
Entity catalog page (Component/System entity)
  └── "Danger Zone" card  (DangerZoneCard.tsx)
        └── "Teardown Application" button (red, outlined)
              → Scaffolder form, entityRef pre-filled from current entity
                  Step 1: Teardown mode (checkbox group)
                  Step 2: Options
                  Step 3: Confirmation
                  → Scaffolder task runs with audit trail
```

**Why entity page only (not /create):**
- Teardown is contextual — you must be looking at the app to destroy it
- Reduces risk of accidental discovery and execution
- entityRef is already known from context — no EntityPicker needed

**Why scaffolder task (not a custom backend API):**
- Built-in audit trail: who ran it, when, each step's output
- Async steps with waits, retries, and conditional logic
- Reuses existing custom actions infrastructure

---

## Use Cases

### UC-1: Full K8s Teardown (Happy Path)
App created with service-k8s or three-tier-app. All resources healthy.
- Delete ArgoCD Application CR → removes synced resources via finalizer
- Delete K8s namespace → cascades secrets, deployments, CNPG cluster, pooler
- Delete Longhorn PVCs explicitly (finalizer issue — see edge cases)
- Delete S3 CNPG WAL backup bucket/prefix
- Delete GitHub repo
- Unregister Backstage catalog entity

### UC-2: Full AWS ECS Teardown
App created with service-ecs. OpenTofu state exists.
- Run `infra:tofu-apply` with `destroy: true`
- Delete CloudWatch Log Groups (orphaned — not in tofu state)
- Delete GHCR images (pushed by CI, not in tofu state)
- Delete GitHub repo
- Unregister Backstage catalog entity

### UC-3: Full AWS Lambda Teardown
Same as UC-2 — Lambda + IAM execution role in tofu state, handled by tofu destroy.

### UC-4: Partial Teardown — Keep GitHub Repo
Template parameter: `keepGitHubRepo: boolean` — skip github:repo:delete step.

### UC-5: Partial Teardown — One Environment Only
Template parameter: `environment: [all, dev, staging, prod]`
- Not `all`: delete only the ArgoCD app + namespace for that env
- `all`: delete all three namespaces + all ArgoCD apps

### UC-6: Failed Scaffolding Partial Cleanup
Scaffolding failed midway. Some resources exist, some do not.
- Each deletion step must be idempotent: 404 = already gone = not an error
- All steps run regardless of previous outcomes (no early exit on 404)

### UC-7: Documentation-Only App Teardown
No infra. Template detects `deploymentTarget: none` and skips infra steps.

### UC-8: Three-Tier App with CNPG Database
- Safety gate: if CNPG cluster exists, require explicit acknowledgement: "I understand this will permanently delete all data"
- This is a SEPARATE checkbox parameter — not just the app name
- S3 backups: offer `keepBackups: boolean` parameter

---

## Edge Cases

### EC-1: GitHub Repo Already Deleted (404)
Log warning "GitHub repo not found — already deleted", continue. Not an error.

### EC-2: ArgoCD Application Not Found
Log warning, continue. Namespace delete handles remaining k8s resources anyway.

### EC-3: K8s Namespace Not Found
Log warning, continue. All child resources are already gone.

### EC-4: Longhorn PV Finalizer Deadlock
- PVCs have `finalizers: [kubernetes.io/pvc-protection]` — can get stuck in Terminating
- Solution: After `kubectl delete namespace`, poll until gone; if still terminating after 60s, explicitly patch PVCs to remove finalizers
- `kubectl patch pvc <name> -p '{"metadata":{"finalizers":[]}}' --type=merge`

### EC-5: CNPG Cluster with Replication Lag
- CNPG operator handles graceful shutdown on namespace deletion
- S3 backups: offer `keepBackups: boolean` (default: false for teardown)

### EC-6: OpenTofu State Not Found
- Check `deploymentTarget` annotation BEFORE running tofu step; skip if not aws-*
- If tofu state exists but ECR already force-deleted: `tofu state rm aws_ecr_repository.<name>` then re-run

### EC-7: Secrets Manager 7-Day Recovery Window
- `tofu destroy` deletes secret but enters 7-day recovery window
- Warn user in teardown output: re-creating same app within 7 days will fail

### EC-8: ECR Repository Has Images
- `tofu destroy` fails if `force_delete = false` in tofu module
- Solution: add `force_delete = true` to ECR module in engineering-standards

### EC-9: Catalog Entity Has Dependents
- Other entities have `dependsOn: [<appName>]`
- Warn user if dependents found; do not block teardown

### EC-10: Insufficient Permissions
- Only owner, team lead, or admin can tear down
- Fail immediately with clear error message

### EC-11: App Name Typo in Confirmation
- Validate `confirmation` parameter against entity-derived appName
- Block at form step (ValidatedTextField + ui:validate)

### EC-12: Partial Deletion Failure Mid-Run
- No rollback — each step is idempotent
- Re-run teardown template to resume from where things still exist
- Task log shows exactly where it failed

### EC-13: GHCR Images Not Deletable
- Requires `delete:packages` scope on GITHUB_TOKEN
- If token lacks permission: warn user to manually delete GHCR packages, do not fail teardown

### EC-14: Multi-Env ArgoCD Apps (if governance plan implemented)
- Three ArgoCD apps: `<appName>-dev`, `<appName>-staging`, `<appName>-prod`
- Delete all three

### EC-15: App Was Never Registered in Catalog
- EntityPicker won't find the entity
- Fallback: manual input path for "emergency teardown by repo name"

---

## Deletion Dependency Order

```
K8s Target:
  1. Suspend ArgoCD auto-sync (prevent re-creation during teardown)
  2. Delete ArgoCD Application CR (with finalizer → cascades synced resources)
  3. Wait for ArgoCD app deletion to complete (poll until gone)
  4. Delete K8s namespace (cascades secrets, deployments, pods, services, ingresses, CNPG)
  5. Wait for namespace deletion (poll; patch stuck PVC finalizers if needed)
  6. Delete S3 CNPG backup prefix (if keepBackups=false)
  7. Delete GitHub repo (independent — can run in parallel with 4-6)
  8. Delete GHCR images (independent — can run in parallel)
  9. Unregister Backstage catalog entities

AWS Target (OpenTofu):
  1. Delete GHCR images (before tofu destroy — ECR images first)
  2. Run infra:tofu-apply with destroy=true
  3. Delete CloudWatch Log Groups (not in tofu state)
  4. Delete GitHub repo
  5. Unregister Backstage catalog entities
```

---

## New Scaffolder Actions Required

### `github:repo:delete`
- Input: `repoOwner`, `repoName`
- Behavior: DELETE /repos/{owner}/{repo}
- On 404: log warning, succeed (idempotent)
- On 403: fail with clear error (token lacks delete_repo scope)

### `kubernetes:delete-namespace`
- Input: `namespace`, `waitForDeletion` (bool, default true), `timeoutSeconds` (default 120)
- Behavior: kubectl delete namespace with grace-period=30
- Poll until gone; force-patch stuck PVC finalizers on timeout
- On 404: log warning, succeed (idempotent)

### `argocd:delete-app`
- Input: `appName`, `appNamespace` (default: argocd), `cascade` (bool, default true)
- Behavior: kubectl delete application in argocd namespace
- Ensure resources-finalizer set if cascade=true
- Poll until Application CR is gone
- On 404: log warning, succeed

### `catalog:unregister-entity`
- Input: `entityRef` (e.g., system:default/my-app)
- Behavior: Call catalog API to unregister entity and its location
- Also unregisters child entities sharing same location
- On 404: log warning, succeed

### `github:ghcr:delete-images` (V2)
- Input: `owner`, `packageName`
- Behavior: GitHub Package API delete all versions
- Requires delete:packages scope — warn on 403, do not fail teardown

### `aws:cloudwatch:delete-log-groups` (V2)
- Input: `logGroupPrefix` (e.g., /ecs/<appName>)
- Behavior: List + delete matching log groups

---

## Template Structure

```yaml
# templates/projects/teardown-app/template.yaml
# NOTE: Not registered in /create catalog — only reachable from entity page DangerZoneCard

parameters:
  # entityRef is injected by DangerZoneCard via URL query param — not shown as a field

  - title: Teardown Mode
    description: "Choose what you want to do with this application."
    properties:
      mode:
        type: string
        title: "Select teardown mode"
        enum: [dry-run, pause, destroy]
        enumNames:
          - "Dry-run — show what would be deleted without deleting anything (safe)"
          - "Pause — scale to zero (keep resources, stop costs)"
          - "Destroy — permanently delete all resources (irreversible)"
        default: dry-run          # ← ALWAYS defaults to safest option
        ui:widget: radio

  - title: Options
    properties:
      environment:
        type: string
        enum: [all, dev, staging, prod]
        default: all
        title: "Environment(s) to tear down"
      keepGitHubRepo:
        type: boolean
        default: false
        title: "Keep GitHub repository (code only, delete infra)"
      keepBackups:
        type: boolean
        default: false
        title: "Keep S3 / database backups"
      snapshotBeforeTeardown:
        type: boolean
        default: true
        title: "Take a database snapshot before teardown"
        description: "Recommended if this database has live data"
      scheduleFor:
        type: string
        title: "Schedule teardown (optional)"
        description: "Leave blank to run immediately. Use ISO 8601: 2026-04-10T02:00:00Z"
        ui:widget: text

  - title: Confirm
    properties:
      confirmation:
        type: string
        title: "Type the application name to confirm"
        ui:field: ValidatedTextField
      acknowledgeDataLoss:
        type: boolean
        title: "I understand this will permanently delete all data and cannot be undone"
        # required=true, shown only when mode=destroy and entity has app/database annotation

steps:
  - id: fetch-entity
    action: catalog:fetch-entity-info
    input:
      entityRef: ${{ parameters.entityRef }}

  # K8s steps — conditional on deploymentTarget
  - id: argocd-delete
    if: ${{ steps['fetch-entity'].output.deploymentTarget == 'kubernetes' }}
    action: argocd:delete-app
    input:
      appName: ${{ steps['fetch-entity'].output.appName }}-dev

  - id: k8s-delete-namespace
    if: ${{ steps['fetch-entity'].output.deploymentTarget == 'kubernetes' }}
    action: kubernetes:delete-namespace
    input:
      namespace: ${{ steps['fetch-entity'].output.appName }}-dev

  # AWS steps — conditional on deploymentTarget
  - id: tofu-destroy
    if: ${{ steps['fetch-entity'].output.deploymentTarget != 'kubernetes' }}
    action: infra:tofu-apply
    input:
      workingDir: ./infra
      destroy: true

  # Shared steps (always run)
  - id: delete-github-repo
    if: ${{ not parameters.keepGitHubRepo }}
    action: github:repo:delete
    input:
      repoOwner: ${{ steps['fetch-entity'].output.repoOwner }}
      repoName: ${{ steps['fetch-entity'].output.repoName }}

  - id: unregister-entity
    action: catalog:unregister-entity
    input:
      entityRef: ${{ parameters.entityRef }}
```

---

## RBAC Policy

In `packages/backend/src/plugins/permission.ts`:
- Teardown template: only owner, team leads (`*-lead`), or `backstage-admins`
- Gate on `scaffolder.template.instantiate` where `templateRef` includes `teardown-app`

---

## Entity Page Integration

Add `DangerZoneCard` component to the entity catalog page:
- Shown on Component entities (type: service, website) and System entities
- Red-outlined "Teardown Application" button
- onClick: navigate to `/create?template=teardown-app&formData={"entityRef":"<current entityRef>"}`
  — this pre-fills the scaffolder form and skips the EntityPicker step entirely
- Location: `packages/app/src/components/catalog/DangerZoneCard.tsx`
- Wire into entity page layout in `packages/app/src/App.tsx` (EntityLayout or ServiceEntityPage)
- **Not** registered in the template catalog (`/create`) — only accessible from the entity page

---

## V1 vs V2 Scope

### V1 (Must Have — ALL of these ship together or not at all)
- RBAC gate (owner/lead/admin only) — **implemented first, before any deletion action**
- Dry-run mode — **implemented second, before any real deletion**
- `github:repo:delete` action
- `kubernetes:delete-namespace` action (with stuck PVC recovery)
- `argocd:delete-app` action
- `catalog:unregister-entity` action
- Teardown template with mode selector (dry-run default / pause / destroy)
- Teardown options: keepGitHubRepo, keepBackups, snapshotBeforeTeardown, scheduleFor
- Confirmation (type exact app name) — blocks form submission if mismatch
- Data-loss acknowledgement checkbox — required when entity has a database
- Entity page DangerZone card (entity-page-only, not in /create)
- **Task completion notification** — ArgoCD cascade + namespace deletion can take 2-3 minutes; browser must not be required to stay open. Use `@backstage/plugin-notifications` to send an in-app notification on task `completed` or `failed`. Message includes: app name, outcome, and link to task log. This is mandatory — without it, users have no way to know if a background teardown succeeded or failed.

**Implementation order:** RBAC → dry-run → pause → destroy. Deploy and verify each mode before building the next.

### V2
- AWS/tofu destroy path (infra:tofu-apply with destroy=true already exists)
- `github:ghcr:delete-images` action
- `aws:cloudwatch:delete-log-groups` action
- Per-environment teardown (not just `all`)

---

## Files to Create/Modify

**engineering-standards repo:**
- `templates/projects/teardown-app/template.yaml` — NEW
- `templates/projects/catalog-info.yaml` — register teardown-app template

**backstage-main repo:**
- `packages/backend/src/plugins/scaffolder/actions/deleteGithubRepo.ts` — NEW
- `packages/backend/src/plugins/scaffolder/actions/deleteNamespace.ts` — NEW
- `packages/backend/src/plugins/scaffolder/actions/deleteArgocdApp.ts` — NEW
- `packages/backend/src/plugins/scaffolder/actions/unregisterCatalogEntity.ts` — NEW
- `packages/backend/src/plugins/scaffolder-actions-module.ts` — register new actions
- `packages/backend/src/plugins/permission.ts` — RBAC gate for teardown-app
- `packages/app/src/components/catalog/DangerZoneCard.tsx` — NEW entity page card

---

## Verification Checklist

1. Create test app via service-k8s template
2. Verify all resources exist: namespace, ArgoCD app, GitHub repo, catalog entity
3. Run teardown template as app owner
4. Verify each step succeeds in task log
5. Verify: namespace gone, ArgoCD app gone, GitHub repo 404, catalog entity 404
6. Run teardown template AGAIN → all steps log "not found, skipping" (idempotency)
7. Edge case: delete GitHub repo manually, THEN run teardown → succeeds with warning
