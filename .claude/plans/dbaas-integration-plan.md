# DBaaS Integration Hub — Implementation Plan

| Field | Value |
|-------|-------|
| **Created** | 2026-04-11 |
| **Status** | Draft — awaiting review |
| **Phase 1** | NeonDB |
| **Phase 2+** | Supabase, Railway, Render, Turso, Upstash, MongoDB Atlas, CockroachDB, Aiven, PlanetScale |

---

## Overview

Users can link their personal or team DBaaS accounts from a **"Connect Databases"** settings tab styled like Vercel's integrations marketplace. Once linked, Backstage auto-discovers all databases in that account and registers them as `Resource` entities in the catalog. Sync uses webhooks where the provider supports them, falling back to on-demand manual refresh.

---

## UI — Vercel Integration Marketplace Style

### Connect Databases tab (`/settings/connect-databases`)

```
┌─────────────────────────────────────────────────────────────────┐
│  Connect Databases                                              │
│  Link your database providers to discover and track your        │
│  databases in the catalog.                                      │
├─────────────────────────────────────────────────────────────────┤
│  Connected                                                      │
│  ┌──────────────────┐  ┌──────────────────┐                    │
│  │  [Neon logo]     │  │  [Supabase logo] │                    │
│  │  Neon            │  │  Supabase        │                    │
│  │  ✓ Connected     │  │  ✓ Connected     │                    │
│  │  3 databases     │  │  1 database      │                    │
│  │  Personal        │  │  Team: backend   │                    │
│  └──────────────────┘  └──────────────────┘                    │
│                                                                 │
│  Available                                                      │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐ │
│  │  [Railway logo]  │  │  [Render logo]   │  │ [Turso logo] │ │
│  │  Railway         │  │  Render          │  │  Turso       │ │
│  │  Postgres/Redis  │  │  Postgres/Redis  │  │  SQLite/Edge │ │
│  │  [Connect]       │  │  [Connect]       │  │  [Connect]   │ │
│  └──────────────────┘  └──────────────────┘  └──────────────┘ │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐ │
│  │  [Upstash logo]  │  │  [Atlas logo]    │  │ [CRDB logo]  │ │
│  │  Upstash         │  │  MongoDB Atlas   │  │  CockroachDB │ │
│  │  Redis/Kafka     │  │  MongoDB         │  │  Postgres    │ │
│  │  [Connect]       │  │  [Connect]       │  │  [Connect]   │ │
│  └──────────────────┘  └──────────────────┘  └──────────────┘ │
│  ┌──────────────────┐  ┌──────────────────┐                    │
│  │  [Aiven logo]    │  │  [PScale logo]   │                    │
│  │  Aiven           │  │  PlanetScale     │                    │
│  │  Multi-engine    │  │  MySQL           │                    │
│  │  [Connect]       │  │  [Connect]       │                    │
│  └──────────────────┘  └──────────────────┘                    │
└─────────────────────────────────────────────────────────────────┘
```

### Connect Dialog (per provider)

```
┌──────────────────────────────────────────┐
│  Connect Neon                        [✕] │
├──────────────────────────────────────────┤
│  Label                                   │
│  ┌────────────────────────────────────┐  │
│  │ e.g. "My Neon Account"             │  │
│  └────────────────────────────────────┘  │
│                                          │
│  API Key                                 │
│  ┌────────────────────────────────────┐  │
│  │ ••••••••••••••••••••               │  │
│  └────────────────────────────────────┘  │
│  Get your API key → console.neon.tech    │
│                                          │
│  Visibility                              │
│  ● Personal  (only you)                  │
│  ○ Team      [Backend Team         ▾]    │
│                                          │
│              [Cancel]  [Connect Neon]    │
└──────────────────────────────────────────┘
```

---

## Architecture

```
Connect Databases settings tab
        │
        ▼
plugin-dbaas (frontend)
  - Marketplace grid (connected + available)
  - ConnectDialog (label, API key, personal/team)
  - Per-connection database list + refresh button

        │ REST calls to backend
        ▼
plugin-dbaas-backend
  ├── routes.ts            — CRUD connections, manual sync, webhook receiver
  ├── providers/
  │   ├── registry.ts      — Provider registry (all supported providers)
  │   ├── neon.ts          — Neon API client (Phase 1)
  │   ├── supabase.ts      — (Phase 2)
  │   └── ...
  ├── sync.ts              — Discovery logic + catalog entity upsert
  ├── webhook.ts           — Inbound webhook handler (providers that support it)
  ├── crypto.ts            — AES-256-GCM credential encryption
  └── database/
      └── migrations/
          └── 001_create_dbaas_connections.js

        │ upsert Resource entities
        ▼
Backstage Catalog
  spec.type: neon-database | supabase-database | railway-database | ...
  spec.owner: user:default/<name>  OR  group:default/<team>
```

---

## Database Schema

