# Engineering Hub Plugin (`@internal/plugin-engineering-hub`)

A Backstage frontend plugin that renders engineering documentation sourced from GitHub repositories. Supports **Nextra (MDX)**, **MkDocs (Markdown + admonitions)**, and **Docusaurus (MDX)** — all rendered through a unified custom viewer with syntax highlighting, Mermaid diagrams, callouts, tabs, and a table of contents.

---

## Architecture

```
GitHub Repo (MDX / Markdown files)
        ↓
engineering-hub-backend
  - Fetches raw file via GitHub API (GITHUB_TOKEN)
  - Strips frontmatter, imports, MkDocs-specific syntax
  - Converts admonitions / callouts to unified <Callout> JSX
  - Resolves relative image paths to GitHub raw URLs
  - Compiles MDX → HTML server-side (react-dom/server)
        ↓  (REST API: /api/engineering-hub/docs/...)
engineering-hub (frontend)
  - DocViewer renders pre-compiled HTML
  - Post-processes DOM: CodeBlock, Mermaid, tabs, callouts
  - Falls back to react-markdown if HTML is empty
```

### Key files

| File | Purpose |
|------|---------|
| `src/components/EngineeringHubPage/EngineeringHubPage.tsx` | Standalone `/engineering-hub` page — multi-source nav, doc fetch, TOC |
| `src/components/EngineeringHubEntityContent/EngineeringHubEntityContent.tsx` | Entity page Docs tab (replaces TechDocs for annotated entities) |
| `src/components/EngineeringHubPage/DocViewer.tsx` | HTML renderer + react-markdown fallback, DOM post-processing |
| `src/components/EngineeringHubPage/DocNavSidebar.tsx` | Left navigation tree + source picker |
| `src/components/EngineeringHubPage/DocTOC.tsx` | Right-rail table of contents |
| `src/api/EngineeringHubClient.ts` | API client (`engineeringHubApiRef`) |
| `../engineering-hub-backend/src/service/GitHubDocsService.ts` | Fetching, preprocessing, MDX compilation |
| `../engineering-hub-backend/src/service/MdxRenderer.ts` | MDX component library (Callout, Steps, Tabs, FileTree, Cards) |
| `../engineering-hub-backend/src/service/SourceRegistry.ts` | Reads `engineeringHub.sources` from config |

---

## Adding a New Documentation Source

There are **two ways** to add a doc source. Choose based on scope.

---

### Option A — Configured source (organisation-wide)

Use this for team-wide or org-wide doc repos (Engineering Hub, Platform Docs, training materials, etc.).

#### Step 1 — Add the source to `app-config.yaml`

```yaml
engineeringHub:
  sources:
    - id: my-docs              # unique slug — used in URLs (?source=my-docs) and annotations
      label: My Docs           # display name shown in sidebar and page header
      description: Short description shown as the page subtitle
      repoOwner: my-org
      repoName: my-docs-repo
      branch: main
      contentBase: docs        # path inside the repo where your doc files live
```

> **Restart required.** Config is read at startup — changes to `engineeringHub.sources` need a backend restart to take effect.

#### Step 2 — Create a catalog entity YAML

Create `stratpoint/components/<id>-docs.yaml`:

```yaml
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: my-docs                # must be unique in the catalog
  title: My Docs
  description: One-line description shown in the catalog
  annotations:
    engineering-hub/source-id: my-docs       # must match the id in app-config.yaml
    github.com/project-slug: my-org/my-docs-repo
    backstage.io/source-location: url:https://github.com/my-org/my-docs-repo
    # Do NOT add backstage.io/techdocs-ref — viewTechDoc is unbound, button stays grayed out intentionally
  tags:
    - documentation
spec:
  type: documentation
  lifecycle: production
  owner: my-team               # must be a group that exists in stratpoint/org/groups.yaml
  system: internal-developer-platform
```

> `stratpoint/catalog-info.yaml` already includes `./components/*.yaml`, so no extra registration step is needed.

