# Pattern: a role stored as a flag that becomes a catalog group (User Management)

**Discovered:** 2026-11-02, adding the Instructor role (`is_instructor` → `instructors` group).

## Constraint

Groups in a user's token come from the catalog `User` entity's `memberOf`. For users managed in
User Management that entity is built by `UserEntityProvider` from the `user_management_users` row.
So a role is real only if all of these agree:

1. the row has the flag (`UserStore`, additive `hasColumn` + `alterTable` migration),
2. `UserEntityProvider.buildMemberOf` adds the group, **and the provider's visibility filter lets the
   user through** (it drops rows with no department team and no role; `general-engineers` is not in
   its `DEPT_TEAMS`, so a trainee-only holder of the role needs an explicit `|| u.is_<role>`),
3. the page lists the row (`isListed`) and builds its groups through the one `groupsOf` helper
   (the list load and the Assign dialog used to build them separately).

## Guards

- A **grant** to a row the provider never emits (no team, not admin) can never take effect: refuse it.
  A **revoke** must always work. A guard that covers both locks a privileged role in place for a row
  the flag itself keeps in the catalog (admin-without-team made instructor, then demoted). Found by
  independent review, reproduced with a failing test first.
- `/assign` (`upsert`) must not touch the flag: its UPDATE lists columns explicitly; assert it with a
  real-Postgres test rather than assuming.
- Access changes only when the person's session refreshes or they sign in again (the token carries the
  old groups). Same as admin promote/demote; say so in the confirm dialog.

## Testing notes

- Jest runs test files in parallel: two real-Postgres test files that both `DROP SCHEMA public` wipe
  each other. Give each file its own schema (`searchPath`).
- The first render of the Backstage `Table` in jsdom takes ~1.5 s: `await renderInTestApp(...)` before
  the first `findBy*`.
- The backend plugin is consumed from `dist/` (`main: dist/index.cjs.js`): rebuild it
  (`backstage-cli package build`) to check the compiled code; `deploy.sh`'s `yarn build:backend` does.
