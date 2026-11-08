# Permission System

Nexus IDP uses a custom RBAC permission policy implemented in `packages/backend/src/plugins/permission.ts`. Permissions are determined entirely by group membership — there are no permission flags stored on users.

## Role Hierarchy

| Role | Group Membership | Access Level |
|------|-----------------|--------------|
| **Platform Admin** | `backstage-admins` | Full access to all features including FinOps, catalog delete, user management |
| **Team Lead** | any group ending in `-lead` (e.g. `web-team-lead`) | Create and edit catalog entities; use all scaffolder templates |
| **Assigned Engineer** | `web-team`, `mobile-team`, `data-team`, `cloud-team`, `ai-team`, `qa-team` | Read catalog, use scaffolder, view K8s/ArgoCD, run local provisioner |
| **New User** | `general-engineers` only (not yet assigned to a dept team) | Engineering Docs, Tech Radar, Local Provisioner, read-only catalog browse — redirected to onboarding |
| **Instructor** | `instructors` (in addition to a team — it does not replace one) | The Trainees view and capstone management in the Local Provisioner (see below) |

## Permission Matrix

| Permission | Admin | Lead | Engineer | New User |
|------------|-------|------|----------|----------|
| Catalog read/list | ✓ | ✓ | ✓ | ✓ (read-only) |
| Catalog entity create | ✓ | ✓ | ✗ | ✗ |
| Catalog entity delete | ✓ | ✗ | ✗ | ✗ |
| Catalog entity refresh | ✓ | ✓ | ✓ | ✗ |
| Scaffolder — use templates | ✓ | ✓ | ✓ | ✗ |
| Scaffolder — manage templates | ✓ | ✓ | ✗ | ✗ |
| TechDocs / Engineering Docs | ✓ | ✓ | ✓ | ✓ |
| Kubernetes / ArgoCD | ✓ | ✓ | ✓ | ✗ |
| Local Provisioner | ✓ | ✓ | ✓ | ✓ |
| FinOps Dashboard | ✓ | ✗ | ✗ | ✗ |
| Search | ✓ | ✓ | ✓ | ✓ |

### Instructor permissions

The `instructors` group is a trainer role, independent of the department team. Admins have all of these already; nobody else does.

| Permission | Admin | Instructor | Everyone else |
|------------|-------|------------|---------------|
| `local-provisioner.trainees.read` — Trainees view: every trainee's labs and repository activity | ✓ | ✓ | ✗ |
| `local-provisioner.trainees.manage` — remove a trainee, optionally deleting their lab repository | ✓ | ✓ | ✗ |
| `local-provisioner.capstones.manage` — capstone enrollments, instructor-only answer keys and credentials, Day-3/Day-4 handouts, checks and grading, marking a capstone done and reading or discarding its kept report | ✓ | ✓ | ✗ |

## How Group Membership Is Determined

Groups are resolved from the Backstage token's `ownershipEntityRefs` claim. There are two sources:

1. **Catalog entity** (`example-org/org/users.yaml`) — only break-glass admin users are defined here. Their group memberships come from `memberOf` in the YAML.

2. **UserEntityProvider** (user-management plugin) — all other users are managed in the `backstage_plugin_user-management` PostgreSQL database. The `UserEntityProvider` reads this DB every 60 seconds and injects User entities into the catalog with their assigned teams.

When a new user signs in (Google or GitHub), they are auto-provisioned with `general-engineers` membership until a platform admin assigns them to a department team.

## Granting Admin Access

Add the user to `backstage-admins` via the User Management UI → Promote to Admin, or directly set `isAdmin: true` in the database.

Only `admin.user` is defined in `example-org/org/users.yaml` as a break-glass admin — this user always has admin access even if the database is unavailable.

## Granting Instructor Access

Platform admins use the User Management UI → the graduation-cap action on a user's row (**Make instructor** / **Revoke instructor**). It sets an `is_instructor` flag on the user's record; the `UserEntityProvider` then adds the `instructors` group to the user's catalog entity within about a minute. The role is independent of the department team, so an instructor can be on any team (or only a trainee).

The person's token still carries their old groups until their session next refreshes or they sign in again — the same as for admin promote/demote. Only users who have finished onboarding can be made instructors; the role can always be revoked.

## Implementation

The policy is in `packages/backend/src/plugins/permission.ts` and is registered in `packages/backend/src/plugins/permission-backend-module.ts` using the `policyExtensionPoint`.

```typescript
// Key functions in permission.ts:
const isAdmin   = (groups) => groups.some(g => g === 'group:default/backstage-admins' || g === 'group:default/admins');
const isLead    = (groups) => groups.some(g => g.endsWith('-lead'));
const isEngineer = (groups) => groups.some(g => DEPT_TEAMS.includes(g));
const isUnassigned = (groups) => !isAdmin(groups) && !isLead(groups) && !isEngineer(groups);
```

## Adding a New Permission

1. Define the permission in the relevant plugin's `permissions.ts`
2. Add a case in `packages/backend/src/plugins/permission.ts` under the appropriate role check
3. Use `usePermission()` hook in the frontend to gate UI elements
