# Documentation Guide

Nexus IDP supports two documentation systems depending on the scope:

| System | Purpose | Source |
|--------|---------|--------|
| **Engineering Docs** | Platform-wide docs, standards, guides (this portal) | GitHub repos configured in `engineeringDocs.sources` |
| **TechDocs** | Per-component docs — lives alongside the component's code | Any repo with `backstage.io/techdocs-ref` annotation |

---

## Engineering Docs (Platform-Level)

Platform documentation is served via the **Engineering Docs** plugin, which reads Markdown files directly from GitHub at runtime. No build step required.

### Adding a New Source Repo

In `app-config.yaml`:

```yaml
engineeringDocs:
  sources:
    - id: my-source
      label: My Docs
      description: Description shown in the Engineering Docs sidebar
      repoOwner: stratpoint-engineering
      repoName: my-repo
      branch: main
      contentBase: docs   # path inside the repo where .md files live
```

### Nav Structure

The plugin reads `mkdocs.yml` at the **repo root** for navigation order. Example:

```yaml
site_name: My Docs
nav:
  - Home: index.md
  - Getting Started: getting-started.md
  - API Reference: api-reference.md
```

If no `mkdocs.yml` is present, the plugin auto-builds nav from the file tree alphabetically.

### File Format

Files must be Markdown (`.md`) or MDX (`.mdx`). Standard GitHub-flavored Markdown is supported, including:
- Tables
- Code blocks with syntax highlighting
- Admonitions (`> [!NOTE]`, `> [!WARNING]`)
- Relative links between docs pages

---

## TechDocs (Component-Level)

TechDocs renders documentation that lives inside a service or component's own repository. It appears under the **Docs** tab on a component's catalog page.

### Setting Up TechDocs for a Component

**Step 1: Add docs to the repo**

Create a `docs/` directory with Markdown files and a `mkdocs.yml`:

```
my-service/
├── catalog-info.yaml
├── mkdocs.yml
└── docs/
    ├── index.md
    ├── api.md
    └── deployment.md
```

`mkdocs.yml`:
```yaml
site_name: My Service
nav:
  - Home: index.md
  - API: api.md
  - Deployment: deployment.md
plugins:
  - techdocs-core
```

**Step 2: Annotate the catalog entity**

In `catalog-info.yaml`:
```yaml
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: my-service
  annotations:
    backstage.io/techdocs-ref: dir:.   # docs/ is relative to this file
spec:
  type: service
  lifecycle: production
  owner: group:default/cloud-team
```

**Step 3: Register in the catalog**

Add to `app-config.yaml` under `catalog.locations`:
```yaml
- type: url
  target: https://github.com/stratpoint-engineering/my-service/blob/main/catalog-info.yaml
  rules:
    - allow: [Component]
```

**Step 4: View the docs**

Navigate to the component in the Catalog → click the **Docs** tab. TechDocs builds and serves the documentation automatically.

### Troubleshooting TechDocs

| Symptom | Cause | Fix |
|---------|-------|-----|
| Docs tab missing | No `techdocs-ref` annotation | Add `backstage.io/techdocs-ref: dir:.` to `catalog-info.yaml` |
| Build fails | Missing `techdocs-core` plugin | Add `plugins: [techdocs-core]` to `mkdocs.yml` |
| Docs not updating | TechDocs cache | Force rebuild by re-triggering catalog refresh |
| Images not showing | Wrong relative path | Place images in `docs/assets/` and use relative paths |
