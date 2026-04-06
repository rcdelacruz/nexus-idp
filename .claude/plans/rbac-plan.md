# RBAC Plan — Stratpoint Internal Developer Portal

**Created:** 2026-03-25
**Last Updated:** 2026-03-25
**Status:** ✅ Implemented
**Depends on:** User management plan (auto sign-in provisioning)

---

## Proposed Roles

| Role | Backstage Group | Who Gets It |
|------|----------------|-------------|
| **Platform Admin** | `backstage-admins` | Portal maintainers (Ronald + designated leads) |
| **Team Lead** | `*-lead` groups (e.g. `web-lead`) | Engineering team leads per department |
| **Engineer** | `web-team` / `mobile-team` / `data-team` / `cloud-team` / `ai-team` / `qa-team` | Engineers per department |
| **New User (unassigned)** | `general-engineers` | Default on first login, until assigned to a department |

## Group Structure

```
engineering-dept
├── general-engineers      ← ALL engineers (base group, everyone is a member)
├── web-team               ← web engineers (also in general-engineers)
│   └── web-lead
├── mobile-team
│   └── mobile-lead
├── data-team
│   └── data-lead
├── cloud-team
│   └── cloud-lead
├── ai-team
│   └── ai-lead
└── qa-team
    └── qa-lead

backstage-admins           ← platform admins (cross-cutting, not under engineering-dept)
```

**Membership rules:**
- New user (unassigned) → `general-engineers` only → **viewer only** until onboarding is completed
- Assigned engineer → `general-engineers` + `web-team` → full access scoped to own department
- Team lead → `general-engineers` + `web-team` + `web-lead` → lead permissions for own department

`general-engineers` = base group for all registered users (assigned by `UserEntityProvider`).
Department group = scopes which resources they can see.
`*-lead` group = grants elevated permissions within that department.

### New User (Unassigned) Rules — enforced until onboarding complete

A user who has NOT completed onboarding (no dept team assigned):

| Restriction | Enforced By |
|-------------|-------------|
| ❌ Cannot create projects (scaffolder blocked) | `permission.ts` — DENY before scaffolder check |
| ❌ Cannot be assigned to a team by themselves | Admin-only action; new users can't see User Management |
| ❌ Does NOT appear in User Management admin list | Ghost row filter in `UserManagementPage` + `UserEntityProvider` |
| ❌ Cannot access catalog write operations | `permission.ts` — DENY |
| ❌ Cannot access FinOps, K8s, ArgoCD | `permission.ts` — DENY + sidebar redirect |
| ✅ Can read Engineering Docs | `permission.ts` — ALLOW |
| ✅ Can read Tech Radar | `permission.ts` — ALLOW |
| ✅ Can access Onboarding page | `permission.ts` — ALLOW + sidebar |
| ✅ Can connect GitHub account | Onboarding page — GitHub OAuth |

**Completing onboarding** = submitting the registration form with a dept team selected.
After registration, `UserEntityProvider` syncs the new catalog entity (up to 60s) and full access is unlocked.

---

## Permissions Per Feature

### Catalog
| Action | Platform Admin | Team Lead | Engineer | New User (unassigned) |
|--------|---------------|-----------|----------|-----------------------|
| View entities | ✅ | ✅ (own team) | ✅ (own team only) | ❌ |
| Create entities (components, APIs) | ✅ | ✅ (own team) | ❌ | ❌ |
| Edit entities | ✅ | ✅ (own team) | ❌ | ❌ |
| Delete entities | ✅ | ❌ | ❌ | ❌ |
| Unregister entities | ✅ | ✅ (own team) | ❌ | ❌ |

### Scaffolder (Templates)
| Action | Platform Admin | Team Lead | Engineer | New User |
|--------|---------------|-----------|----------|----------|
| Use templates | ✅ | ✅ | ✅ | ❌ |
| Create/edit templates | ✅ | ❌ | ❌ | ❌ |

