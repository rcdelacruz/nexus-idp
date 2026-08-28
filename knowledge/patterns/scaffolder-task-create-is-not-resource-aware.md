
## scaffolder.task.create cannot be resource-conditional in PermissionPolicy.handle() (2026-07-26)

**The mistake:** `packages/backend/src/plugins/permission.ts` had (in two places — the
`isUnassigned()` new-user branch, and the assigned-engineer/lead scaffolder branch)
`createCatalogConditionalDecision` logic gating `scaffolder.task.create` by template
`spec.type`/`spec.owner` — e.g. "unassigned users may only run training-type templates,"
"engineers may not run devops-team-owned templates," "teardown-app is leads/admins only."
All of it was dead code. It looked correct, passed review, and matched the doc comments —
but it never once evaluated against a real template, for any role, ever.

**Root cause:** `POST /api/scaffolder/v2/tasks` (in
`node_modules/@backstage/plugin-scaffolder-backend/dist/service/router.cjs.js`) checks
`scaffolder.task.create` via:
```js
await checkPermissions.checkPermission({
  credentials,
  permissions: [alpha.taskCreatePermission],
  permissionService: permissions$1,
});
```
`checkPermission()` calls `permissionService.authorize([{permission}], {credentials})` —
**no resourceRef, no template, no entity of any kind.** `taskCreatePermission`'s own
`resourceType` is `RESOURCE_TYPE_SCAFFOLDER_TASK` ("scaffolder-task"), not
`RESOURCE_TYPE_CATALOG_ENTITY` ("catalog-entity"). So inside `PermissionPolicy.handle()`,
`isResourcePermission(request.permission, RESOURCE_TYPE_CATALOG_ENTITY)` is **always false**
for this specific check — any `if (isResourcePermission(...)) { return createCatalogConditionalDecision(...) }`
guard is simply never entered; execution falls through to whatever the surrounding code does
next (in this codebase's case, an unconditional `ALLOW` for assigned engineers — meaning the
devops-owned-template and teardown-app restrictions were **never enforced**, for anyone, ever,
via a direct API call — only the catalog-visibility filtering on the template *list* stopped
regular use of the UI from reaching those templates).

**How this was found:** a new user hit `NotAllowedError` trying to run a training template
that should have been explicitly allowed. Tracing the stack (`checkPermission.cjs.js:18` →
`router.cjs.js:343`) led straight to the no-resourceRef call above.

**The fix:** real per-template enforcement cannot live in `PermissionPolicy.handle()` for
this permission — the framework never gives it the information needed. It has to intercept
the HTTP request itself, before the scaffolder plugin's own router runs, where the request
body (and thus `templateRef`) actually exists. See
`packages/backend/src/plugins/scaffolderTaskGuard.ts` — a `rootHttpRouterServiceFactory`
`configure()` middleware (wired in `packages/backend/src/index.ts`), registered on `app`
*before* `applyDefaults()` is called. `applyDefaults()` is what mounts every plugin's own
router (`app.use(routes)`), so anything registered before it is guaranteed — by construction,
not by initialization-order luck — to run first for a matching path.

**Identity resolution inside that middleware** (no DI service access is available in
`configure()` — only `{app, server, routes, middleware, config, logger, lifecycle,
healthRouter, applyDefaults}`) mirrors `@backstage/backend-defaults`'s own
`DefaultUserInfoService` (`coreServices.userInfo`) exactly: decode the bearer token's `ent`
claim directly (no signature re-verification — the *same* thing Backstage's own core service
does), falling back to a loopback call to the auth plugin's `/v1/userinfo` endpoint if the
token doesn't carry `ent` inline. This is safe because the request still has to pass the
scaffolder plugin's own `httpAuth.credentials()` check downstream — a forged token gains
nothing by fooling this guard's identity read, since it will fail real verification right
after.

**Rule going forward:** never trust a `createCatalogConditionalDecision` /
`isResourcePermission(..., RESOURCE_TYPE_CATALOG_ENTITY)` guard on `scaffolder.task.create`
(or any permission whose *static* `resourceType` doesn't match the resource type you're
checking against) without first confirming, by reading the actual caller in
`node_modules`, that the framework passes a resourceRef into that specific `authorize()` /
`authorizeConditional()` call. `isResourcePermission()` silently returning false is not an
error — it's easy to write, review, and ship a permission check that never fires. See also
[[access-control-has-two-independent-layers]] — this is the third place in this app where a
restriction that reads as enforced in the code is actually only enforced by UI/visibility
filtering elsewhere.
