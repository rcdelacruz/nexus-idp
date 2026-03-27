# User & Group Management

Nexus IDP manages users through a combination of auto-provisioning on first sign-in and admin assignment to department teams. **Users are NOT managed via `example-org/org/users.yaml`** — that file is reserved for break-glass admin accounts only.

## How User Provisioning Works

### First Sign-In (Auto-Provisioning)

When a new `@yourcompany.com` user signs in via Google or GitHub for the first time:

1. The auth module checks if a catalog entity (`user:default/<name>`) exists
2. If not found, the user is issued a token with `general-engineers` membership
3. The user is redirected to `/onboarding` where they complete their profile
4. On onboarding completion, the user is written to the `user_management_users` database table
5. The `UserEntityProvider` picks up the new record within ~30 seconds and creates a catalog entity

### Team Assignment

New users remain in `general-engineers` (limited access) until a platform admin assigns them to a department team:

1. Admin opens **User Management** in the sidebar
2. Finds the user (they appear after completing onboarding)
3. Assigns them to one or more department teams
4. The `UserEntityProvider` syncs within ~30 seconds — the user's catalog entity is updated
5. On the user's next page load / token refresh, they get full engineer access

## Department Teams

| Team | Group Ref |
|------|-----------|
| Web | `group:default/web-team` |
| Mobile | `group:default/mobile-team` |
| Data | `group:default/data-team` |
| Cloud | `group:default/cloud-team` |
| AI | `group:default/ai-team` |
| QA | `group:default/qa-team` |

All teams are defined in `example-org/org/groups.yaml`.

## GitHub Account Linking

Users can link their GitHub username during onboarding or later. Linking enables:
- GitHub sign-in (resolves to the same user entity)
- Correct `github.com/user-login` annotations on the catalog entity

Two methods:
- **Auto-link**: the system searches GitHub for the user's `@yourcompany.com` email (only works if the email is set as the public GitHub email)
- **Manual link**: user enters their GitHub username; the backend verifies ownership via OAuth token or checks the account's public email

## Admin Operations (User Management UI)

Platform admins (`backstage-admins`) can perform the following in the **User Management** page:

| Action | Description |
|--------|-------------|
| View all users | Lists all users in the database with their teams and GitHub link status |
| Assign team | Set one or more department teams for a user |
| Promote to admin | Grant `backstage-admins` membership (adds to `backstage-admins` group in catalog) |
| Demote from admin | Remove admin role (cannot self-demote) |
| Remove user | Revokes session + deletes from database (cannot self-delete) |

## Break-Glass Admin (users.yaml)

`example-org/org/users.yaml` contains only `admin.user` — the break-glass admin whose catalog entity is defined statically. This ensures at least one admin exists even if the database is empty or unavailable.

To add another break-glass admin:

```yaml
# example-org/org/users.yaml
---
apiVersion: backstage.io/v1alpha1
kind: User
metadata:
  name: firstname.lastname
spec:
  profile:
    email: firstname.lastname@yourcompany.com
    displayName: Firstname Lastname
  memberOf: [backstage-admins]
```

## Adding a Team

Edit `example-org/org/groups.yaml`:

```yaml
---
apiVersion: backstage.io/v1alpha1
kind: Group
metadata:
  name: new-team
spec:
  type: team
  parent: engineering-dept
  children: []
```

Then add `new-team` to the `DEPT_TEAMS` constant in:
- `packages/backend/src/plugins/permission.ts`
- `plugins/user-management-backend/src/service/router.ts`
- `plugins/onboarding/src/components/OnboardingPage/OnboardingPage.tsx`

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| User stuck on `/onboarding` after registering | `UserEntityProvider` hasn't synced yet | Wait ~30s; check `user-management-backend` logs |
| User sees limited access after being assigned a team | Token not refreshed yet | User should sign out and sign back in |
| "Only @yourcompany.com users may register" error | `organization.domain` config mismatch | Verify `app-config.yaml: organization.domain: yourcompany.com` |
| Ghost row with `teams=[]` | User started onboarding but didn't finish | Admin can reassign or delete via User Management UI |
