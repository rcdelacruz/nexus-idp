# Backstage Version Bump Plan
**From:** 1.49.1  
**To:** Latest stable (via `yarn backstage-cli versions:bump`)  
**Date drafted:** 2026-06-27  
**Status:** Ready to execute

---

## Executive Summary

Bump all `@backstage/*` and `@backstage-community/*` packages to the latest stable release. One mandatory code change required before the TypeScript gate passes. One community plugin must be pinned. Everything else is safe.

---

## Pre-conditions

Before starting:
- [ ] `develop` branch is clean (`git status` shows no uncommitted changes)
- [ ] k8s base image at `192.168.2.101:5000/backstage:latest` is current (homelab deploy succeeds)
- [ ] No in-flight feature branch that will conflict with `permission.ts` or `apis.ts`

---

## Impact Assessment (Verified)

### Required code changes — 1 file

**`packages/backend/src/plugins/permission.ts`**  
`plugin-permission-node` 0.10→0.11 removes `PolicyQueryUser.token`, `.identity`, and `.expiresInSeconds`.  
The current code incorrectly types the `handle()` second argument as `BackstageIdentityResponse` and accesses `.identity.ownershipEntityRefs` / `.identity.userEntityRef`. After the bump, `PolicyQueryUser` no longer has `.identity` — this is a TypeScript error AND a runtime crash.

Fix: change to `PolicyQueryUser`, remap `.identity.*` → `.info.*`.

### Safe — zero code changes

| Package | Change | Verified safe because |
|---------|--------|-----------------------|
| `plugin-scaffolder-backend` 3→4 | SecureTemplater memory mgmt | Internal only; custom actions use `plugin-scaffolder-node` APIs |
| `plugin-scaffolder-react` 1→2 | Major version | All 4 imported APIs (`FieldExtensionComponentProps`, `useTaskEventStream`, `useTemplateSecrets`, `scaffolderApiRef`) confirmed present in v2 dist |
| `plugin-auth-node` 0.6→0.7 | `SignInResolverFactoryOptions` generic | Project has zero calls to `createSignInResolverFactory` |
| `plugin-catalog-react` 2→3 | Zod v3→v4 internal | No API surface change; project has zero direct Zod imports |
| `plugin-sonarqube` 0.10→1.1 | `SonarQubeApi` interface replaced | Project only uses `EntitySonarQubeCard`, never the API directly |
| `TemplateWizardPageProps` (alpha) | Shape verified | Identical in v1.36 (installed) and v1.38 (target) |
| `@roadiehq/backstage-plugin-argo-cd` | Not in release manifest | Only declares React/react-router peers — compatible with all target Backstage versions. Leave at current `^2.8.6` / `^4.7.1`. |
| `@backstage/backend-common` | Listed in package.json, not imported | Dead dependency in `finops-backend` and `local-provisioner-backend`. `versions:bump` updates the semver string but zero compilation impact. |

### Pin — BUI migration, visual regression

**`@backstage-community/plugin-github-actions` 0.8→1.2**  
v1.0.0 migrated from MUI to Backstage UI (BUI). The `GithubActionsClient.getOctokit` monkey-patch in `apis.ts` is still functional in v1.2.0 (confirmed in dist source). Risk is visual only: BUI components won't inherit the Geist MUI theme, making the CI/CD tab look inconsistent.  
**Decision: pin at `^0.8.0` after `versions:bump` overwrites it.**

---

## Execution Steps

### Phase 1 — Code fix + bump (local, no deploy yet)

```bash
# 1. Create branch
git checkout -b chore/backstage-version-bump

# 2. Apply mandatory code change to permission.ts (see spec below)

# 3. Run the bump
yarn backstage-cli versions:bump

# 4. Re-pin github-actions (versions:bump will have bumped it to 1.x)
# Edit packages/app/package.json — revert @backstage-community/plugin-github-actions to ^0.8.0

# 5. Install
yarn install

# 6. TypeScript gate — MUST pass before any commit
yarn tsc --noEmit 2>&1 | tee /tmp/tsc-output.txt
# If errors: fix them. Do not proceed past this gate with errors.

# 7. Backend build gate — MUST pass
yarn build:backend 2>&1 | tee /tmp/build-output.txt
```

### Phase 2 — Commit

```bash
# Verify backstage.json was updated
cat backstage.json

git add packages/backend/src/plugins/permission.ts \
        packages/app/package.json \
        packages/backend/package.json \
        backstage.json \
        yarn.lock \
        $(find plugins -name package.json | tr '\n' ' ')

git commit -m "chore: bump Backstage to vX.Y.Z

- Update all @backstage/* and @backstage-community/* packages
- permission.ts: migrate PolicyQueryUser.identity -> .info (permission-node 0.11)
- Pin @backstage-community/plugin-github-actions at ^0.8.0 (BUI migration deferred)
- @roadiehq/* left at current versions (not in release manifest, compatible)"
```

