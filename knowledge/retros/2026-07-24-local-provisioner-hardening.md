# Retro — Local Provisioner hardening (2026-07-24)

E→P→A→V pass over `plugins/local-provisioner-backend/` + `packages/backstage-agent/`.

## Headline

**The module had never worked in production.** `TaskStore` read and wrote nine columns that no
migration ever created, so agent registration threw before anything else was reached.
`tasks=0 agents=0` on the homelab confirmed it: the feature is documented, deployed, wired
into the sidebar, and has never completed a single lifecycle.

## Patterns worth keeping

**1. Empty tables are a signal, not a convenience.**
`agents=0` was the tell. A feature shipped 7 months ago with zero rows is not "unused" — it is
usually broken. Check row counts before assuming a subsystem works.

**2. Absence of errors in logs proves nothing when usage is zero.**
The backend logs were clean, which initially read as reassuring. They were clean because
nobody ever got far enough to generate an error. "No errors" and "no traffic" look identical
from the outside.

**3. Migrations and the code that uses them drift silently.**
Nothing in `yarn tsc`, `yarn lint`, or CI compares a knex migration to the columns a store
actually references. TypeScript validates the *interface*, not the *table*. Here `types.ts`
was correct all along — it was the migrations that had fallen behind, and neither side could
detect the other.
→ Worth building: a startup or CI check that diffs `information_schema.columns` against the
columns each store touches. Related backlog: **F2**, which should be re-scoped — transformer
tests over types that match neither the DB nor the migrations prove very little.

**4. Test a migration on a scratch database, not the live one.**
`CREATE DATABASE lp_migration_test` → run the full chain → assert schema → exercise the exact
knex calls the store makes → test `down()` → drop. Full confidence, zero risk to production.
Pattern is reusable for any migration in this repo.

**5. Deleting code invalidates line numbers in documentation.**
Removing 301 lines from `agentRoutes.ts` and 45 from `AgentService.ts` silently broke every
`file:line` citation written earlier in the same session — including one in `CLAUDE.md`.
→ Re-grep and re-verify every `file:line` reference after any large deletion. Caught during
validation, not before.

## Constraint discovered

**graphify does not auto-update in this repo.** The `/apply` skill states a `PostToolUse` hook
runs `graphify update .` after every edit. No hooks are configured in `.claude/settings.json`,
`.claude/settings.local.json`, or `~/.claude/settings.json`. `graph.json` was ~19 hours stale
during `/validate`, so the blast-radius query returned pre-change data — it still listed the
old `AUTHENTICATION.md` title as a node.
→ Either configure the hook or run `graphify update .` manually before trusting a graph query.
Do not assume the graph reflects the working tree. Incremental update cost ≈ 36k output
tokens (full rebuild ≈ 674k, 464 files) per `graphify-out/cost.json`.

**Corollary — the graph cannot see HTTP coupling.** `graphify path` found *no path* between
`agentRoutes.ts` and the agent CLI, because they are joined only by the wire contract. For
route changes the graph structurally understates blast radius; verify against a running client
instead.

**6. Doc drift clusters — fix one instance, grep for the rest.**
The "tokens expire in 30 days" claim (actual: 24h) appeared in **six** files across three
packages. The plan enumerated four; validation's repo-wide grep found two more in
`packages/backstage-agent/docs/index.md` and one in
`plugins/local-provisioner/docs/authentication.md`. A single wrong fact propagates by
copy-paste — always finish with a repo-wide grep for the *claim*, not just the file.

## Backlog (found, not fixed — outside this task)

- **`packages/backstage-agent/docs/` leaks Stratpoint identifiers to the public downstream.**
  `index.md` contains a hardcoded org email domain and portal URL (pre-existing since
  commit `2dd4eac`). That path is **not** on the nexus-idp exclusion list, so it syncs to the
  public repo. Either genericize the file or add the directory to the exclusion list. The
  release leak scan greps the staged diff, so it would only catch this on a release where the
  file happens to change.

## Second pass — F-1, F-3(identity), F-8 (same day)

**7. "Breaking change" is a function of current state, not the change itself.**
F-1 (sign the tokens) was gated as breaking because it invalidates installed agents' tokens.
But `agents=0` and registration had always thrown — there were no working tokens to break. The
cost of the fix was contingent on production state we'd already measured. **Re-derive whether
something is actually breaking from current data before deferring it** — the "breaking" label
had been carried forward from the plan without re-checking. Fixing it now (before the schema
fix lets agents register) was the cheapest it will ever be.

