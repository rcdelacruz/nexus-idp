# Local Provisioner Consolidation Plan

**Created:** 2026-03-29
**Owner:** Ronald
**Status:** Draft — pending review

---

## Goal

Remove `packages/backstage-agent/` and consolidate all local provisioner components under the local provisioner plugin. Rename from "Backstage Agent" to "Nexus Agent CLI". Prepare for publishing plugins as separate installable packages.

---

## Current State

| Component | Location | Name |
|-----------|----------|------|
| Backend plugin | `plugins/local-provisioner-backend/` | `@stratpoint/plugin-local-provisioner-backend` |
| Frontend plugin | `plugins/local-provisioner/` | `@internal/plugin-local-provisioner` |
| Agent CLI | `packages/backstage-agent/` | `backstage-agent` |
| Agent docs (old) | `packages/backstage-agent/docs/` | index.md, AUTHENTICATION.md |
| Agent docs (new) | `plugins/local-provisioner/docs/` | index.md, setup-guide.md, authentication.md |
| Platform docs | `docs/content/local-provisioning-*.md` | quickstart + implementation plan |
| Catalog entity | `packages/backstage-agent/catalog-info.yaml` | "Backstage Agent CLI" |

### Problems

1. Agent CLI lives in `packages/` instead of `plugins/` — tightly coupled to this monorepo
2. Named "Backstage Agent" — should be "Nexus Agent CLI" to match the product
3. Catalog entity shows "Backstage Agent CLI" as a separate component — should be part of local provisioner
4. Docs are scattered across 3 locations
5. `docs/content/local-provisioning-*.md` are platform docs about a plugin — they belong with the plugin
6. Same repo used for multiple engineering-docs sources causes cache key collisions in the backend

---

## Target State

| Component | Location | Name |
|-----------|----------|------|
| Backend plugin | `plugins/local-provisioner-backend/` | `@nexus-idp/plugin-local-provisioner-backend` |
| Frontend plugin | `plugins/local-provisioner/` | `@nexus-idp/plugin-local-provisioner` |
| Agent CLI | `plugins/local-provisioner-agent/` | `@nexus-idp/local-provisioner-agent` (CLI: `nexus-agent`) |
| All docs | `plugins/local-provisioner/docs/` | Consolidated — index, setup, auth, architecture |
| Catalog entity | Part of local-provisioner plugin | "Nexus Agent CLI" under Local Provisioner system |

---

## Steps

### Phase 1: Rename & Move Agent CLI

1. Create `plugins/local-provisioner-agent/` with the agent source code
2. Move everything from `packages/backstage-agent/src/` → `plugins/local-provisioner-agent/src/`
3. Update `package.json`:
   - Name: `@nexus-idp/local-provisioner-agent`
   - Bin: `nexus-agent` (instead of `backstage-agent`)
4. Update all internal imports and references
5. Delete `packages/backstage-agent/`

### Phase 2: Consolidate Docs

1. Keep docs at `plugins/local-provisioner/docs/` (already created)
2. Remove `packages/backstage-agent/docs/` (goes away with Phase 1)
3. Remove `docs/content/local-provisioning-quickstart.md` — content already in plugin docs
4. Remove `docs/content/local-provisioning-implementation-plan.md` — move relevant parts to plugin docs
5. Update `docs/content/index.md` — remove local provisioner links

### Phase 3: Update Catalog Entity

1. Remove `packages/backstage-agent/catalog-info.yaml`
2. Add catalog entity to `plugins/local-provisioner-agent/catalog-info.yaml`:
   - Name: `nexus-agent-cli`
   - Title: "Nexus Agent CLI"
   - Part of local provisioner system
   - `engineering-docs/source-id: local-provisioner` annotation

### Phase 4: Engineering Docs Source

1. Once plugins are in separate repos, add engineering-docs source in `app-config.yaml`:
   ```yaml
   - id: local-provisioner
     label: Local Provisioner
     description: Set up the Nexus Agent CLI to provision local dev resources
     repoOwner: nexus-idp
     repoName: plugin-local-provisioner
     branch: main
     contentBase: docs
   ```
2. No cache collision since it's a different repo
3. "View Setup Guide" link in the plugin resolves correctly

### Phase 5: Update References

1. `CLAUDE.md` — update directory structure, plugin list
2. `README.md` — update project structure, custom plugins table
3. `packages/app/src/components/Root/Root.tsx` — sidebar links if any reference backstage-agent
4. Remove `backstage-agent` from workspace `packages` in root `package.json`

### Phase 6: Compose File Viewer

Add a read-only Docker Compose viewer to the frontend plugin so developers can see exactly what's running on their machine.

1. After a task is provisioned, the backend stores the generated Docker Compose YAML alongside the task record
2. The task detail view in the frontend shows a "View Compose File" section with:
   - Read-only YAML viewer with syntax highlighting
   - Copy button to copy the full compose file
   - Service list showing containers, ports, volumes, environment variables
3. Developers can see and understand their local infrastructure — transparent but managed
4. The template stays the source of truth — compose files are generated, not hand-edited through the portal
5. **Template ownership:** Only Tech Leads and Admins can create, edit, and manage provisioning templates. Regular developers can only use them to create tasks.

### Phase 7: Package Publishing (future)

1. Publish all local provisioner packages to npm / private registry:
   - `@nexus-idp/plugin-local-provisioner-backend`
   - `@nexus-idp/plugin-local-provisioner`
   - `@nexus-idp/local-provisioner-agent`
2. Other Nexus IDP deployments can `yarn add` and use them
3. Docs served from the plugin's own repo via engineering-docs

---

## Risks & Notes

- **Breaking change for existing users:** Anyone running `backstage-agent` CLI will need to reinstall as `nexus-agent`
- **npm link:** Current global CLI link via `npm link` needs to be re-done after rename
- **Config paths:** `~/.backstage-agent/config.json` token storage path changes — need migration or backward compat
- **Cache collision bug:** The engineering-docs backend uses `repoOwner/repoName@branch:` as cache prefix. Two sources from the same repo share the cache. Fix: include `contentBase` in the prefix. This blocks having plugin docs in the same repo as platform docs.
- **Depends on separate repos:** Phase 4 (engineering-docs source) only works once plugins are in their own repos

---

## Decisions

1. **Token storage path:** `~/.nexus-agent/` (rename from `~/.backstage-agent/`)
2. **CLI transition:** Clean cut — `nexus-agent` only, no backward compat for `backstage-agent`
3. **npm scope:** `@nexus-idp/` for all plugin packages (this is the product, not the client)
4. **Implementation plan doc:** Remove — `docs/content/local-provisioning-implementation-plan.md` is obsolete