### FinOps Dashboard
| Action | Platform Admin | Team Lead | Engineer | New User |
|--------|---------------|-----------|----------|----------|
| View cost data | ✅ | ❌ | ❌ | ❌ |
| View unused resources | ✅ | ❌ | ❌ | ❌ |
| Edit resource tags | ✅ | ❌ | ❌ | ❌ |
| Delete resources | ✅ | ❌ | ❌ | ❌ |

### Engineering Docs
| Action | Platform Admin | Team Lead | Engineer | New User |
|--------|---------------|-----------|----------|----------|
| Read docs | ✅ | ✅ | ✅ | ✅ |
| Add/configure doc sources | ✅ | ❌ | ❌ | ❌ |

### Tech Radar
| Action | Platform Admin | Team Lead | Engineer | New User |
|--------|---------------|-----------|----------|----------|
| View radar | ✅ | ✅ | ✅ | ✅ |
| Add/edit entries | ✅ | ❌ | ❌ | ❌ |

### Kubernetes
| Action | Platform Admin | Team Lead | Engineer | New User |
|--------|---------------|-----------|----------|----------|
| View pods/deployments | ✅ | ✅ (own team) | ✅ (own team) | ❌ |

### ArgoCD
| Action | Platform Admin | Team Lead | Engineer | New User |
|--------|---------------|-----------|----------|----------|
| View deployment status/history | ✅ | ✅ (own team) | ✅ (own team) | ❌ |
| Trigger sync | ✅ | ✅ (own team) | ❌ | ❌ |

### Local Provisioner
| Action | Platform Admin | Team Lead | Engineer | New User |
|--------|---------------|-----------|----------|----------|
| Provision own environment | ✅ | ✅ | ✅ | ❌ |
| View all tasks | ✅ | ✅ (own team) | ✅ (own only) | ❌ |
| Cancel/retry any task | ✅ | ✅ (own team) | ✅ (own only) | ❌ |

### User Management (future)
| Action | Platform Admin | Team Lead | Engineer | New User |
|--------|---------------|-----------|----------|----------|
| View team members | ✅ | ✅ | ✅ | ❌ |
| Assign user to team | ✅ | ✅ (own team) | ❌ | ❌ |
| Change user role | ✅ | ❌ | ❌ | ❌ |
| Approve team join requests | ✅ | ✅ (own team) | ❌ | ❌ |

### Onboarding
| Action | Platform Admin | Team Lead | Engineer | New User |
|--------|---------------|-----------|----------|----------|
| Complete own checklist | ✅ | ✅ | ✅ | ✅ |
| Mark steps complete for others | ✅ | ✅ (own team) | ❌ | ❌ |
| Configure checklist steps | ✅ | ❌ | ❌ | ❌ |

---

## Role Assignment Flow

```
New hire logs in with @stratpoint.com Google account
        ↓
Auto-created as Engineer in general-engineers group
        ↓
Platform Admin or Team Lead assigns to correct team
        ↓
Team Lead role granted manually by Platform Admin
```

---

## Current State vs Target

| Today | Target |
|-------|--------|
| `backstage-admins` = full access | `backstage-admins` = Platform Admin only |
| Everyone else = same permissions | New User / Engineer / Team Lead / Admin distinctions |
| No FinOps access control | FinOps = Platform Admin only |
| No concept of "team lead" | `*-lead` groups with scoped elevated permissions |
| No department scoping | Engineers see own department resources only |
| Manual user YAML on day 1 | Auto sign-in → `general-engineers` → department assigned |
| No offboarding process | Manual removal now → auto via Workspace sync later |

---

## Open Questions — All Decided

