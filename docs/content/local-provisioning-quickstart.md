# Local Provisioning — Quick Start

The Local Provisioning system lets engineers spin up local Docker Compose environments (Kafka, PostgreSQL, Redis, MongoDB) directly from the Nexus IDP portal. The `backstage-agent` CLI runs on your dev machine and executes the provisioning tasks.

## Architecture

```
Nexus IDP Portal  →  POST /api/local-provisioner/tasks
                  ↓
    local-provisioner-backend  (task queue, SSE)
                  ↓  SSE stream
    backstage-agent CLI  (running on your machine)
                  ↓
    Docker Compose  (local containers)
```

## Prerequisites

- Docker and Docker Compose installed on your machine
- Access to the Nexus IDP portal (`https://portal.yourcompany.io`)
- The `backstage-agent` CLI (install instructions below)

## Install the Agent CLI

```bash
# Install globally via npm
npm install -g @example-org/backstage-agent

# Verify installation
backstage-agent --help
```

## Authenticate the Agent

The agent uses the OAuth device code flow (RFC 8628) — same as GitHub CLI:

```bash
backstage-agent login --url https://portal.yourcompany.io
```

This will:
1. Display a user code (e.g. `ABCD-1234`)
2. Open your browser to `https://portal.yourcompany.io/device`
3. You enter the code and authenticate via Google OAuth
4. The agent receives a 30-day token stored in `~/.backstage-agent/config.json`

## Start the Agent

```bash
backstage-agent start
```

The agent connects to the portal via SSE and waits for provisioning tasks. Leave it running in a terminal while you work.

## Provision a Resource

1. Open the Nexus IDP portal
2. Navigate to **Local Provisioner** in the sidebar
3. Click **New Provisioning Task**
4. Select a resource type: `kafka`, `postgres`, `redis`, or `mongodb`
5. Fill in the parameters (name, version, ports)
6. Click **Provision**
7. Monitor the task status in the portal — the agent picks it up and runs Docker Compose on your machine

## Check Agent Status

```bash
backstage-agent status
```

Shows connection status, registered agent ID, and last heartbeat.

## Stop the Agent

Press `Ctrl+C` in the agent terminal, or:

```bash
backstage-agent stop
```

## Logout

```bash
backstage-agent logout
```

Removes the stored token from `~/.backstage-agent/config.json`.

## Supported Resources

| Resource | Description |
|----------|-------------|
| `kafka` | Apache Kafka + Zookeeper |
| `postgres` | PostgreSQL database |
| `redis` | Redis cache |
| `mongodb` | MongoDB database |

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Agent shows "Disconnected" | Network issue or portal restart | Run `backstage-agent start` again |
| Task stuck in "Pending" | Agent not running | Start the agent on your machine |
| "Token expired" error | 30-day token expired | Run `backstage-agent login` again |
| Docker Compose fails | Docker not running | Start Docker Desktop |
| Port conflict | Another service using the port | Change the port in the provisioning parameters |

## Key Files

| File | Purpose |
|------|---------|
| `~/.backstage-agent/config.json` | Stored auth token and portal URL |
| `packages/backstage-agent/` | Agent CLI source code |
| `plugins/local-provisioner-backend/` | Backend plugin (task queue, SSE, agent management) |
| `plugins/local-provisioner/` | Frontend plugin (UI) |