**8. A `|| fallback` on identity is a silent-isolation bug.**
`taskRoutes.ts` had `req.user?.email || 'developer@example.com'` in five places — but the
middleware set `userEntityRef`, never `email`, so the fallback fired every time and all users
shared one identity. The `|| default` made a broken wiring look like working code. **For
identity/authz, never default — return undefined and fail loudly.** A placeholder identity is
worse than an error because it looks like success. Grep the codebase for `?.email ||`,
`userId ||`, `|| 'anonymous'`-style patterns.

**9. `node:crypto` HMAC over a JWT library, in this repo specifically.**
Chose `createHmac`/`timingSafeEqual` rather than `jsonwebtoken` (which was present in the tree
but undeclared in the plugin's package.json). Given this repo's documented history of the
Docker build breaking on undeclared transitive deps, a zero-dependency signer is the lower-risk
choice. Payload was only `{sub, iat, exp}` — full JWT semantics weren't needed.

**10. `undefined` as a "not configured" test sentinel collides with default params.**
`makeService(secret = SECRET)` + `makeService(undefined)` silently handed back the real
secret, so the "fails with no secret" test passed a secret and failed. Use `null` as the
explicit "absent" sentinel when the parameter has a default.

**11. The first `.test.ts` under `plugins/*/src` breaks repo-wide `tsc`.**
Root `tsconfig.json` included `plugins/*/src` without excluding test files, so jest globals
(`it`, `expect`) produced 27 `tsc` errors even though `backstage-cli package test` compiled
them fine. Added `**/*.test.ts(x)` to tsconfig `exclude`. Anyone adding the first colocated
unit test will hit this. Reinforces the prior jest30 retro: **source typecheck and test
typecheck are different gates** — run both.

## Third pass — F-3 routing (same day)

**12. Verify framework path-matching from source, not memory.**
The whole F-3 fix depended on what `addAuthPolicy({path:'/'})` matches. Read the actual
`createCredentialsBarrier.cjs.js` in node_modules: `createPathPolicyPredicate('/')` returns
`() => true` — a match-everything predicate. Confirmed the blanket disabled framework auth
plugin-wide (finding was right), and that non-`/` policies use `end:false` with a segment
boundary (so the framework side never had the `/healthfoo` bug the router middleware did).
Guessing the matching semantics would have produced a wrong fix.

**13. One list, two enforcement layers.** The plan called for removing the blanket; the deeper
fix was making the framework barrier (plugin.ts) and the router middleware (router.ts) read
the *same* `PUBLIC_AGENT_PATHS`. Two hand-maintained public-path lists is the drift the
finding described; a shared constant + a tested `isPublicAgentPath` removes the drift class
entirely, not just this instance.

**14. Auth changes verify against callers, not just the endpoint.** Before removing the
blanket, checked that every browser caller of a newly-framework-protected route already sends
a Backstage bearer token (`LocalProvisionerClient`, `DeviceAuthPage`). A route flipping to
"auth required" only regresses if a caller wasn't sending credentials — that check is on the
client side, where the graph gives no help (HTTP coupling again).

## Still open

- **F-1** ✅ resolved — HMAC-signed tokens, 12/12 tests
- **F-2** ✅ resolved — dead auth path deleted
- **F-3** ✅ resolved — deny-by-default (blanket removed, shared path list), identity bug
  fixed; 27 classification tests. Two-layer runtime interaction still best confirmed on the
  live backend (standard auth-change caveat).
- **F-4** ✅ resolved — migration 004
- **F-5** ✅ resolved — service_token column dropped
- **F-7** ✅ resolved — 6 docs corrected
- **F-8** ⚠️ partial — live DB identified, lock script fixed; drop the empty underscore DB +
  check RDS still to do (prod-state decisions, not code)
- **F-6** ❌ open — single-replica coupling (in-memory SSE map + rate-limit MemoryStore).
  Explicitly de-scoped earlier; not required for the module to function.
- AWS RDS never checked — homelab only, by decision. F-1's non-breaking claim rests on this.
- **Nothing deployed.** All of the above is verified locally but not on any live target.
- Tests: 39 passing (AgentService 12, publicPaths 27) — the repo's first backend unit tests.
