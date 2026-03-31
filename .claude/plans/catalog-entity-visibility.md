# Catalog Entity Visibility Plan

**Created:** 2026-03-31
**Owner:** Ronald
**Status:** Draft — pending implementation

---

## Goal

Hard-filter the catalog so each role only sees entities relevant to them. Not a default filter — actual backend permission enforcement.

---

## Visibility Matrix

| Role | Sees in Catalog |
|------|----------------|
| **Intern/Trainee** (`general-engineers` only) | Training templates only |
| **Dev + SA** (all dept teams + `sa-team`) | Components, services, APIs, libraries, training templates |
| **PM** (`pm-team`) | Projects, teams, components owned by their team |
| **Admin** (`backstage-admins`) | Everything |

---

## Implementation

### Backend: Permission Policy (`packages/backend/src/plugins/permission.ts`)

The Backstage catalog has a built-in permission: `catalogEntityReadPermission`. The custom permission policy can intercept this and conditionally allow/deny based on the entity kind, type, and the user's group membership.

```typescript
// Pseudo-code for the permission check:
if (permission === catalogEntityReadPermission) {
  const entityKind = resourceRef?.kind;
  const entityType = resourceRef?.spec?.type;

  if (isAdmin(groups)) return ALLOW; // admin sees everything

  if (isIntern(groups)) {
    // Only training templates
    return entityKind === 'Template' && entityType === 'training' ? ALLOW : DENY;
  }

  if (isPM(groups)) {
    // Projects, teams, and components owned by their team
    if (entityKind === 'Group') return ALLOW;
    // TODO: check ownership relation to PM's team
    return CONDITIONAL; // needs entity-specific check
  }

  // Dev + SA — components, services, APIs, libraries, training templates
  if (['Component', 'API', 'Resource', 'System', 'Domain'].includes(entityKind)) return ALLOW;
  if (entityKind === 'Template' && entityType === 'training') return ALLOW;
  if (entityKind === 'Template') return ALLOW; // devs use scaffolder
  return DENY;
}
```

### Challenges

1. **Conditional permissions**: The catalog permission system uses `ConditionalPolicyDecision` with `catalogConditions`. Filtering by entity kind/type requires the `isEntityKind` and `isEntityOwner` conditions.

2. **PM ownership**: PM should see components owned by their team. This requires checking the entity's `owner` spec field against the PM's team membership. The `isEntityOwner` condition handles this.

3. **Entity relations**: If a Component is hidden from a PM, but a visible Project depends on it, the relation graph will show broken links. Need to decide: show the relation as "restricted" or hide it entirely.

4. **Search**: The search plugin also needs to respect these filters, or users can find entities via search that they can't see in the catalog.

5. **Entity detail pages**: Direct URL access (`/catalog/default/component/my-service`) must also be blocked if the user doesn't have read permission.

### Steps

1. **Add entity kind/type conditions to permission policy** — extend `CustomPermissionPolicy` in `permission.ts` to filter `catalogEntityReadPermission` based on user role
2. **Test with each role** — verify intern sees only training, dev sees components+APIs, PM sees projects+team components, admin sees all
3. **Handle entity relations** — decide on broken link behavior
4. **Verify search respects filters** — search results should not leak hidden entities
5. **Update API Explorer** — same filtering should apply (APIs are entities)

### Dependencies

- Backstage catalog permission conditions: `@backstage/plugin-catalog-common/alpha`
- `catalogConditions.isEntityKind()`, `catalogConditions.isEntityOwner()`
- Permission policy already exists at `packages/backend/src/plugins/permission.ts`

---

## Risks

- **Breaking change**: Users who previously saw everything will suddenly see less. Communicate the change.
- **Performance**: Conditional permissions add overhead to every catalog request. The catalog fetches many entities per page.
- **Entity relations**: Hidden entities break the dependency graph. May need a "restricted" placeholder.
- **PM ownership check**: Requires knowing which team the PM manages and which components belong to that team's projects. The project-registration DB has this data but the catalog doesn't query it natively.

---

## Decisions Needed

1. Should PMs see ALL components or only their team's? (ownership-based vs role-based)
2. What happens to entity relations pointing to hidden entities?
3. Should search results also be filtered?
4. Should the API Explorer page have the same filters?