> **Note on entity `links`:** Backstage requires full absolute URLs in the `links` field. Relative paths like `/engineering-hub?source=x` are rejected by catalog validation. Don't add internal links here — the Docs tab is the primary access point.

#### Step 3 — Access in the UI

- **Sidebar → Docs**: The new source appears as a sub-link under "Docs" in the sidebar.
- **Standalone page**: `/engineering-hub?source=my-docs`
- **Entity Docs tab**: Catalog → find the entity → Docs tab (uses Engineering Hub renderer automatically because of the annotation).
- **View TechDocs button**: Permanently grayed out — `viewTechDoc` is unbound from all external routes in `App.tsx`. This is intentional; TechDocs is not used.

---

### Option B — Inline repo (per-service docs)

Use this when a service team hosts their own docs inside their service repo. No `app-config.yaml` change is needed.

#### Step 1 — Annotate the catalog entity

```yaml
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: my-service
  annotations:
    engineering-hub/repo: my-org/my-service    # GitHub owner/repo
    engineering-hub/branch: main               # default: main
    engineering-hub/content-base: docs         # default: docs
spec:
  type: service
  lifecycle: production
  owner: backend-team
```

#### Step 2 — Access in the UI

- Catalog → find the entity → Docs tab (Engineering Hub renderer is used automatically).

The backend creates an ad-hoc instance for the repo on first request and caches it in memory.

---

## Supported Doc Formats

### Nextra (MDX)

Nextra-style MDX is the primary format. The backend handles all of the following automatically:

| Feature | Handled by |
|---------|-----------|
| YAML frontmatter | Stripped; `title` extracted |
| `import ... from 'nextra/components'` | Stripped (single-line and multi-line destructured) |
| `export { } from '...'` | Stripped |
| `<Callout type="...">` | Rendered as styled callout box |
| `<Steps>` + `### Step name` | Rendered as numbered step list |
| `<FileTree>` | Rendered as file tree with folder/file icons |
| `<Tabs items={[...]}>` + `<Tabs.Tab>` | Rendered as interactive tabs |
| `<Cards>` + `<Cards.Card>` | Rendered as card grid |
| Fenced code blocks | Syntax-highlighted with copy button |
| `mermaid` code blocks | Rendered as Mermaid diagram (click to zoom) |
| GitHub-style callouts (`> [!NOTE]`) | Auto-converted to `<Callout>` |

**Repo layout expected:**

```
contentBase/              # e.g. src/content or docs
├── _meta.json            # nav structure and page labels
├── index.mdx
├── getting-started.mdx
└── advanced/
    ├── _meta.json
    └── setup.mdx
```

The `_meta.json` file drives the left nav. Format:
```json
{
  "index": "Home",
  "getting-started": "Getting Started",
  "advanced": {
    "title": "Advanced",
    "type": "folder"
  }
}
```

---

### MkDocs (Markdown)

MkDocs repos use plain Markdown with MkDocs-specific extensions. The backend preprocesses all MkDocs syntax before passing to the MDX compiler.

| Feature | Preprocessed to |
|---------|----------------|
| `!!! note "Custom title"` admonitions | `<Callout type="note" title="Custom title">` |
| `??? note` collapsible admonitions | Same as above (not collapsible — content always shown) |
| GitHub-style `> [!NOTE]` callouts | `<Callout type="note">` |
| Definition lists (`term\n:   definition`) | `<dl><dt><dd>` HTML |
| `{.class}` / `{: .class}` attribute lists | Stripped |
| Heading anchor IDs (`{#custom-id}`) | Stripped |
| Relative image paths (`./images/foo.png`) | Resolved to GitHub raw content URL |
| MkDocs `<div class="...">` wrappers | Stripped |
| `superfences` code blocks with `title="..."` | Code block with title label above |

**Admonition type mapping:**

| MkDocs type | Rendered as |
|-------------|-------------|
| `note` | `note` |
| `tip`, `hint`, `success`, `check`, `done` | `tip` |
| `warning`, `caution`, `attention` | `warning` |
| `danger`, `error`, `failure`, `fail`, `missing` | `error` |
| `info`, `abstract`, `summary`, `tldr` | `info` |
| `important`, `question`, `help`, `faq`, `bug`, `example`, `quote`, `cite` | `important` |