1. **FinOps visibility** — ✅ Platform Admin only.
2. **Team Lead role** — ✅ Separate `*-lead` groups. Lead is member of both `web-team` + `web-lead`.
3. **Viewer role** — ✅ No viewer role. Everyone is an engineer in a department.
4. **Cross-team visibility** — ✅ Engineers scoped to own team/domain only. Multi-department engineers get union of all their teams.
5. **Self-service catalog** — ✅ Engineers read-only. Leads create/manage own team. Admins create/manage all.
6. **New hire access** — ✅ Onboarding checklist + Engineering Docs + Tech Radar only. Nothing else until department assigned.
7. **K8s + ArgoCD** — ✅ All engineers view own team. Leads trigger ArgoCD sync for own team. Admins unrestricted.
8. **Tech Radar edit** — ✅ Platform Admin only.
9. **Multi-department** — ✅ Engineers can belong to multiple department groups. Access = union of all teams.
10. **Offboarding** — ✅ Manual (admin removes from YAML) now. Automatic (Google Workspace sync detects suspended account) after Phase 1A.

---

## Catalog Creation Guardrails

| Layer | Mechanism | Enforced By | Priority |
|-------|-----------|-------------|----------|
| 1 | Ownership enforcement — `spec.owner` must match creator's team | `permission.ts` | High |
| 2 | Required fields — `spec.owner`, `spec.system`, `spec.lifecycle`, `metadata.description` must be present | Catalog validator | High |
| 3 | Scaffolder templates only — leads use approved templates, no raw YAML registration | Permission policy + templates | High |
| 4 | Naming convention — `{team}-{service-name}` pattern | Scaffolder form validation | Medium |
| 5 | Audit log — who created/edited/deleted what and when | Catalog event system | Medium |

**Implementation order:** Layer 3 → Layer 1 → Layer 2 → Layers 4 & 5

---

## Implementation Approach (after alignment)

Backstage RBAC is implemented in `packages/backend/src/plugins/permission.ts`.
Currently it's binary: `backstage-admins` = admin, everyone else = user.

To support the roles above:
- Check user's group membership in the permission policy
- Apply different rules based on group (admin / lead / engineer / viewer)
- For "own team" scoping: compare resource owner tag to user's group membership

**Effort:** Small-Medium — all in one file (`permission.ts`), no new plugins needed.

---

## Migration Plan

1. ✅ Create `general-engineers` group in `groups.yaml`
2. ✅ Implement auto sign-in provisioning (puts new users in `general-engineers`)
3. ✅ Move existing `users.yaml` engineers to correct team groups
4. ✅ Implement new permission policy
5. ✅ Test each role manually before deploying

---

## Implementation Notes (2026-03-25)

### Admin Role — Two Paths, Same Result
| Path | Mechanism | Latency | Use Case |
|------|-----------|---------|----------|
| `users.yaml` `memberOf: [backstage-admins]` | Catalog (YAML file) | Immediate | Bootstrap admin / break-glass. Keep permanently — never remove the platform admin entry. |
| DB `is_admin=true` via `/promote` API | `UserEntityProvider` sync | ~1 min | Self-registered engineers elevated via the portal. |

Both produce identical `backstage-admins` catalog group membership and identical permissions.

### Multi-Department Engineers
- ✅ Implemented: engineers can be assigned to multiple dept teams via checkboxes in Assign dialog
- `is_lead` is global: if true, user gets `*-lead` group added for ALL their assigned teams
- Access = union of all assigned teams' permissions
- `UserEntityProvider.buildMemberOf()` handles this correctly — emits all teams + all lead groups

### Ghost Row Design
- When a user links GitHub before completing registration, `updateGithubUsername` creates a minimal DB row (`teams=[], is_admin=false`)
- Ghost rows are **filtered** from: User Management page, `UserEntityProvider` catalog sync
- Filter: `teams.length > 0 || is_admin === true`
- Ghost rows are harmless in DB — they preserve the GitHub username so it's retained when the user completes registration
- `users.yaml`-defined users (e.g. platform admin) who go through onboarding may accumulate ghost rows — these are filtered correctly and their YAML definition remains authoritative

### `general-engineers` Group
- Added by `UserEntityProvider.buildMemberOf()` for ALL registered users (anyone with teams or is_admin)
- NOT hardcoded in the User Management page display (removed) — only the actual dept teams and lead/admin groups are shown
- Grants base permissions: scaffolder, catalog, local provisioner (per permission.ts)
