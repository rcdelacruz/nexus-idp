# User Management & Onboarding Plugin Roadmap

**Created:** 2026-03-24
**Last Updated:** 2026-03-25
**Owner:** Ronald
**Guiding Principle:** You can't have FinOps team attribution without reliable team data. Fix the people layer first.

---

## Problem Statement

Right now:
- New engineers are added manually to `stratpoint/org/users.yaml`
- Team membership is hardcoded in `stratpoint/org/groups.yaml`
- There is no onboarding flow — new users figure things out themselves
- FinOps tag `team` / `owner` has no authoritative source to validate against
- The portal has no concept of "joining a team" or "requesting access"

---

## Phase 1 — User Sync (Stop manual YAML editing)

**Goal:** Every `@stratpoint.com` Google account is automatically a Backstage user. No more `users.yaml` PR on day 1.

### 1A — Google Workspace Entity Provider
> Full plan already exists: `.claude/plans/google-workspace-provisioning.md`

- Custom `GoogleWorkspaceEntityProvider` using Google Directory API
- Syncs users + groups hourly via Backstage `SchedulerService`
- Users appear in catalog automatically on first Google login
- Groups map from Google Workspace groups → Backstage Groups
- `backstage-admins@stratpoint.com` Google group → admin permissions (no more YAML for this)
- Keep `users.yaml` only for service accounts / bots

**Effort:** Medium (1–2 weeks)
**Blocker:** Google Cloud service account + domain-wide delegation setup (manual, ~1 day)

### 1B — Sign-in Auto-Provisioning
- Today: user must exist in `users.yaml` before they can log in
- Goal: first Google login creates the user in Backstage automatically
- Use `signIn.resolver` in auth config to auto-create entity on first login
- New users land in `general-engineers` group by default
- Admin/team lead assigns to correct team later

**Effort:** Small (few hours, config + auth plugin tweak)
**Depends on:** `general-engineers` group existing in `groups.yaml`

### 1C — GitHub Email Enforcement
- During onboarding: new user creates GitHub account with `@stratpoint.com` email
- Backstage GitHub sign-in resolver checks that the GitHub account has a verified `@stratpoint.com` email
- If no verified `@stratpoint.com` email on GitHub account → sign-in rejected with clear message
- No GitHub Enterprise required — enforced at Backstage auth layer only
- When GitHub Enterprise is adopted later → upgrade to SAML SSO for org-level enforcement

**Effort:** Small (sign-in resolver + onboarding checklist step)
**Note:** Enforces at portal level only. Engineers can still access GitHub org directly — full lockdown requires SAML SSO later.

---

## Phase 2 — Onboarding Plugin

**Goal:** A new user's first day in the portal walks them through everything they need. No Notion doc, no Slack thread.

### 2A — Onboarding Checklist Page (`/onboarding`)
A page that shows a checklist of steps for new engineers:

| Step | What it does |
|------|-------------|
| Profile complete | Name, photo, team — pulled from Google Workspace |
| GitHub account | Create GitHub account using `@stratpoint.com` email + connect it in the portal |
| Local dev environment | Trigger Local Provisioner agent setup |
| Catalog tour | Links to their team's services in the catalog |
| First PR checklist | Link to engineering standards |

- Checklist persists state per user (PostgreSQL, `onboarding_progress` table)
- "Done" steps stay green on return visits
- Admins can mark steps required vs optional per team

**Effort:** Medium (1–2 weeks, new plugin)

### 2B — Team Assignment Flow
- New hire picks their team on first login (if not already in a Workspace group)
- Team lead gets a Backstage notification to approve
- On approval: user added to Google Workspace group → syncs back to Backstage
- Or: admin manually assigns team from a management UI

**Effort:** Medium-Large (approval workflow is the complex part)
**Depends on:** 1A (groups must come from Google Workspace, not YAML)

### 2C — New User Welcome Card (Homepage)
- Show onboarding card on the homepage if user's `onboarding_progress` is < 100%
- Disappears once all required steps are done
- "X of Y steps complete" progress bar

**Effort:** Small (frontend only, reads onboarding API)

---

## Phase 3 — Team Management Plugin (`/team-management`)

