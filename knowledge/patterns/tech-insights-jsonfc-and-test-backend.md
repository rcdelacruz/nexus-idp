# Pattern: Tech Insights config traps (jsonfc 0.10, backend 3.1) and how to test them

**Discovered:** 2026-10-30, Phase 2 scorecards (branch `feat/tech-insights-scorecards`).

- **A check `filter` must be ONE object.** jsonfc 0.10's config reader does
  `getOptionalConfig("filter")`, so an array (which its README documents for OR logic) fails
  **backend startup** with `Invalid type ... got array, wanted object`. For OR, use an array
  *value* inside the object instead: `filter: { kind: component, spec.type: [service, website] }`.
  Dotted keys like `spec.type` are fine.
- **Every configured fact retriever needs `cadence`** (a cron string), or startup throws. A custom
  retriever only runs if its id is listed under `techInsights.factRetrievers`.
- **The engine does not apply `entityFilter`.** It only passes it to the handler, which must pass
  it to `CatalogClient.getEntities`.
- **API behaviour:**
  - Before the first retriever run, `POST /checks/run/...` returns 500 `Not all facts are defined`.
    The message survives in production, because only the stack is dev-only.
  - Checks whose facts have no row for the entity are silently omitted.
- **Testing:** use `startTestBackend` with the real plugin and modules, a tiny fake `catalog`
  plugin (`/entities`, `/entities/by-name/:kind/:ns/:name`), and the *unmodified* config parsed
  from `app-config.yaml`.
  - The test scheduler runs each task once at startup but **skips tasks with `initialDelay`**
    unless `mockServices.scheduler.factory({ includeInitialDelayedTasksOnStartup: true })`.
  - Use static imports: dynamic `import()` fails under this Jest without vm-modules.
- `plugin-tech-insights@1.5.0` (frontend) nests `@backstage/ui` 0.17. The internal
  `OpsReadinessCard` calls the API directly instead.
