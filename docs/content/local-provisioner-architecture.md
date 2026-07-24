# Local Provisioner — Architecture

| Field | Value |
|-------|-------|
| **Audience** | Platform contributors and maintainers |
| **Status** | As-built, 2026-07-24 |
| **User guide** | [Local Provisioner](local-provisioner.md) — install, log in, provision |

This document describes **how the Local Provisioner works and why it is shaped this way**.
For instructions on using it, read the [user guide](local-provisioner.md) instead.

---

## The problem it solves

Developers need local infrastructure — Kafka, Postgres, Redis, MongoDB — to work against.
Setting that up by hand is repetitive, drifts between machines, and is invisible to the
platform team.

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
| Push-on-open-socket, not polling | **Server-Sent Events.** One long-lived outbound HTTP stream; the server writes tasks into it. Simpler than WebSockets for one-directional delivery. |
| A headless CLI cannot host an OAuth redirect URI | **OAuth Device Authorization Grant (RFC 8628).** The browser authenticates; the CLI polls for the result. Same model as `gh auth login` and `aws sso login`. |

## Components

| Component | Path | Runs on | Role |
|---|---|---|---|
| Backend plugin | `plugins/local-provisioner-backend/` | Portal | Task queue, agent registry, SSE hub, device-code flow |
| Frontend plugin | `plugins/local-provisioner/` | Browser | Task list, task detail, agent status |
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
     │                          │◄──── GET /agent/events/:agentId │
     │                          │      (SSE, held open)           │
     │                          │                                 │
     │                          │  event: task ──────────────────►│
     │                          │                        DockerComposeExecutor
     │                          │                        writes docker-compose.yml
     │                          │                        runs `docker compose up`
     │                          │                                 │
     │                          │◄─ POST /agent/tasks/:id/status ─┤
     │                          │   status = completed | failed   │
     │  GET /tasks (poll)       │                                 │
     ├─────────────────────────►│                                 │
```

**Key files along that path**

| Step | File |
|---|---|
| Route definitions | `src/api/taskRoutes.ts`, `src/api/agentRoutes.ts` |
| Queue logic | `src/service/TaskQueueService.ts` |
| Agent lifecycle + SSE fan-out | `src/service/AgentService.ts` |
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
2. **Route auth is currently enforced by Express middleware in `src/service/router.ts`**,
   which classifies each request path as public or protected. If you add a route, you must
   reason about that list explicitly — it does not deny by default. Hardening this to
   deny-by-default is tracked internally.

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

> ⚠️ **Migrations do not run in-process.** `router.ts` verifies both tables exist and fails
> startup if they do not. Migrations are applied by an init container in production, or
> manually via `node scripts/run-migrations.js` in development. There is a known drift
> between the migration files and the columns `TaskStore` uses — verify the live schema
> before relying on either as the source of truth.

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

> The agent token format predates the device-code flow and is an opaque bearer string rather
> than a signed JWT. Hardening it to a signed token is tracked internally as a breaking
> change — it invalidates tokens on every installed agent and requires a coordinated CLI
> release.

## Execution on the laptop

`DockerComposeExecutor` receives a task, writes a `docker-compose.yml` rendered from the
task's `config` into a per-task directory, and shells out to `docker compose up`.

The compose content originates from the **`engineering-standards` repo**, carried in the task
payload — deliberately, so resource definitions have a single source of truth and are not
duplicated inside the agent binary. The executor checks Docker is installed and running
before attempting anything and returns a structured failure if not.

## Configuration

```yaml
localProvisioner:
  enabled: true
  sseHeartbeatInterval: 30   # seconds; keeps SSE connections alive through proxies
  taskRetentionDays: 30
  supportedResources: [kafka, postgres, redis, mongodb]
```

Present in both `app-config.yaml` and `app-config.production.yaml`.
`sseHeartbeatInterval` matters more than it looks — intermediate proxies will close an idle
stream, and the heartbeat is what keeps it open.

## Operational constraints

- **Single replica.** SSE connections are held in process memory, so an agent is reachable
  only from the pod that holds its socket. Rate-limit state is likewise in-memory. The
  deployment pins `replicaCount: 1` (also required for migration-lock safety). Scaling out
  requires externalizing both, most naturally onto the Redis that is already a dependency.
- **Catalog integration is not active.** `CatalogService` exists but is not wired into the
  router. Provisioned resources are **not** currently registered as catalog entities, despite
  what the backend plugin README claims.
- **Startup is fail-fast on schema.** A missing table stops the plugin rather than failing
  later at request time.

## Extending it

**Adding a resource type** — add to `supportedResources` in both config files, add the
`TaskType` enum member (`src/types.ts`), and ensure a compose definition exists in
`engineering-standards`. The executor is generic; it does not need changes.

**Adding an endpoint** — define the route, then explicitly decide its auth classification in
`router.ts` (it will otherwise be treated as protected only if it falls outside the public
list). Add an `addAuthPolicy` entry in `plugin.ts` before `httpRouter.use()` if it should be
public.

**Changing a task field** — remember the four-place rule in the type layer above.

## Known gaps

| Gap | Impact |
|---|---|
| Catalog integration disabled | Provisioned resources are invisible to the catalog |
| Migration/`TaskStore` schema drift | A fresh environment may not match a deployed one |
| Single-replica coupling | Blocks horizontal scaling of the whole backend |
| Near-zero test coverage | See backlog task `F2` (transformer tests), `F14` (tasks API) |
| Agent token hardening | Tracked internally; breaking change for installed agents |

---

*Companion user documentation: [Local Provisioner](local-provisioner.md).
Security review detail is maintained internally and is not part of this document.*
