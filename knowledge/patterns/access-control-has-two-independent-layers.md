
## "Can role X reach feature Y" has THREE independent, disconnected gates (2026-07-26, updated)

**Update:** a third gate was found the same day, in `packages/app/src/components/home/HomePage.tsx`
(~L79-93) — its own `useEffect` calls `identityApi.getBackstageIdentity()` directly and
redirects to `/onboarding` if `!hasDeptTeam && !admin`, completely independent of both
`permission.ts` and `Root.tsx`'s `isNewUser` state/redirect effect. Adding a route to
`Root.tsx`'s whitelist does NOT make it reachable if the page itself also self-redirects.
**Before declaring any route "now reachable by new users," grep the target page's own
component for `navigate(` / `useEffect` identity checks — don't assume Root.tsx is the only
gate just because it's the one you already know about.**

**The mistake:** During `/evaluate` + `/apply` on "let new/unassigned users access Local
Provisioner," the fix was made only in `packages/backend/src/plugins/permission.ts`
(`isUnassigned()` allow-list) and verified by simulating that policy's decision logic.
`/validate` confirmed the backend ALLOW and confirmed no `usePermission`/`RequirePermission`
hooks existed inside `plugins/local-provisioner/src`. Both checks passed. The feature was
deployed to production. It did not actually work: a new user hitting `/local-provisioner`
was still bounced straight back to `/onboarding`.

**Ground truth:** this app has a *second*, fully independent access-control layer that
never routes through `permission.ts` at all — `packages/app/src/components/Root/Root.tsx`:
- `AppSidebar`'s `isNewUser !== false` branch renders a hardcoded, different nav item list
  for new users (no Local Provisioner item there — see around L458).
- A `useEffect` (around L546) force-redirects any `isNewUser === true` user to `/onboarding`
  unless `location.pathname` matches a hardcoded `allowed = ['/onboarding', '/catalog', ...]`
  array.

Both are plain string/path checks against `isNewUser`, not permission-name lookups, not
imports of the local-provisioner plugin, not calls into `CatalogPermissionPolicy`. Backend
RBAC can say ALLOW while the frontend never lets the request happen.

**Why the knowledge graph didn't catch it either:** graphify builds edges from imports and
calls. `Root.tsx`'s gate is a literal string array compared against a pathname — there is no
import edge from `Root.tsx` to anything in `plugins/local-provisioner/`, so a `graphify query`
for "local provisioner permission" never surfaces `Root.tsx` as a neighbor. This is the same
class of blind spot the graph itself already flags in its own Surprising Connections /
Knowledge Gaps sections (string/HTTP coupling invisible to AST+semantic extraction) — treat
graph silence on a topic as "broaden the manual search," never as "nothing else to check."

**Rule going forward — for ANY "does role X have access to route/feature Y" question in this
codebase, check all three, not two:**
1. Backend policy — `packages/backend/src/plugins/permission.ts` (`CatalogPermissionPolicy.handle()`)
2. The plugin's own frontend gating — `usePermission()` / `RequirePermission` inside the
   plugin's own `src/`
3. The app shell — `packages/app/src/components/Root/Root.tsx` (sidebar nav conditionals
   AND the `isNewUser` redirect whitelist `useEffect`) — this file gates independently of
   `permission.ts` and is easy to miss because it isn't "permission" code, it's routing/nav
   code that happens to encode a second copy of the same policy.

`/validate` for any access-control change should include actually tracing the route through
`Root.tsx`, not just confirming the backend policy decision.
