# Local Provisioner — Architecture

| Field | Value |
|-------|-------|
| **Audience** | Platform contributors and maintainers |
| **Status** | As-built, 2026-07-28 |
| **User guide** | [Local Provisioner](local-provisioner.md) — install, log in, provision |

This document describes **how the Local Provisioner works and why it is shaped this way**.
For instructions on using it, read the [user guide](local-provisioner.md) instead.

---

## The problem it solves

Developers need local infrastructure to work against — today, exclusively guided training
environments (Kafka, the DevOps/DevSecOps Capstone app). The executor and agent also support
plain, standalone Kafka/Postgres/Redis/MongoDB as bundled templates, but no template or UI path
provisions any of them — see [Execution on the laptop](#execution-on-the-laptop) below. Setting
infrastructure like this up by hand is repetitive, drifts between machines, and is invisible to
the platform team.

The obvious solution is "let the portal provision it," which runs straight into a hard
constraint:

> **The portal runs in the cloud. The Docker daemon runs on a laptop behind NAT.
> The server cannot open a connection to the developer's machine.**

Every significant design decision in this module follows from that one sentence.

## Consequences of that constraint

| Constraint | Consequence |
|---|---|
| Server cannot reach the laptop | **Pull-based agent.** A CLI on the laptop opens an outbound connection and receives work over it. |
| Work must survive disconnects | **Durable task queue in PostgreSQL**, not in-memory dispatch. An offline agent collects its tasks on reconnect. |
| Need instant delivery, but a persistent stream isn't reliable through the tunnel | **Event-driven long-polling**, not Server-Sent Events. `GET /agent/poll` holds the request open (bounded by `POLL_TIMEOUT_MS`, 25s) and resolves the instant work is queued (`AgentService.notifyAgent()` wakes a parked request) or on timeout; the agent immediately reissues. Replaced SSE on 2026-07-26 — SSE needed one persistent connection held open indefinitely, which the Cloudflare tunnel in front of the portal doesn't reliably keep alive; many short bounded requests (well under Cloudflare's ~100s ceiling) have no long-lived connection state to silently lose. |
| A headless CLI cannot host an OAuth redirect URI | **OAuth Device Authorization Grant (RFC 8628).** The browser authenticates; the CLI polls for the result. Same model as `gh auth login` and `aws sso login`. |

## Components

| Component | Path | Runs on | Role |
|---|---|---|---|
| Backend plugin | `plugins/local-provisioner-backend/` | Portal | Task queue, agent registry, long-poll delivery, device-code flow, catalog `EntityProvider` |
| Frontend plugin | `plugins/local-provisioner/` | Browser | Task list, task detail, agent status (no working provision UI of its own — see Execution on the laptop) |
| CLI agent | `packages/backstage-agent/` | Developer laptop | Receives tasks, runs Docker Compose, reports status |

The three are independently deployable. The agent is versioned and released separately —
a backend change that alters the wire contract must stay backward-compatible with agents
already installed on developer machines.

## Task lifecycle

```
  Browser                Portal backend                     Laptop agent
     │                          │                                 │
     │  POST /tasks             │                                 │
     ├─────────────────────────►│                                 │
     │             TaskQueueService.createTask                    │
     │                          │                                 │
     │              TaskStore ──► provisioning_tasks              │
     │                          │   status = pending              │
     │                          │                                 │
     │                          │◄──── GET /agent/poll?agentId= ─┤
     │                          │      (long-poll, held open,     │
     │                          │       reissued every ~25s)      │
     │                          │                                 │
     │             notifyAgent() wakes the parked request         │
     │                          │   (instant if a task was just   │
     │                          │    queued; otherwise the poll   │
     │                          │    just times out and retries)  │
     │                          │  response: { tasks } ──────────►│
     │                          │                        DockerComposeExecutor
     │                          │                        writes docker-compose.yml
     │                          │                        runs `docker compose up`
     │                          │                                 │
     │                          │◄─ POST /agent/tasks/:id/status ─┤
     │                          │   status = completed | failed   │
     │  GET /tasks (poll)       │                                 │
     ├─────────────────────────►│                                 │
```

Every `/agent/poll` response also refreshes the agent's `last_seen` timestamp — there is no
separate heartbeat call. An agent is considered online for 90s after its last poll.

**Key files along that path**

| Step | File |
|---|---|
| Route definitions | `src/api/taskRoutes.ts`, `src/api/agentRoutes.ts` |
| Queue logic | `src/service/TaskQueueService.ts` |
| Agent lifecycle + long-poll delivery | `src/service/AgentService.ts` |
| Persistence | `src/database/TaskStore.ts` |
| Agent main loop | `packages/backstage-agent/src/agent/Agent.ts` |
| Execution | `packages/backstage-agent/src/executor/DockerComposeExecutor.ts` |

## Backend plugin wiring

Standard new-backend-system plugin (`createBackendPlugin`, `src/plugin.ts`), depending on
`coreServices.{logger,database,httpRouter,rootConfig,discovery,httpAuth}`.

Two things worth knowing before editing it:

1. **`addAuthPolicy` calls must precede `httpRouter.use()`** — the platform-wide rule from
   `CLAUDE.md`. The agent-facing endpoints are declared public there because they carry an
   agent credential rather than a browser session.
2. **Route auth is deny-by-default**, enforced from a single source of truth:
   `src/util/publicPaths.ts`'s `PUBLIC_AGENT_PATHS` list. Everything not on that list requires
   a Backstage credential. Two layers consume the same list and must agree — the framework
   barrier (`plugin.ts` registers each entry via `httpRouter.addAuthPolicy`) and the router
   middleware (`service/router.ts` uses `isPublicAgentPath`) — a path public in one layer and
   protected in the other was exactly the kind of drift this module previously suffered from.
   If you add a route, add it to `PUBLIC_AGENT_PATHS` only if it genuinely needs to be
   reachable without a Backstage session (i.e. it carries its own agent credential).

## Data model

Two tables, created by `src/database/migrations/`:

**`provisioning_tasks`** — the durable queue.
`task_id` (uuid, pk) · `agent_id` · `user_id` · `task_type` · `resource_name` ·
`config` (jsonb) · `status` · timestamps. Indexed on `agent_id`, `user_id`, `status`,
`created_at`.

**`agent_registrations`** — the agent registry.
`agent_id` (pk) · `user_id` · registration + liveness timestamps · `status`.
Migration 002 adds machine identity (`hostname`, `platform_version`) and a
`(hostname, user_id)` uniqueness constraint so re-running the agent on the same machine
**re-attaches to the existing agent record** rather than creating a duplicate.

> ⚠️ **Migrations do not run in-process.** `router.ts` verifies both tables exist
> (`db.schema.hasTable`) and fails startup if they do not. Migrations are applied by an init
> container in production, or manually via `node scripts/run-migrations.js` in development.
> Migration 004 (`004-reconcile-taskstore-schema.js`) reconciled a prior drift between
> migrations 001-003 and the columns `TaskStore` actually uses — that drift had made agent
> registration/heartbeats/SSE-connect throw on missing columns, so no agent could ever
> complete a lifecycle. Migration 005 added `logs`/`metadata`/`connection_details`. Both are
> applied as of 2026-07-24; the migration files and `TaskStore` are in sync.

## The type transformation layer

The module deliberately maintains **two type systems** with a translation layer between them
— the pattern `CLAUDE.md` calls the platform's core idiom.

```
Backend (DB / API)        transformers.ts         Frontend (React)
──────────────────        ───────────────         ────────────────
snake_case                transformTask()         camelCase
task_id                   transformAgent()        id
agent_id                  transformTasks()        agentId
{ tasks, total }          transformTaskStats()    ProvisioningTask[]
```

- Backend-shaped interfaces are prefixed `Backend*` (`BackendProvisioningTask`) and mirror
  the API response exactly.
- Frontend interfaces are clean camelCase for component props.
- `LocalProvisionerClient` applies the transform automatically, so components never see
  snake_case.

Defined in `plugins/local-provisioner/src/api/{types,transformers}.ts`. **Changing a backend
field means changing four places**: the DB column, the backend type, the `Backend*` type, and
the transformer.

## Agent authentication

The CLI uses the **OAuth Device Authorization Grant**:

1. CLI → `POST /agent/device/code` → receives `device_code` + human-readable `user_code`
2. User opens the portal, enters the code, authenticates with Google
3. Browser → `POST /agent/device/authorize` (authenticated — this is where real identity is
   established)
4. CLI polls `POST /agent/device/token` until authorized, receives an agent token
5. Token is written to `~/.backstage-agent/config.json` and sent as a bearer credential on
   subsequent agent calls

Device codes expire in 10 minutes. The `/device/code` and `/device/token` endpoints are rate
limited (`express-rate-limit`) because they are unauthenticated by necessity.

Agent tokens are **HMAC-SHA256-signed** (`AgentService.ts`: `<base64url(payload)>.<base64url(HMAC-SHA256)>`,
verified with `timingSafeEqual`), expiring after 7 days. Not a JWT — a lighter custom format —
but it is cryptographically verified, not an opaque bearer string.

## Execution on the laptop

`DockerComposeExecutor` receives a task, writes a `docker-compose.yml` into a per-task
directory, and shells out to `docker compose up`. The compose content comes from **one of two
sources**, resolved by `getDockerComposeContent()`:

1. **Pre-rendered in the task payload** (`task.config.dockerCompose`) — used by every scaffolder
   template that calls the `stratpoint:local-provision` action: `kafka-training-local`,
   `devops-capstone-training-local`, and `devsecops-capstone-training-local`, all in
   `engineering-standards`. Each template renders the compose file at scaffold time and it's
   carried through as part of the task. This is the **only path currently reachable from the
   portal** — there is no "Provision resource" dialog wired up (see below).
2. **A bundled template on the agent** (`packages/backstage-agent/templates/<type>/docker-compose.yml`,
   Mustache-rendered from `task.config`) — would be used by resources provisioned through a
   direct dialog on the Local Provisioner page, but that dialog (`ProvisionDialog.tsx`) was
   reverted to unused, unreachable code — see
   [the user guide](local-provisioner.md#adding-more-resources--training-environments). This
   path is currently **dead**: nothing invokes it. `packages/backstage-agent/templates/devops-capstone-training/`
   and `.../devsecops-capstone-training/` do contain bundled `app/` source copies from an earlier
   design attempt, but since both capstone templates always send `task.config.dockerCompose`
   (path 1 above), `copyTemplateAssets()` — gated on `!task.config.dockerCompose` — never runs
   for them; those bundled directories are dead weight, not a live fallback.

Since path 1 is the only one that actually matters, and it only ever carried the rendered compose
*text* (not any source files the compose builds from), `devops-capstone-training`/
`devsecops-capstone-training` — which build custom images `FROM` a fetched app source rather than
pulling public ones — had no way to get that source onto the agent's machine at all. Fixed in
0.1.21 (backend + agent): `stratpoint:local-provision` gained an optional `sourceDir` input; when
set, it walks that directory, base64-encodes every file into `task.config.sourceFiles` (a flat
`{ relativePath: base64Content }` map, sent alongside `dockerCompose`), and
`DockerComposeExecutor.writeSourceFiles()` decodes and writes them into the task directory before
`docker compose up` runs. Before this, every devops/devsecops-capstone provision failed with
`unable to prepare context: path ".../app/backend" not found`.

The executor checks Docker is installed and running before attempting anything and returns a
structured failure if not.

## Configuration

```yaml
localProvisioner:
  enabled: true
  pollTimeoutSeconds: 25   # how long the agent's long-poll request may be held open
  taskRetentionDays: 30
  supportedResources: [kafka, kafka-training, postgres, redis, mongodb, devops-capstone-training, devsecops-capstone-training]
```

Present in `app-config.yaml`. `supportedResources` is declared in the schema but not actually
read anywhere in the backend — listing a type here does not make it provisionable; that's
governed entirely by whether a scaffolder template exists for it (see Extending it, below). Task
delivery is long-poll-based (`pollTimeoutSeconds`, above) — see
[Consequences of that constraint](#consequences-of-that-constraint) for why this replaced SSE.

## Operational constraints

- **Single replica.** Parked long-poll requests (`AgentService.pollWaiters`) are held in process
  memory — `notifyAgent()` only wakes a request parked on the same pod, so an agent's in-flight
  poll is only instantly wakeable by whichever pod holds it. Rate-limit state is likewise
  in-memory. The deployment pins `replicaCount: 1` (also required for migration-lock safety).
  Scaling out requires externalizing both, most naturally onto the Redis that is already a
  dependency.
- **Catalog integration is active** — via `LocalProvisionerEntityProvider`
  (`src/provider/LocalProvisionerEntityProvider.ts`), a standard Backstage `EntityProvider`. On
  each `refresh()` it reads all active resources from `TaskStore.getActiveProvisionedResources()`
  and applies a full mutation to the catalog — resource state (`removed`, etc.) is reflected on
  the next refresh, no separate teardown-sync step needed. It builds each entity generically from
  `resource.resource_name`/`resource.resource_type` (auto-tags anything ending in `-training`
  with `training`/`local-provisioning`), so adding a new resource type needs **no code change
  here**. `CatalogService.ts` (`src/service/CatalogService.ts`) is a separate, **entirely dead**
  class from an earlier design — never instantiated anywhere in the codebase (confirmed by
  exhaustive grep), only referenced as a commented-out import in `router.ts`. Its own
  `.addLocation()` method was a stub; `LocalProvisionerEntityProvider`'s doc comment explicitly
  says it "replaces the never-wired `CatalogService.addLocation` stub." Safe to delete; not yet
  done.
- **Startup is fail-fast on schema.** A missing table stops the plugin rather than failing
  later at request time.

## Extending it

**Adding a resource type** — the only reachable path today is a scaffolder template (see
`kafka-training-local`, `devops-capstone-training-local`, or `devsecops-capstone-training-local`
in `engineering-standards`). Add `TaskType`/`ResourceType` enum values and a
`resourceTypeForTask` case in `plugins/local-provisioner-backend/src/types.ts`, then a template
that renders a `docker-compose.yml` and calls `stratpoint:local-provision` (`dockerComposeFile`,
and `sourceDir` if it builds from source — see above). This is also where multi-parameter forms,
conditional steps, and a companion per-user repo (`publish:github`/`publish:gitlab`) get built —
none of that is available via the dead dialog path.

`localProvisioner.supportedResources` in `app-config.yaml` and `ProvisionDialog.tsx`'s
`RESOURCE_TYPES` are **not** part of this path — the config array is declared in the schema but
never read/enforced anywhere in the backend, and the dialog component is dead code (not wired
into `LocalProvisionerPage.tsx`). Don't update either expecting it to do anything; if the dialog
is ever re-wired as a genuine second path, document that decision here rather than assuming it
already works.

**Adding an endpoint** — define the route. It's protected by default; only add it to
`PUBLIC_AGENT_PATHS` in `util/publicPaths.ts` (plus the matching `addAuthPolicy` entry in
`plugin.ts`, before `httpRouter.use()`) if it genuinely needs to be reachable without a
Backstage session.

**Changing a task field** — remember the four-place rule in the type layer above.

## Known gaps

| Gap | Impact |
|---|---|
| `CatalogService.ts` is dead code | No functional impact (unused), but confusing to anyone editing it thinking it's live — see catalog integration note above |
| Migration/`TaskStore` schema drift | A fresh environment may not match a deployed one |
| Single-replica coupling | Blocks horizontal scaling of the whole backend |
| Light test coverage | 4 test files in `plugins/local-provisioner-backend/src/` (`AgentService`, `TaskStore`, `identity`, `publicPaths`) — no tests for `LocalProvisionerEntityProvider`, `DockerComposeExecutor`, or `sourceFiles` handling |
| Dead bundled capstone templates | `packages/backstage-agent/templates/devops-capstone-training/app/` and `.../devsecops-capstone-training/app/` are stale, unreachable copies of the app source from an earlier (abandoned) design — see Execution on the laptop, above. Not yet deleted |

---

*Companion user documentation: [Local Provisioner](local-provisioner.md).
Security review detail is maintained internally and is not part of this document.*
