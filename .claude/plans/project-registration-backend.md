# Project Registration Backend Plan

**Created:** 2026-03-28
**Owner:** Ronald
**Status:** Ready to implement (Phase 1)

---

## Core Concept

**No project → no scaffolding.** Projects must be registered first. Scaffolding is always associated with a project. Projects are the root of the entire cost attribution chain.

### Clear Separation of Concerns

| Layer | Responsibility | Touches GitHub? |
|-------|---------------|-----------------|
| **Project Registration** | Business/org layer — client, team, dates, Jira key, AWS tags | **No** |
| **Scaffolder** | Technical layer — creates repos, files, catalog entities | **Yes** (existing integration) |
| **FinOps** | Cost reporting — filters AWS costs by project/client/team tags | **No** |

**Project Registration never touches GitHub.** The scaffolder handles all GitHub operations via its existing integration. Project Registration just creates the project container in the DB and defines the tag values everything else will use.

---

## Full Correlation Chain

```
Project Registration
  → stores: project-id, client_name, team_name, aws_tag_project, aws_tag_client, aws_tag_team
        ↓
Scaffolder (Phase 2)
  → GitHub repo topics: project-id, client, team
  → Catalog entity annotations:
      project-registration/project-id: <id>
      project-registration/client: <aws_tag_client>
      project-registration/team: <aws_tag_team>
  → AWS resource tags (via IaC in template):
      Project: <aws_tag_project>
      Client:  <aws_tag_client>
      Team:    <aws_tag_team>
        ↓
FinOps
  → Filter AWS costs by Project tag → "This project costs $X/month"
  → Filter by Client tag → "Client A's total AWS spend: $Y/month"
  → Filter by Team tag → "Web team infra cost: $Z/month"
  → All services traceable back to a registered project
```

Without Project Registration, FinOps can only show costs by environment or account — not by client or project. **Project Registration is the root of cost attribution.**

---

## AWS Tag Design

AWS tag values have restrictions (max 256 chars, no spaces in some contexts, case-sensitive). Store separate AWS-safe tag values in the DB, derived from but not equal to the display names:

| DB field | Example value | Used for |
|----------|--------------|----------|
| `aws_tag_project` | `proj-acme-ecommerce` | AWS tag `Project=proj-acme-ecommerce` |
| `aws_tag_client` | `acme-corp` | AWS tag `Client=acme-corp` |
| `aws_tag_team` | `web-team` | AWS tag `Team=web-team` |

Auto-generated from `name` and `client_name` on create (slugified, lowercased, max 64 chars). Can be overridden by lead.

---

## Flow

```
1. Lead: Register Project
   → fill form (client, team, dates, Jira key)
   → aws_tag_* auto-generated, shown for confirmation
   → stored in DB → gets project-id

2. Engineer: Scaffold a Service
   → opens Backstage Create → picks template
   → required "Select Project" dropdown (fetches from GET /api/project-registration/projects)
   → scaffolder creates GitHub repo + catalog entity (existing GitHub integration)
   → scaffolder injects project tags into catalog-info.yaml + IaC files

3. AWS Resources provisioned by IaC
   → tagged with Project/Client/Team from project record
   → FinOps picks up costs by these tags

4. (Phase 3) Jira: auto-create Jira project on registration
```

---

## Phases

### Phase 1 (MVP) — Project store only
- `POST /api/project-registration/projects` — create project → return `project-id`
- `GET /api/project-registration/projects` — list all projects (for scaffolder dropdown)
- `GET /api/project-registration/projects/:id` — get single project with full tag values
- Wire frontend `ProjectRegistrationPage.tsx` to call real API
- No GitHub. No Jira. No scaffolder calls.

### Phase 2 (later) — Scaffolder integration
- Add required "Select Project" dropdown to ALL scaffolder templates (hard gate)
- Dropdown is **never empty** — system projects are pre-seeded
- Scaffolder injects into generated `catalog-info.yaml`:
  ```yaml
  metadata:
    annotations:
      project-registration/project-id: <id>
      project-registration/client: <aws_tag_client>
      project-registration/team: <aws_tag_team>
  ```
- Scaffolder injects into generated IaC (Terraform/CDK):
  ```hcl
  tags = {
    Project = "<aws_tag_project>"
    Client  = "<aws_tag_client>"
    Team    = "<aws_tag_team>"
  }
  ```
- **Scaffolder's GitHub integration is NOT changed**

### Phase 3 (later) — Project management tool integration (optional)

PM tool is configurable per org — Jira, GitHub Projects, or none. Orgs that don't use Jira can use GitHub Projects/Issues instead. Configured in `app-config.yaml`:

```yaml
projectRegistration:
  pmTool: github   # github | jira | none (default: none)
  jira:
    baseUrl: ${JIRA_BASE_URL}
    token: ${JIRA_TOKEN}
  github:
    # uses existing GITHUB_TOKEN
```

