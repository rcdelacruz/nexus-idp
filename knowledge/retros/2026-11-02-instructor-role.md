# Retro: Instructor role in User Management (2026-11-02)

Branch `feat/instructor-role`, uncommitted, not merged, not deployed. Pattern:
`knowledge/patterns/role-flag-that-feeds-a-catalog-group.md`.

## Went well
- The `instructors` group and everything that reads it already existed; the work was the missing
  way to put someone in it. Reading the provider's visibility filter first found the trainee-only
  case (`general-engineers` is not in its `DEPT_TEAMS`) before any code was written.
- Verified through the real chain, not only unit tests: route → real `UserStore` on Postgres →
  real `UserEntityProvider` entity, then the compiled `dist/` over a real socket, then the built
  frontend bundle. Every rule was broken on purpose once and a test failed each time.
- An independent read of the diff found a real defect the author's own tests missed (the "has not
  finished onboarding" guard also blocked revoking). Reproduced with a failing test first, then fixed.

## Went badly
- Two Postgres test files wiped each other's tables when Jest ran them in parallel; the first
  passing runs were single-file runs. Run the whole suite more than once before trusting it.
- A doc section was inserted in the middle of another one and stranded its last paragraph.

## Backlog (pre-existing, not caused by this change)
- User Management → "Make admin" updates `isAdmin` in the row but not its Groups column
  (`currentGroups` keeps the old list until the page reloads). One line with `groupsOf` now.
- `UserManagementPage.tsx` lines 749-750: nested ternary lint errors in the Activity table.
- `UserManagementPage.tsx` imports `@internal/plugin-local-provisioner` (a mixed-plugin-import warning).
- Docs said the user provider syncs every 30 seconds; it is 60 (`module.ts`). Fixed in
  `permission-system.md` and in all three places in `user-group-management.md`.