### Phase 3 — Homelab smoke test

Wait for explicit user go-ahead before deploying.

```bash
# After approval:
git push origin chore/backstage-version-bump
# Merge to develop (or deploy from branch)
bash scripts/deploy.sh
```

**Smoke test checklist (in order of risk):**
1. [ ] Google OAuth login — full sign-in flow completes
2. [ ] Catalog browse — entity list loads, entity pages open
3. [ ] Permission check — non-admin cannot delete entities (test with a regular user)
4. [ ] PM user — catalog visibility filtered to owned-team entities only
5. [ ] Scaffolder — run one template end-to-end (not dry-run)
6. [ ] Custom field extensions — `DeploymentTargetPicker`, `ValidatedTextField` render in wizard
7. [ ] CI/CD tab (`EntityGithubActionsContent`) — workflow runs load correctly
8. [ ] ArgoCD tab — apps list loads (uses homelab ArgoCD)
9. [ ] Engineering Docs — markdown renders from GitHub
10. [ ] FinOps page — loads for admin, denied for non-admin
11. [ ] K8s tab — pods visible on a component with `backstage.io/kubernetes-id`

### Phase 4 — ECS deploy

Wait for explicit user go-ahead after homelab confirmed.

```bash
# Must use Dockerfile.with-migrations with --squash
docker build --squash \
  -t 746540123485.dkr.ecr.us-west-2.amazonaws.com/backstage-idp-prod:latest \
  -f Dockerfile.with-migrations .
aws ecr get-login-password --region us-west-2 --profile cost-admin-nonprod \
  | docker login --username AWS --password-stdin \
    746540123485.dkr.ecr.us-west-2.amazonaws.com
docker push 746540123485.dkr.ecr.us-west-2.amazonaws.com/backstage-idp-prod:latest
cd infra && AWS_PROFILE=cost-admin-nonprod tofu apply -auto-approve
AWS_PROFILE=cost-admin-nonprod aws ecs update-service \
  --cluster stratpoint-backstage-prod-cluster \
  --service stratpoint-backstage-prod-service \
  --force-new-deployment --region us-west-2
```

Verify `portal.stratpoint.io` — repeat smoke test items 1, 2, 3, 5.

### Phase 5 — Release + nexus-idp sync

Only after user confirms ECS is stable. Follow `feedback_release_workflow.md`:
1. Merge `develop` → `main` immediately (no version needed yet)
2. Push `main` to origin
3. Ask user for version tag
4. Create tag on `main`, create GitHub release
5. Switch to `rcdelacruz` gh account, sync nexus-idp, switch back

---

## Code Change Spec — permission.ts

```diff
- import { BackstageIdentityResponse } from '@backstage/plugin-auth-node';
  import { PermissionPolicy, PolicyQuery } from '@backstage/plugin-permission-node';
+ import { PermissionPolicy, PolicyQuery, PolicyQueryUser } from '@backstage/plugin-permission-node';

  async handle(
    request: PolicyQuery,
-   user?: BackstageIdentityResponse,
+   user?: PolicyQueryUser,
  ): Promise<PolicyDecision> {
-   const groups = user?.identity.ownershipEntityRefs ?? [];
+   const groups = user?.info.ownershipEntityRefs ?? [];

    // ... (line 148)
-   const projectTeamRefs = await this.getProjectTeamRefs(user.identity.userEntityRef);
+   const projectTeamRefs = await this.getProjectTeamRefs(user.info.userEntityRef);
```

Note: `BackstageUserInfo` (on `PolicyQueryUser.info`) has both `userEntityRef: string` and `ownershipEntityRefs: string[]` — exact same fields, different parent object.

---

## Rollback Plan

If homelab smoke test fails after deploy:
```bash
# Roll back to previous image (deploy.sh kept the previous tag)
kubectl set image deployment/backstage backstage=192.168.2.101:5000/backstage:previous -n backstage
# OR redeploy from previous commit
git revert HEAD
bash scripts/deploy.sh
```

If ECS fails:
```bash
# ECS keeps previous task definition — force it to use the previous revision
AWS_PROFILE=cost-admin-nonprod aws ecs update-service \
  --cluster stratpoint-backstage-prod-cluster \
  --service stratpoint-backstage-prod-service \
  --task-definition <previous-revision-arn> \
  --force-new-deployment --region us-west-2
```

---

## Future Work (not this bump)

- Upgrade `@backstage-community/plugin-github-actions` to 1.x: replace the `getOctokit` monkey-patch with a proper implementation that constructs Octokit via the proxy URL at instantiation time (subclass or factory). Then address BUI visual integration with `theme.ts`.
- Update `@roadiehq/backstage-plugin-argo-cd` separately once a Backstage release aligns with the Roadie release cadence.