On project creation, based on config:
- `pmTool: jira` → call Jira API to create project, store `jira_project_id` back in record
- `pmTool: github` → create GitHub Project (v2) linked to org, store `github_project_id` back in record
- `pmTool: none` → skip, store `jira_key` manually if provided

DB stores both so orgs can switch later:
- `jira_key`, `jira_project_id` — Jira fields
- `github_project_id` — GitHub Projects field
- `pm_tool` — which tool was used (`jira | github | none`)

### Phase 4 (later) — FinOps entity tab
- Add `project-registration/project-id` annotation lookup to FinOps entity tab
- Entity page for a service shows: "This service belongs to Project X — total project cost: $Y/month"

---

## Phase 1 Implementation

### Package naming
`@stratpoint/plugin-project-registration-backend` — matches existing convention.

### Plugin structure
```
plugins/project-registration-backend/
  src/
    plugin.ts                    — createBackendPlugin, httpRouter setup
    index.ts                     — exports
    service/
      router.ts                  — Express router (POST/GET /projects)
      ProjectStore.ts            — DB operations
    database/
      migrations/
        20260328_init.js         — create projects table + seed system projects
  package.json
```

### System projects (pre-seeded in migration)

Everything must have a project — no loose services. System projects ensure the dropdown is never empty:

| name | client_name | type | aws_tag_project |
|------|-------------|------|-----------------|
| Internal Tools | Stratpoint | system | internal-tools |
| R&D / Experiments | Stratpoint | system | rnd-experiments |

System projects cannot be deleted. Client engagements are `type: client`.

### Database table
```sql
CREATE TABLE project_registration_projects (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  description      TEXT,
  client_name      TEXT NOT NULL,
  type             TEXT NOT NULL DEFAULT 'client',   -- client | system
  -- AWS tags (auto-generated, can be overridden)
  aws_tag_project  TEXT NOT NULL,   -- e.g. "proj-acme-ecommerce"
  aws_tag_client   TEXT NOT NULL,   -- e.g. "acme-corp"
  aws_tag_team     TEXT NOT NULL,   -- e.g. "web-team"
  -- Project metadata
  start_date       DATE,
  end_date         DATE,
  -- Project management tool (optional, configurable per org)
  pm_tool          TEXT,            -- jira | github | none
  jira_key         TEXT,            -- Jira: project key (e.g. "ACME")
  jira_template    TEXT,            -- Jira: scrum | kanban | basic
  jira_project_id  TEXT,            -- Jira: project ID (set after Phase 3 creation)
  github_project_id TEXT,           -- GitHub Projects v2: project ID (set after Phase 3 creation)
  team_name        TEXT,
  team_members     JSONB,
  status           TEXT NOT NULL DEFAULT 'active',   -- active | archived
  created_by       TEXT NOT NULL,   -- user entity ref
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pre-seed system projects (idempotent)
INSERT INTO project_registration_projects
  (name, client_name, type, aws_tag_project, aws_tag_client, aws_tag_team, created_by)
VALUES
  ('Internal Tools', 'Stratpoint', 'system', 'internal-tools', 'stratpoint', 'internal', 'system'),
  ('R&D / Experiments', 'Stratpoint', 'system', 'rnd-experiments', 'stratpoint', 'rnd', 'system')
ON CONFLICT DO NOTHING;
```

### Auth policy
- `POST /projects` — authenticated (leads + admins only)
- `GET /projects` — authenticated (all assigned users — scaffolder dropdown)
- `GET /projects/:id` — authenticated (all assigned users)

### Wire-up checklist
1. Add `"@stratpoint/plugin-project-registration-backend": "link:../../plugins/project-registration-backend"` to `packages/backend/package.json`
2. Add `backend.add(import('@stratpoint/plugin-project-registration-backend')...)` to `packages/backend/src/index.ts`
3. Add symlink in `Dockerfile.with-migrations` RUN step
4. Add COPY step for plugin in `Dockerfile.with-migrations`
5. Wire frontend `ProjectRegistrationPage.tsx` to call real API instead of fake `setTimeout`

### Permission
- `POST /projects` → leads + admins only
- `GET /projects`, `GET /projects/:id` → all authenticated users

---

## What Phase 1 Does NOT Do

- No GitHub repo creation (scaffolder handles that in Phase 2)
- No catalog entity creation (scaffolder handles that in Phase 2)
- No Jira or GitHub Projects API call (store keys in DB, integrate in Phase 3)
- No scaffolder trigger from project creation
- No team auto-creation in catalog
- No "Select Project" in scaffolder templates (Phase 2)
- No FinOps entity tab (Phase 4)

> **PM tool fields in the form (Phase 1):** Collect `jira_key` and `jira_template` from the existing form — store them in DB. Phase 3 will add a PM tool selector (Jira / GitHub Projects / None) to the form. For now, fields are stored regardless.

---

## Dockerfile.with-migrations changes (Phase 1 required)

Add to the symlink `RUN` step:
```dockerfile
ln -sf /app/plugins/project-registration-backend /app/node_modules/@stratpoint/plugin-project-registration-backend
```

Add `COPY` step for the plugin directory.