**Goal:** Team leads manage their own teams without filing a YAML PR or asking an admin.

### 3A — Team Directory Page
- List all Backstage groups with member counts
- Click a team → see members, their roles, their catalog components
- Filter by department

**Effort:** Small (frontend only, Catalog API already has this data)

### 3B — Self-Service Team Membership
- "Join this team" request button
- Team lead approves/denies from a UI
- Backend: calls Google Workspace Groups API to add member → syncs back

**Effort:** Medium

### 3C — Team Resource Dashboard (links FinOps Phase 2)
- Team page shows: members + their catalog services + AWS cost this month
- This is what FinOps Phase 2A (cost attribution to teams) plugs into
- Requires: AWS tag `team` values → match against Backstage group names

**Effort:** Small (frontend only once FinOps 2A is done)

---

## Phase 4 — Access Management

**Goal:** Engineers request access to things, leads approve, audit trail exists.

### 4A — Access Request Workflow
- Request elevated permissions (admin, specific system access)
- Lead approves → Backstage permission updated
- Audit log: who approved what, when

**Effort:** Large

### 4B — Offboarding Checklist
- When a user is removed from Google Workspace, Backstage detects the sync diff
- Trigger: remove from groups, flag their catalog components for reassignment
- Notify their team lead

**Effort:** Medium

---

## Sequencing & Dependencies

```
Phase 1A (Google Workspace sync)
    └── Phase 1B (auto sign-in provisioning)
            └── Phase 2A (onboarding checklist)
                    └── Phase 2B (team assignment flow)
                    └── Phase 2C (welcome card)
                            └── Phase 3A (team directory)
                                    └── Phase 3B (self-service membership)
                                    └── Phase 3C (team resource dashboard)  ← needs FinOps 2A
```

---

## Why This Unlocks FinOps Phase 2

FinOps tag compliance today flags resources with missing `team` / `owner` tags.
But there's no authoritative list of valid team names to validate against.

Once Phase 1 is done:
- Backstage groups = source of truth for valid team names
- FinOps can validate: "this resource's `team` tag doesn't match any Backstage group" → flag it
- Cost attribution becomes: sum AWS spend by `team` tag → join to Backstage group → show on team page

The tag editor we built in FinOps Phase 1E already writes the tags. Phase 3C is just the read side.

---

## Current State

