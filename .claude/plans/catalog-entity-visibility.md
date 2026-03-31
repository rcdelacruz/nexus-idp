# Catalog Entity Visibility Plan

**Created:** 2026-03-31
**Updated:** 2026-03-31
**Owner:** Ronald
**Status:** Implemented (core filtering) — template visibility refinement pending

---

## Goal

Hard-filter the catalog so each role only sees entities relevant to them. Backend permission enforcement via `catalogEntityReadPermission` conditional decisions.

---

## Visibility Matrix (implemented)

| Role | Sees in Catalog | Sidebar |
|------|----------------|---------|
| **Intern/Trainee** (`general-engineers` only) | Training templates only | Onboarding, Docs, Tech Radar |
| **Dev + SA** (engineering teams + `sa-team`) | Components, APIs, systems, domains, resources, templates, users, groups | Full nav minus Projects, FinOps, User Mgmt |
| **PM** (`pm-team`, no engineering team) | Groups, users, + components owned by teams assigned to their projects | Projects section, no Create/Scaffolder |
| **PM + engineering team** | Union of PM + Dev visibility | Both Projects + Create |
| **Admin** (`backstage-admins`) | Everything | Full nav |

---

## Implementation (done)

### Permission Policy (`packages/backend/src/plugins/permission.ts`)

Uses `catalogConditions` with `createCatalogConditionalDecision`:

1. **Admin** → `ALLOW` (no filter)
2. **PM (pure)** → `isEntityKind(['group', 'user'])` OR `isEntityOwner(groups + projectTeamRefs)`
   - Queries `project_registration_projects` DB to resolve PM → project → team_name → team refs
   - PM sees components owned by teams assigned to their active projects
3. **Dev + SA** → `isEntityKind(['component', 'api', 'system', 'domain', 'resource', 'template', 'user', 'group'])`
4. **Fallback (intern/unassigned)** → `isEntityKind(['template'])` AND `hasSpec('type', 'training')`

### PM → Project → Team Resolution

The permission policy injects `DatabaseService` via the backend module. On PM catalog read:
1. Queries `project_registration_projects` WHERE `created_by = userEntityRef` AND `status = 'active'`
2. Extracts `team_name` values (e.g. `web-team`)
3. Converts to group refs: `group:default/web-team`
4. Passes as additional claims to `isEntityOwner`

### Sidebar Gating (`Root.tsx`)

- `isPM` role detection from JWT + catalog entity
- "Create" hidden for pure PM
- "Projects" visible for PM + Admin only
- "User Management" and "Teams" visible for Admin only
- "FinOps" visible for Admin only

### Search & API Explorer

Automatically filtered — both use `catalogEntityReadPermission` under the hood.

---

## Decisions (resolved 2026-03-31)

1. **PMs see their project teams' components.** Resolved via DB query in permission policy.
2. **Hidden entity relations: show name but block access.** Not yet implemented — needs frontend work.
3. **Search results are filtered.** Automatic — same permission applies.
4. **API Explorer has the same filters.** Automatic — same permission applies.

---

## Remaining Work

### Entity Relation Blocking (not yet implemented)
- When a visible entity has a relation to a hidden entity, show the name but block click
- Needs frontend changes to `EntityCatalogGraphCard` and relation components
- Show "Restricted" or permission denied when clicking blocked entity

### Template Visibility Refinement
- See `scaffolder-template-visibility.md` for the full plan
- Current state: devs see ALL templates, interns see training templates only
- Target: devs see only their team's templates + shared templates
- Requires tagging all templates with `spec.owner` in engineering-standards repo
- Trainee department assignment needs `trainee-*` synthetic groups

### Key Correlation with `scaffolder-template-visibility.md`
The scaffolder template visibility plan extends this catalog filtering with:
1. **Trainee department groups** (`trainee-web`, `trainee-mobile`, etc.) — Step 1-3 of that plan
2. **Per-team template ownership** — templates tagged with `spec.owner: group:default/web-team`
3. **`isEntityOwner` for templates** — devs see templates owned by their team + `general-engineers` shared ones
4. **DB field `trainee_department`** — drives synthetic group membership for trainees

Once `scaffolder-template-visibility.md` is implemented, the Dev+SA filter in this policy changes from:
```
isEntityKind(['component', 'api', ..., 'template', ...])
```
to:
```
isEntityKind(['component', 'api', ...]) OR (isEntityKind(['template']) AND isEntityOwner(claims))
```

This ensures devs only see templates owned by their team, not all templates.

---

## Files Changed

| File | Change |
|------|--------|
| `packages/backend/src/plugins/permission.ts` | Catalog read conditional decisions, PM project team query, role helpers |
| `packages/backend/src/plugins/permission-backend-module.ts` | Inject `DatabaseService` for project DB access |
| `packages/app/src/components/Root/Root.tsx` | `isPM` role, sidebar gating for Create, Projects, User Mgmt, Teams |
| `packages/app/src/components/home/HomePage.tsx` | Role-based homepage sections |
