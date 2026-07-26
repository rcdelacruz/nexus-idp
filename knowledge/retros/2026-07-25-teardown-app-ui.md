# Teardown Application UI — implementation retro (2026-07-25)

Ported `scripts/teardown.sh` into the IDP as a governed scaffolder feature: a
"Danger Zone" card on service/website/system entity pages that launches the
`teardown-app` template (RBAC-gated, dry-run by default). Full plan:
`.claude/plans/teardown-application-plan.md`. Not yet deployed or run against
a live cluster.

## What shipped

First pass (V1, K8s-only) shipped, then extended same-day to cover AWS +
backups after the user pushed back on the initial "AWS is V2" scope cut —
see "AWS scope correction" below.

- 8 new scaffolder actions: `teardown:discover-resources` (live discovery,
  mirrors `teardown.sh` Phase 1 including AWS infra repos + CNPG backup
  credential extraction), `argocd:delete-app`, `kubernetes:delete-namespace`
  (with stuck-finalizer recovery), `github:repo:delete`,
  `catalog:unregister-entity`, `notification:send`, `infra:destroy-aws-repos`
  (dispatch + poll + conditional repo delete), `aws:s3-delete-backups` (AWS
  SDK, not the `aws` CLI — see below).
- Shared K8s client extracted from `kubernetesApply.ts` into `scaffolder/lib/k8sClient.ts`.
- RBAC gate in `permission.ts`: engineers explicitly denied `teardown-app`
  regardless of template ownership; leads/admins/devops allowed via existing
  governance-template policy.
- `DangerZoneCard.tsx` on entity pages, `TeardownEntityRefField` +
  `ConfirmAppNameField` custom scaffolder fields, `@backstage/plugin-notifications`
  + `-backend` + `signals-backend` newly installed, `@aws-sdk/client-s3` added
  to `packages/backend`.
- `engineering-standards`: `tofu-destroy` job added to all 4 infra skeleton
  workflows (`aws-ec2`, `aws-rds`, `aws-ecs-cluster`, `aws-eks-cluster`),
  triggered via `workflow_dispatch` with a `destroy` input.

## AWS scope correction (same day, after initial "done")

Initial `/apply` scoped AWS out as "V2" without checking whether it was
actually needed — it is; `service-ecs`/`service-ec2`/`infra-aws-*` templates
are live in this catalog. On investigation, found `infra:tofu-apply` (the
backend action AWS teardown would have been built on) is **dead code** — no
template calls it, and no backend Dockerfile installs `tofu`, `git`, or the
`aws` CLI. AWS provisioning actually works by pushing tofu files to a new
repo and letting that repo's own `tofu.yml` GitHub Actions workflow (OIDC
role, `aws-actions/configure-aws-credentials`) apply them — the backend never
runs `tofu` directly. So AWS teardown had to follow the same path: dispatch a
new `tofu-destroy` job on each infra repo's existing workflow via
`github:dispatch-workflow`'s pattern, poll the run to completion, then delete
the repo only on success. This is `infra:destroy-aws-repos`, not a
"run tofu in the backend" action.

**Bug caught during this work, worth remembering:** GitHub Actions `if:`
conditions in YAML that start with `!` (e.g. `!(a && b)`) break plain YAML
parsing — `!` is a node-tag indicator, so `!(github.event_name == ...)`
parses as an attempt to invoke a custom YAML tag named `(github.event_name`,
not as a string. Validated by stripping `{% raw %}` wrappers and running
`yaml.safe_load` on all 4 workflow files before considering the edit done —
this caught it. Fix: phrase the condition to avoid a leading `!`
(`github.event.inputs.destroy != 'destroy'` instead of
`!(github.event_name == 'workflow_dispatch' && github.event.inputs.destroy == 'destroy')`).

## Non-obvious constraints discovered mid-implementation (worth remembering)

