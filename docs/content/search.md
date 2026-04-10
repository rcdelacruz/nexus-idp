# Search

Nexus IDP has a global search that covers the entire Software Catalog — components, APIs, systems, resources, groups, and users.

---

## Accessing Search

- Click **Search** in the left sidebar
- Or press `Ctrl+K` (Windows/Linux) / `Cmd+K` (Mac) from anywhere in the portal

---

## Searching the Catalog

Type any part of a component name, description, or tag. Results update as you type.

**Examples:**
- `auth` — finds components, APIs, and systems related to authentication
- `backend-team` — finds everything owned by the backend team
- `kafka` — finds components tagged with kafka or with kafka in their description

---

## Filtering Results

Use the filter panel on the left to narrow results:

| Filter | What it does |
|--------|-------------|
| **Kind** | Filter by entity type: Component, API, System, Resource, Group, User |
| **Lifecycle** | Filter by `production`, `staging`, `development`, `deprecated` |

Combine filters — e.g. Kind = `Component` + Lifecycle = `production` shows all live services.

---

## Catalog Page Filters

On the **Catalog** page (`/catalog`) you get additional filters:

| Filter | What it does |
|--------|-------------|
| **Type** | For Components: `service`, `website`, `library`, `documentation` |
| **Owner** | Filter by team group (e.g. `web-team`, `data-team`) |
| **Tag** | Filter by metadata tags defined in `catalog-info.yaml` |

---

## Tips

- **Can't find your service?** Check if it has a `catalog-info.yaml` on the `main` branch — see [Importing Projects](importing-projects.md)
- **Entity disappeared?** The orphan strategy removes entities whose source file was deleted from the repo
- **Want to bookmark a filter?** The URL updates with your active filters — bookmark it directly

---

## What's Indexed

| Entity | Searchable fields |
|--------|-----------------|
| Component | name, description, tags, owner, lifecycle |
| API | name, description, type |
| System | name, description |
| Resource | name, description, type |
| Group | name, description |
| User | name, email |
