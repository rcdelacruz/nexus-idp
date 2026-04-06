# Scaffolder Template Visibility Plan

**Created:** 2026-03-26
**Reviewed:** 2026-03-28 (Backstage IDP expert audit)
**Owner:** Ronald
**Status:** Revised — original approach rejected by expert; updated with correct mechanism

---

## Goal

Control which Scaffolder templates each user can see, based on their team membership and role.

---

## User Types & Visibility Rules

| User Type | Catalog State | Sees |
|-----------|--------------|------|
| Admin | member of `backstage-admins` | All templates |
| Engineer | member of a dept team (`web-team`, `cloud-team`, etc.) | Own team templates |
| Trainee | member of `general-engineers` + member of `trainee-<dept>` synthetic group | Their dept's training templates only |
| Intern | member of `general-engineers` only, no `trainee-*` group | All training templates (no dept filter) |

---

## Template Tagging Convention ✓ (unchanged — this part was correct)

Every template in the `engineering-standards` GitHub repo must have:

### `spec.owner` — which team owns/manages this template
```yaml
spec:
  owner: group:default/web-team        # visible to web engineers + web trainees
  owner: group:default/cloud-team      # visible to cloud engineers + cloud trainees
  owner: group:default/general-engineers  # shared — visible to all authenticated users
```

### `metadata.tags` — for additional filtering
```yaml
metadata:
  tags:
    - web          # department tag (web | mobile | data | cloud | ai | qa)
    - training     # marks this as a training template
```

---

## Correct Permission Mechanism

> **Why the original approach was wrong:**
> The original plan proposed injecting a catalog client into `PermissionPolicy` to look up `spec.owner` and `metadata.tags` per request. This creates a circular dependency — the policy calls the catalog, the catalog call triggers a permission check, which calls the policy again. It also used `scaffolderTemplateReadPermission` which is not wired into the template listing endpoint in Backstage 1.49.1.

### What actually gates template visibility

Templates are catalog entities of kind `Template`. Their visibility is governed by **`catalogEntityReadPermission`**, not a scaffolder-specific permission. The correct approach is `AuthorizeResult.CONDITIONAL` — return a filter expression that the catalog evaluates on its own, without the policy calling back into the catalog.

### For engineer visibility (ownership-based)

Use a conditional decision based on `ownershipEntityRefs` — already available in the policy without any extra lookup:

```typescript
// Engineers see templates owned by their groups
if (request.permission === catalogEntityReadPermission) {
  if (isTemplateKind(request)) {
    return createConditionalDecision(
      catalogEntityReadPermission,
      catalogConditions.isEntityOwner({ claims: user.identity.ownershipEntityRefs })
    );
  }
}
```

### For trainee visibility (tag-based)

The catalog's standard conditional decisions cannot filter by `metadata.tags` out of the box — that requires a custom `PermissionRule`. The recommended approach is to avoid tag-based filtering entirely by encoding trainee state as catalog group membership (see DB Changes below).

---

## DB Changes

### New field: `trainee_department` on `user_management_users`

```sql
ALTER TABLE user_management_users
  ADD COLUMN trainee_department TEXT NULL;
```

Values: `web | mobile | data | cloud | ai | qa | null`

- `null` = intern (no dept assigned)
- Set by admin in User Management page

### Key change from original plan

`trainee_department` must also be emitted as a **synthetic catalog group** by `UserEntityProvider.ts`. When a user has `trainee_department = 'web'`, the entity provider adds `group:default/trainee-web` to their catalog user entity's `memberOf`. This makes it flow into `ownershipEntityRefs` automatically — no policy-side DB lookup needed.

The synthetic trainee groups (`trainee-web`, `trainee-mobile`, etc.) must also exist as `Group` entities in the catalog (can be emitted by the same provider or defined in `stratpoint/org/groups.yaml`).

---

## Implementation Steps

### Step 1 — Catalog groups for trainees
- Add `trainee-web`, `trainee-mobile`, `trainee-data`, `trainee-cloud`, `trainee-ai`, `trainee-qa` to `stratpoint/org/groups.yaml`
- These are children of `general-engineers`

### Step 2 — DB Migration (`UserStore.ts`)
- Add `trainee_department` column migration (follows existing pattern in `UserStore.ts`)
- Add `updateTraineeDepartment(name, dept)` method

### Step 3 — Entity Provider (`UserEntityProvider.ts`)
- When emitting a user entity, if `trainee_department` is set, add `group:default/trainee-<dept>` to `memberOf`
- This makes the trainee group flow into `ownershipEntityRefs` in the auth token

### Step 4 — Backend (`router.ts`)
- Expose `trainee_department` in `GET /me` response
- Add `PATCH /users/:name/trainee-department` endpoint (admin only)

### Step 5 — User Management Page
- Add "Set dept" button for users in `general-engineers` only
- Dropdown: Web / Mobile / Data / Cloud / AI / QA / None
- Calls new PATCH endpoint

### Step 6 — Permission Policy (`permission.ts`)
- Use `createConditionalDecision` with `catalogConditions.isEntityOwner` for Template kind
- Admin → ALLOW all
- Engineer → CONDITIONAL on `ownershipEntityRefs` matching `spec.owner`
- Trainee → CONDITIONAL on `ownershipEntityRefs` matching `spec.owner` (trainee-web owns training-web templates)
- Intern → CONDITIONAL: only templates owned by `general-engineers`
- _No catalog client injection needed — all data is in `ownershipEntityRefs`_

### Step 7 — Tag templates
- Update all templates in `engineering-standards` repo with `spec.owner` + `metadata.tags`
- Training templates: `spec.owner: group:default/trainee-web` (not `web-team`)
- Project templates: `spec.owner: group:default/web-team`
- Shared templates: `spec.owner: group:default/general-engineers`

---

## Department Group Mapping

| User Type | Catalog Groups | Sees |
|-----------|---------------|------|
| web engineer | `web-team` | templates owned by `web-team` |
| web trainee | `general-engineers` + `trainee-web` | templates owned by `trainee-web` |
| intern | `general-engineers` | templates owned by `general-engineers` |
| admin | `backstage-admins` | everything |

---

## Files to Change

| File | Change |
|------|--------|
| `stratpoint/org/groups.yaml` | Add `trainee-web/mobile/data/cloud/ai/qa` groups |
| `plugins/user-management-backend/src/database/UserStore.ts` | Add `trainee_department` column + method |
| `plugins/user-management-backend/src/service/router.ts` | Expose field in `/me`, add PATCH endpoint |
| `plugins/user-management-backend/src/UserEntityProvider.ts` | Emit synthetic `trainee-<dept>` group in `memberOf` |
| `plugins/user-management/src/components/UserManagementPage.tsx` | Add "Set dept" UI for trainees |
| `plugins/user-management/src/api/UserManagementApi.ts` | Add `setTraineeDepartment()` method |
| `packages/backend/src/plugins/permission.ts` | Add `createConditionalDecision` for Template kind |
| `engineering-standards` repo | Re-tag all templates with corrected `spec.owner` values |

---

## Open Questions

1. Should trainees see their dept's NON-training templates too, or training only?
   - Current plan: training only — achieved by `spec.owner: group:default/trainee-web` on training templates only

2. Who creates training templates — leads or admins only?
   - Current plan: leads + admins (same as current template creation permission)

3. Should `trainee-*` groups be parented under their dept team or under `general-engineers`?
   - Recommendation: parent under `general-engineers` to keep them clearly separate from full engineers