1. **This app's scaffolder form does not support `?formData=` pre-fill.**
   The Backstage SDK ships `useFormDataFromQuery` for exactly this, but
   `CustomTemplateWizardPage.tsx` (this repo's hand-rolled wizard, needed
   because of the legacy `createApp` setup) uses plain `useState({})` and
   never calls it. Any future "deep link into a scaffolder form with a
   pre-filled field" work must use a custom field extension that reads
   `window.location.search` directly on mount (see `GitHubUsernameField.tsx`
   for the established pattern) — not URL query/router state.

2. **Backend permission policy can't see scaffolder task *parameters*.**
   `scaffolder.task.create` is authorized against the *template* catalog
   entity (`isResourcePermission(..., RESOURCE_TYPE_CATALOG_ENTITY)`), not
   against the entity the task's `entityRef` parameter points to. "Only the
   app's owner can tear it down" (from the original plan doc) is therefore
   not expressible as a permission-policy condition — RBAC had to be scoped
   down to leads/admins/devops only. If per-target-entity authorization is
   ever needed, it has to happen inside the scaffolder action itself (fetch
   the target entity, compare `spec.owner` to the calling user), not in
   `permission.ts`.

3. **Custom field extension `validation` functions actually gate the Next
   button.** `CustomTemplateWizardPage.tsx` wires `customFieldExtensions[].validation`
   into `createAsyncValidators` → `hasSchemaErrors`. Existing fields
   (`ValidatedTextField` etc.) only register `component`, not `validation` —
   their "live error" display is cosmetic; the actual submit-blocking floor
   is JSON Schema (`pattern`/`minLength`/etc.) checked by ajv. For a check
   that depends on *another field's value* (confirmation text must match a
   dynamically-selected app name — JSON Schema can't express that), a
   `validation` function reading `context.formData` is the way to actually
   block submission, not just show red text.

4. **No per-step loop construct in this Backstage version's scaffolder
   templates.** Iterating `teardown:discover-resources`' array outputs (N
   namespaces, N ArgoCD apps) across N step invocations isn't possible.
   Actions that operate on a discovered list take the list directly and
   loop internally (`argocd:delete-app` takes `apps: {namespace,name}[]`,
   `kubernetes:delete-namespace` takes `namespaces: string[]`) — same
   convention `kubernetes:apply` already uses for multi-doc manifests.

## Backlog (deferred from the original plan, not silently — flagging here)

- **`snapshotBeforeTeardown` and `scheduleFor` template parameters** — in the
  original plan's V1 "Must Have" list, dropped during `/plan` without
  separately calling them out to the user. Neither has a backing action.
  `scheduleFor` in particular would need a real scheduling mechanism (cron
  task or delayed scaffolder run) that doesn't exist anywhere in this repo yet.
- **"Pause" mode** (scale-to-zero) — dropped; `teardown.sh` never implemented
  it, so there was nothing to port.
- **Data-loss acknowledgement is unconditional** — required even in dry-run
  mode, since template.yaml has no conditional-required wiring proven safe in
  this app's ajv setup. Minor UX friction, not a safety gap (over-cautious,
  not under).
- **Not deployed or run against a live cluster/GitHub org.** Typecheck +
  lint are clean; functional correctness of the live discovery queries
  (namespace listing, ArgoCD cluster-wide list, catalog two-pass annotation
  query, AWS Resource-entity + GitHub-topic discovery) is unverified
  end-to-end. `infra:destroy-aws-repos`' dispatch→poll→delete flow is
  especially untested against a real GitHub Actions run — needs a real
  dry-run, then a real destroy, against a disposable test app (ideally one
  with an actual AWS infra repo) before this is "done" per
  [[feedback_deploy_test_before_done]].
- **`infra:destroy-aws-repos` timeout (900s default) may be too short for
  EKS** — EKS cluster teardown can take 15-20+ minutes in practice; worth
  raising the default or making it obviously configurable once tested against
  a real EKS destroy.