```sql
CREATE TABLE dbaas_connections (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_ref     TEXT NOT NULL,        -- 'user:default/firstname.lastname'
  provider     TEXT NOT NULL,        -- 'neon', 'supabase', etc.
  label        TEXT NOT NULL,        -- user-given name e.g. "My Neon Account"
  credentials  TEXT NOT NULL,        -- AES-256-GCM encrypted JSON
  visibility   TEXT NOT NULL,        -- 'personal' | 'team'
  owner_ref    TEXT NOT NULL,        -- user_ref or group ref depending on visibility
  last_synced  TIMESTAMPTZ,
  last_error   TEXT,
  webhook_id   TEXT,                 -- provider webhook ID if registered
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX ON dbaas_connections (user_ref, provider, label);
```

---

## Sync Strategy

| Provider | Webhook support | Fallback |
|----------|----------------|---------|
| Neon | ✗ Not supported | On-demand (Refresh button) |
| Supabase | ✗ Not for project lifecycle | On-demand |
| Railway | ✓ Project events | Webhook → auto-sync |
| Render | ✗ | On-demand |
| Turso | ✗ | On-demand |
| Upstash | ✗ | On-demand |
| MongoDB Atlas | ✓ Event triggers | Webhook → auto-sync |
| CockroachDB | ✗ | On-demand |
| Aiven | ✓ Service notifications | Webhook → auto-sync |
| PlanetScale | ✓ Webhooks | Webhook → auto-sync |

**No background polling.** For providers without webhooks, user clicks "Refresh" on their connection card. Initial sync runs immediately on connect.

Webhook endpoint: `POST /api/dbaas/webhook/:provider/:connectionId`

---

## Catalog Entity per Neon Project

```yaml
apiVersion: backstage.io/v1alpha1
kind: Resource
metadata:
  name: neon-<project-id>
  title: <project-name>
  description: Neon serverless Postgres
  annotations:
    dbaas/provider: neon
    dbaas/connection-id: <connection-uuid>
    neon/project-id: <project-id>
    neon/region: aws-ap-southeast-1
    neon/pg-version: '16'
    backstage.io/managed-by-location: url:https://console.neon.tech/app/projects/<id>
spec:
  type: neon-database
  owner: user:default/<name>        # or group:default/<team>
  lifecycle: production
```

---

## Provider Interface (extensibility)

```typescript
interface DbaasProvider {
  id: string;                           // 'neon'
  displayName: string;                  // 'Neon'
  description: string;                  // 'Serverless Postgres'
  logoUrl: string;                      // for the marketplace card
  engines: string[];                    // ['postgres']
  credentialFields: CredentialField[];  // what the connect form shows
  supportsWebhooks: boolean;
  fetchDatabases(credentials: any): Promise<DbaasDatabase[]>;
  registerWebhook?(credentials: any, callbackUrl: string): Promise<string>;
  unregisterWebhook?(credentials: any, webhookId: string): Promise<void>;
  handleWebhookEvent?(payload: any): 'sync' | 'ignore';
}
```

Adding a new provider = implement `DbaasProvider` + add to registry. No other changes.

---

## Backend REST API

All routes require authentication. User identity read from Backstage token.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/dbaas/providers` | List all supported providers (for marketplace grid) |
| `GET` | `/api/dbaas/connections` | List current user's connections |
| `POST` | `/api/dbaas/connections` | Add connection + trigger initial sync |
| `DELETE` | `/api/dbaas/connections/:id` | Remove connection + deregister catalog entities |
| `POST` | `/api/dbaas/connections/:id/sync` | Manual sync (rate-limited: 1/min per connection) |
| `GET` | `/api/dbaas/connections/:id/databases` | List discovered databases |
| `POST` | `/api/dbaas/webhook/:provider/:id` | Inbound webhook from provider (unauthenticated) |

---

## Catalog Entity Lifecycle

| Event | Action |
|-------|--------|
| Connection added | Immediate sync → register entities |
| Webhook received (Railway, Atlas, Aiven, PlanetScale) | Re-sync affected connection |
| User clicks Refresh | Re-sync connection |
| New DB found in provider | Register new `Resource` entity |
| DB deleted in provider | Set `spec.lifecycle: deprecated` (soft delete) |
| Connection removed | Hard-delete all entities for that connection |

---

## Plugin File Structure

```
plugins/
├── dbaas/
│   ├── package.json
│   └── src/
│       ├── plugin.ts
│       ├── index.ts
│       ├── api/
│       │   ├── DbaasApi.ts           — API ref + interface
│       │   ├── DbaasClient.ts        — fetchApi implementation
│       │   └── types.ts
│       └── components/
│           ├── ConnectDatabasesPage/ — Main settings tab
│           │   ├── index.tsx
│           │   ├── ProviderGrid.tsx  — Marketplace grid
│           │   ├── ConnectedCard.tsx — Connected provider card
│           │   ├── AvailableCard.tsx — Available provider card
│           │   └── ConnectDialog.tsx — Connect modal
│           └── DatabaseList/         — Databases per connection
│               └── index.tsx
│
└── dbaas-backend/
    ├── package.json
    └── src/
        ├── plugin.ts
        ├── index.ts
        ├── routes.ts
        ├── sync.ts
        ├── webhook.ts
        ├── crypto.ts
        ├── providers/
        │   ├── registry.ts
        │   ├── types.ts
        │   └── neon.ts
        └── database/
            ├── DbaasStore.ts
            └── migrations/
                └── 001_create_dbaas_connections.js
