## `catalog.rules` is judged against the ORIGIN location; Group/User must not be allowed from discovered repos (2026-11-07)

Backstage's `DefaultCatalogRulesEnforcer.isAllowed(entity, originLocation)` evaluates entities emitted while processing a location
against the rules of the location the chain STARTED from (`context.originLocation`), not the child file. So:
- a per-location `rules` entry on `stratpoint/catalog-info.yaml` also covers the org files it points to (`org/users.yaml`,
  `org/groups.yaml`), and
- a GitHub-discovered repo's `catalog-info.yaml` is judged by the GLOBAL `catalog.rules`.

The permission policy trusts group membership (`backstage-admins`, `*-lead`, department teams), and repos discovered from the
orgs are writable by trainees. A global rule that allows `Group` or `User` therefore lets a repo contributor declare a group and
grant themselves a role. Keep the global rule to Component/System/API/Resource/Location and give Group/User only to the org root.
Entities supplied by an `EntityProvider` (UserEntityProvider) are not checked by the rules at all.

Pinned by `packages/backend/src/plugins/catalogRules.config.test.ts`; to see the decision itself, load the merged config with
`ConfigReader` and call `DefaultCatalogRulesEnforcer.fromConfig(config).isAllowed(entity, { type, target })` (run from the
directory the backend runs in: file targets are resolved relative to it).
