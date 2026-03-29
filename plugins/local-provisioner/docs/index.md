# Local Provisioner

## What is it?

The Local Provisioner is a self-service system built into Nexus IDP that lets developers provision local development infrastructure — Docker containers like Kafka, PostgreSQL, Redis, and more — directly from the portal with a single click. No Docker Compose files, no Googling for the right image, no manual configuration.

## Why does it exist?

Setting up local infrastructure is one of the most common friction points for developers, especially those new to a project or new to the team. Every developer ends up:

- Writing their own Docker Compose files from scratch
- Using different image versions, port mappings, and configurations
- Spending time on setup instead of actual development
- Having no visibility into what others on the team are running

The Local Provisioner eliminates this by providing **standardized, one-click provisioning** managed centrally through the IDP.

## Goals

1. **Zero-config local infrastructure** — developers pick a resource, click a button, and it runs on their machine in seconds
2. **Standardization** — every developer gets the same image versions, port conventions, environment variables, and health checks
3. **Onboarding speed** — new hires, trainees, and interns can set up their local environment without Docker knowledge
4. **Visibility** — team leads and platform admins can see what resources the team is using across all machines
5. **Centralized templates** — infrastructure templates are maintained by the platform team, not scattered across individual repos

## Who benefits?

| User | Benefit |
|------|---------|
| **Trainees & Interns** | One-click setup without needing to learn Docker or Docker Compose |
| **New hires** | Get a working local environment on day one, matching team standards |
| **Developers** | Skip the boilerplate — focus on code, not infrastructure setup |
| **Tech leads** | Ensure consistent environments across the team |
| **Platform team** | Maintain infrastructure templates in one place, track usage |

## How It Works

```
Nexus IDP Portal (browser)
    ↓ Create task (pick resource type + config)
Backend (task queue + SSE)
    ↓ Stream task to agent
Nexus Agent CLI (your machine)
    ↓ Generate Docker Compose + execute
Docker (local containers running)
```

1. You open the **Local Provisioner** page in the portal
2. You create a provisioning task — pick a resource type (Kafka, PostgreSQL, etc.) and configure it
3. The backend queues the task and streams it to your registered agent via SSE
4. The **Nexus Agent CLI** on your machine picks up the task
5. The agent generates a Docker Compose file from the template and runs it
6. Your local resource is up and running — pre-configured and ready to use

## Architecture

The Local Provisioner has three components:

| Component | Location | Purpose |
|-----------|----------|---------|
| Backend plugin | `plugins/local-provisioner-backend/` | Task queue, SSE streaming, agent registry, device code auth |
| Frontend plugin | `plugins/local-provisioner/` | UI — task list, agent status, create tasks |
| Nexus Agent CLI | `packages/backstage-agent/` | Runs on dev machines — connects to backend, executes tasks via Docker Compose |

### Database

The backend uses its own database (`backstage_plugin_local-provisioner`) with two tables:
- `provisioning_tasks` — task queue with status tracking
- `agent_registrations` — registered agent registry with machine info

### Security

Authentication uses the **OAuth 2.0 Device Authorization Grant** (RFC 8628) — the same flow used by GitHub CLI and AWS CLI. The agent authenticates through the portal's Google OAuth without needing to handle credentials directly.

## Pages

- [Setup Guide](setup-guide) — install and configure the Nexus Agent CLI
- [Authentication](authentication) — how the OAuth device code flow works