| Item | Status | Notes |
|------|--------|-------|
| Manual `users.yaml` / `groups.yaml` | ✅ Interim only | DB-backed now; `users.yaml` kept permanently for bootstrap admin (break-glass fallback). Never remove the platform admin entry. |
| Google Workspace plan | ✅ Drafted (see google-workspace-provisioning.md) | |
| Group structure (new RBAC groups) | ✅ Done | `general-engineers`, 6 dept teams + leads, replaced old frontend/backend/devops-team |
| Auto sign-in provisioning (1B) | ✅ Done | `packages/backend/src/plugins/google-auto-provision.ts` — new `@stratpoint.com` users → `general-engineers` |
| Full RBAC permission policy | ✅ Done | `packages/backend/src/plugins/permission.ts` — Admin / Lead / Engineer / New User roles |
| Sidebar role enforcement | ✅ Done | `Root.tsx` — new user (3 items), engineer (full), admin only (FinOps). New hires redirected from restricted routes. |
| DB-backed UserStore + UserEntityProvider | ✅ Done | `plugins/user-management-backend/` — PostgreSQL `user_management_users`, syncs to catalog every 60s via `catalogModule` (pluginId:'catalog') |
| Ghost row filtering | ✅ Done | `UserEntityProvider` and `UserManagementPage` both filter rows with `teams=[] AND is_admin=false`. Prevents ghost rows (GitHub-linked but not yet registered) from showing in admin UI or being emitted as catalog entities that could override `users.yaml` definitions. |
| GET /me endpoint | ✅ Done | `router.ts` — returns authenticated user's own DB record. Used by onboarding to check GitHub link status without catalog sync. |
| GitHub status — DB-only | ✅ Done | `useGitHubStatus` in `OnboardingPage` uses `GET /me` as sole source of truth. Removed OAuth session fallback. GitHub is only "linked" when saved in DB. |
| updateGithubUsername upsert | ✅ Done | `UserStore.updateGithubUsername` creates a minimal row if none exists (so GitHub can be linked before registration completes). Row is filtered from UI/catalog until teams are assigned. |
| Onboarding page (`/onboarding`) | ✅ Done | `plugins/onboarding/` — DB-backed GitHub status, GitHub OAuth connect (no manual entry), @stratpoint.com email validation, new user banner |
| User Management page (`/user-management`) | ✅ Done | `plugins/user-management/` — DB-backed, ghost row filter, multi-team assignment (checkboxes), lead groups in display, pre-populated Reassign dialog, optimistic state updates (no page refresh needed). |
| Multi-department assignment | ✅ Done | Assign dialog uses checkboxes — engineers can be in multiple dept teams. Access = union of all teams. `is_lead` is global (lead in ALL assigned teams). |
| `users.yaml` bootstrap design | ✅ Decided | `users.yaml` = permanent break-glass for platform admin. DB path = for all self-registered engineers. Both produce identical `backstage-admins` group membership; YAML is immediate, DB path has ~1 min catalog sync delay. |
| GitHub OAuth link in onboarding | ✅ Done | `githubAuthApiRef.getAccessToken` → auto-links account. Backend verifies @stratpoint.com via `/user/emails` (includes private emails). |
| Backend @stratpoint.com enforcement | ✅ Done | `router.ts` — `assertStratpointUser()` validates userEntityRef format on all endpoints |
| GitHub email enforcement (1C) | ✅ Done | `packages/backend/src/plugins/github-email-enforcement.ts` — custom GitHub auth module, calls `/user/emails` OAuth API, rejects sign-in if no verified `@stratpoint.com` email |
| Session revocation | ✅ Done | `revocationModule.ts` — synchronous middleware, no Promise bridge. If store not ready → `next()` immediately. Deleted users get 401 on all subsequent requests. |
| 401 fix (fetchApiRef) | ✅ Done | `packages/app/src/apis.ts` — uses `createFetchApi` + `FetchMiddlewares.injectIdentityAuth`. Revocation 401 triggers `identityApi.signOut()`. |
| Team assignment flow (2B) | 🔲 Future | Approval workflow — depends on Google Workspace sync (1A) |
| Google Workspace sync (1A) | 🔲 Future | Needs Workspace admin + service account setup |
| Access request workflow (4A) | 🔲 Future | |

---

## Admin Setup Portal (Planned)

**Problem:** On a fresh Backstage deployment, admins bypass the user onboarding flow (step 1 auto-marked done because `identity.isAdmin === true`). This means admins never call `POST /register` and have no row in `user_management_users`. When they try to mark onboarding steps 3 & 4 (catalog-tour, engineering-docs), `UPDATE WHERE name = ?` finds no row and silently fails.

**Root cause:** The current onboarding page is designed for new engineers, not for admins doing initial portal setup.

**Proposed solution:** A dedicated **Setup Portal** page (`/setup`) for admins on a fresh installation:
- Appears automatically for admins when the DB has no registered users yet (fresh install detection)
- Separate from the user onboarding flow — focused on portal configuration, not personal onboarding
- One-time flow: once marked complete, accessible from sidebar but no longer auto-shown

**Proposed setup steps (to be decided by Ronald):**
1. Verify GitHub catalog integration (autodiscovery working, entities loaded)
2. Check all integrations healthy (ArgoCD, K8s, FinOps, Redis)
3. Register admin profile in DB (fixes the silent step-save bug)
4. Invite/assign first team members
5. Mark setup complete

**Interim fix (not yet applied):** Auto-create minimal admin row in `user_management_users` when `POST /onboarding-step` is called and no row exists. This unblocks the current issue without the full Setup Portal build.

**Status:** 🔲 Planned — design TBD by Ronald

---

## What's Next

1. **Google Workspace sync (1A)** — biggest remaining ROI, eliminates manual YAML forever. Needs Workspace admin.
2. **Admin Setup Portal** — design and build dedicated first-run experience for admins (see section above)
3. **Team assignment approval flow (2B)** — after 1A is done (groups come from Workspace, not YAML)

The YAML-based user management (current state) is the interim solution until 1A is live.