```

---

## Implementation Order (Phase 1 — Neon)

1. `plugins/dbaas-backend` — migration, DbaasStore, crypto, Neon provider, routes, sync
2. `plugins/dbaas` — DbaasClient, types, ConnectDatabasesPage, marketplace grid, ConnectDialog (personal/team), DatabaseList
3. Wire backend: `packages/backend/src/index.ts`
4. Wire frontend: `packages/app/src/App.tsx` + Settings tab registration
5. Test: connect Neon account → databases appear in catalog

---

## Scaffolding Integration — Auto-Create Cloud DB

When a user scaffolds a new app and selects "Create new [Provider] project", the system creates the cloud DB on-the-fly and wires credentials into the deployment.

### Provider `engines` field

Each provider declares its DB engine(s). Already in the `DbaasProvider` interface above. Must also be exposed on `DbaasProviderInfo` (the read-only summary) so the frontend can filter without loading full provider details.

```typescript
type DbEngine = 'postgresql' | 'mysql' | 'mongodb' | 'redis';

interface DbaasProviderInfo {
  id: string;
  displayName: string;
  supportsCreate: boolean;
  engines: DbEngine[];   // ['postgresql'] for Neon/Supabase, ['mysql'] for PlanetScale, etc.
}
```

### DatabasePicker filtering

Templates declare which engines they support via `ui:options`:
```yaml
database:
  type: object
  ui:field: DatabasePicker
  ui:options:
    supportedEngines: ['postgresql']
```

`DatabasePicker` filters `creatableProviders` to only those whose `engines` overlap with `supportedEngines`. If `supportedEngines` is omitted, all engines shown.

### Skeleton variables: `database` + `cnpg`

`database === 'postgresql'` currently conflates two things in k8s skeletons:
- Include `cnpg-cluster.yaml` ← only for in-cluster CNPG, NOT for cloud providers
- Inject `DATABASE_URL` env var ← correct for ALL postgresql providers

Fix: two separate variables passed to k8s skeletons:

| Variable | Values | Controls |
|----------|--------|----------|
| `database` | `'postgresql'` \| `'mysql'` \| `'mongodb'` \| `'none'` | Env var injection, ORM/client in app code |
| `cnpg` | `true` \| `false` | Whether to include `cnpg-cluster.yaml` in kustomization |

- `cnpg: true` → only when `parameters.database.database === 'postgresql'` (in-cluster CNPG selected)
- `cnpg: false` → for all cloud providers (`create-new`) and `none`
- `database` for `create-new` → resolved from `steps['create-cloud-db'].output.dbType`

### Engine → env var mapping (in deployment.yaml skeleton)

| Engine | Env var |
|--------|---------|
| postgresql | `DATABASE_URL` |
| mysql | `DATABASE_URL` |
| mongodb | `MONGODB_URI` |

### `dbaas:create-project` action outputs

Add `dbType: DbEngine` to outputs so templates can pass the correct `database` value to skeletons when `create-new` is selected.

### Files to change

| File | Change |
|------|--------|
| `plugins/dbaas-backend/src/providers/types.ts` | Add `engines: DbEngine[]` to `DbaasProviderInfo` and `dbType` to `DbaasProjectCreated` |
| `plugins/dbaas-backend/src/providers/neon.ts` | Return `engines: ['postgresql']`, output `dbType: 'postgresql'` |
| `plugins/dbaas-backend/src/providers/registry.ts` | Include `engines` in `getAllProviderInfo()` |
| `plugins/dbaas/src/api/types.ts` | Add `engines: DbEngine[]` to frontend `ProviderInfo` |
| `packages/app/src/components/scaffolder/DatabasePicker.tsx` | Filter providers by `supportedEngines` from `uiSchema['ui:options']` |
| `packages/backend/.../dbaasCreateProject.ts` | Add `dbType` to output schema + emit it |
| `skeletons/targets/k8s/k8s/base/kustomization.yaml` | `{%- if values.cnpg %}` instead of `{%- if values.database === 'postgresql' %}` |
| `skeletons/targets/k8s/k8s/base/deployment.yaml` | Handle all db engines for env var injection |
| All templates using k8s skeleton | Pass `cnpg` boolean + resolved `database` engine |

---

## Open Questions (resolved)

| Question | Decision |
|----------|----------|
| Sync strategy | Webhooks where supported, on-demand refresh otherwise — no polling |
| Tab name | "Connect Databases" |
| UI style | Vercel integrations marketplace |
| Personal vs team | User picks per connection in ConnectDialog |
| All providers shown | Yes — supported providers always visible (connected + available sections) |
| Catalog visibility | Follows owner: personal = user only, team = team members |
| Kustomization CNPG | Separate `cnpg` boolean variable, not `database === 'postgresql'` |
| Cloud DB env var | Derived from `dbType` output of `dbaas:create-project` action |
| DatabasePicker filtering | `ui:options.supportedEngines` per template |