**Repo layout expected:**

```
contentBase/              # e.g. docs
├── index.md
├── getting-started.md
└── advanced/
    └── setup.md
```

Nav structure is generated from the directory tree — there is no `_meta.json` equivalent for MkDocs. Files are sorted alphabetically; `index.md` always appears first within its directory.

**`mkdocs.yml` is not read.** The `nav:` key in `mkdocs.yml` is ignored. Ordering is directory-tree order. If you need custom ordering or labels, the backend can be extended to read `mkdocs.yml`.

---

### Docusaurus (MDX)

Docusaurus uses MDX with its own component conventions. The Engineering Hub renders Docusaurus docs with these considerations:

| Feature | Status |
|---------|--------|
| YAML frontmatter | Stripped |
| `import` statements | Stripped |
| MDX content | Compiled to HTML |
| `:::note`, `:::tip`, `:::warning` admonitions | **Not yet preprocessed** — renders as plain blockquote |
| `<Tabs>`, `<TabItem>` | Rendered as Engineering Hub tabs (not 1:1 with Docusaurus API) |
| Mermaid code blocks | Rendered as Mermaid diagram |
| Fenced code blocks | Syntax-highlighted with copy button |

**For Docusaurus repos,** the main limitation is admonitions. If your docs use `:::note`, add a preprocessing step in `GitHubDocsService.ts` similar to `convertMkDocsAdmonitions()` that converts the `:::type` syntax to `<Callout type="...">` before MDX compilation.

**Repo layout expected:**

```
contentBase/              # e.g. docs
├── intro.md
└── tutorial-basics/
    └── create-a-page.md
```

Use the same `_meta.json` format as Nextra to control nav labels and ordering. Without `_meta.json`, nav is generated from the directory tree.

---

## Catalog Entity Annotations Reference

| Annotation | Required | Description |
|-----------|----------|-------------|
| `engineering-hub/source-id` | For Option A | References a configured source in `app-config.yaml` |
| `engineering-hub/repo` | For Option B | GitHub `owner/repo` for inline doc repos |
| `engineering-hub/branch` | Option B only | Branch to read from (default: `main`) |
| `engineering-hub/content-base` | Option B only | Root path of doc files (default: `docs`) |
| `github.com/project-slug` | Recommended | Enables "View Source" button in the catalog About card |
| `backstage.io/source-location` | Recommended | Full URL of the GitHub repo — also enables "View Source" |
| `backstage.io/techdocs-ref` | Recommended | Enables "View TechDocs" button; portal overrides it to redirect to Engineering Hub instead of the built-in TechDocs viewer |

---

## How the Docs Tab Selects the Renderer

`EntityPage.tsx` wraps the entity `/docs` route with an `EntitySwitch`:

```tsx
<EntitySwitch>
  <EntitySwitch.Case if={isEngineeringHubDocsAvailable}>
    <EngineeringHubEntityContent />   // Engineering Hub renderer
  </EntitySwitch.Case>
  <EntitySwitch.Case>
    {techdocsContent}                 // TechDocs fallback for all other entities
  </EntitySwitch.Case>
</EntitySwitch>
```

`isEngineeringHubDocsAvailable` returns `true` when the entity has `engineering-hub/source-id` **or** `engineering-hub/repo`. All other entities continue using TechDocs unchanged.

---

## "View TechDocs" Button

The "View TechDocs" button in `EntityAboutCard` is **permanently grayed out**. `viewTechDoc` is intentionally unbound from both `catalogPlugin` and `scaffolderPlugin` external routes in `App.tsx`:

```typescript
bind(catalogPlugin.externalRoutes, {
  createComponent: scaffolderPlugin.routes.root,
  createFromTemplate: scaffolderPlugin.routes.selectedTemplate,
  // viewTechDoc intentionally omitted — Engineering Hub replaces TechDocs
});
```

`TechDocsRedirect` still exists at `/docs/:namespace/:kind/:name/*` for the rare case where a non-Engineering Hub entity genuinely needs TechDocs. For Engineering Hub entities, the Docs tab is the primary access point.

---

## Caching

Doc nav and content are cached in **Redis** via Backstage's `coreServices.cache` (configured in `app-config.yaml` as `cache.store: redis`).

| Property | Value |
|----------|-------|
| TTL | 30 minutes |
| Scope | Shared across all pods and survives restarts |
| Key format | `owner/repo@branch:<nav\|doc:path>` |

The cache is wired through the plugin stack: `plugin.ts` → `router.ts` → `SourceRegistry` → `GitHubDocsService`. `GitHubDocsService` no longer has an in-memory `Map` — all caching goes through Redis.

If you need to bust the cache manually (e.g. after force-pushing to a doc repo), flush the relevant Redis keys or wait out the TTL.

---

## Backend API Routes

| Route | Description |
|-------|-------------|
| `GET /api/engineering-hub/docs/sources` | List all configured sources |
| `GET /api/engineering-hub/docs/sources/:sourceId/nav` | Nav tree for a configured source |
| `GET /api/engineering-hub/docs/sources/:sourceId/content?path=` | Doc content for a configured source |
| `GET /api/engineering-hub/docs/entity/nav?repo=&branch=&base=` | Nav tree for an inline repo |
| `GET /api/engineering-hub/docs/entity/content?repo=&branch=&base=&path=` | Doc content for an inline repo |

---

## Known Quirks and Design Decisions

### Config changes require backend restart
`engineeringHub.sources` is read once at startup from `app-config.yaml`. Adding or modifying sources requires a backend restart (`yarn dev` or server restart). Frontend code changes hot-reload without a restart.

### `useEffect` dependency array in DocViewer
`DocViewer`'s DOM post-processing effect has `[html, dark]` as its dependency array — intentionally excluding `onNavigate` and `currentPath`. Those two are held in refs (updated on every render) so the effect doesn't re-run when the parent re-renders. If `onNavigate` were in the dependency array, the effect would re-run on every render, destroying the React roots mounted inside code blocks and tabs.

### Mermaid zoom
Clicking a rendered Mermaid diagram opens a fullscreen modal. Mermaid SVGs have hardcoded `width`/`height` attributes that prevent CSS scaling — the modal strips those attributes and adds `style="width:100%;height:auto;"` before injecting the SVG.

### Tabs via DOM manipulation
Tabs are made interactive by directly manipulating the DOM in a `useEffect` rather than mounting a React component. This avoids a race condition: `ReactDOM.createRoot().render()` is async, and extracting `innerHTML` immediately after calling it returns an empty string, breaking tab content.

### TOC extracted from HTML (not from markdown)
The table of contents is built by scanning `<h2 id="...">` and `<h3 id="...">` elements in the pre-rendered HTML string. Markdown-based extraction can diverge from MdxRenderer's heading slugify output when headings contain inline code or emoji.

### `owner` must exist in groups.yaml
The `owner:` field in entity YAMLs must reference a group that exists in `stratpoint/org/groups.yaml`. If the group doesn't exist, the catalog shows a relation error on the entity page. Use `devops-team` for documentation components unless there's a more specific team.

### GITHUB_TOKEN scope
`GITHUB_TOKEN` must have read access to every configured and annotated repository — both the sources listed in `app-config.yaml` and any inline repos from Option B annotations. A fine-grained PAT with `Contents: Read` on the relevant repos is sufficient.

---

## Development

```bash
# Build the frontend plugin (after code changes)
yarn workspace @internal/plugin-engineering-hub build

# Build the backend plugin (after code changes)
yarn workspace @stratpoint/plugin-engineering-hub-backend build

# Note: backend plugins load from dist/ not src/.
# Always rebuild with the above commands before restarting the dev server.
# Frontend code changes hot-reload; backend changes require a rebuild + restart.
```

Backend plugin package name: `@stratpoint/plugin-engineering-hub-backend` (not `@internal/`).
