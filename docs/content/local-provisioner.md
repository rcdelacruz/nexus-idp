# Local Provisioner

The Local Provisioner lets you spin up development resources (Kafka, PostgreSQL, Redis, MongoDB) on your own machine via Docker Compose — without needing to configure anything manually.

---

## How It Works

1. You install the `backstage-agent` CLI on your machine
2. The agent connects to Nexus IDP and listens for provisioning tasks
3. You request a resource from the Nexus IDP UI
4. The agent runs the Docker Compose stack on your machine and reports status back

Your machine must be running and the agent must be active for provisioning to work.

---

## Prerequisites

- Docker Desktop (or Docker + Docker Compose) installed and running
- Node.js 20+
- Access to Nexus IDP (any authenticated user)

---

## Install the Agent

```bash
npm install -g @stratpoint/backstage-agent
```

---

## First-Time Login

The agent uses a device code flow (similar to GitHub CLI):

```bash
backstage-agent login
```

This will:
1. Print a user code (e.g. `ABCD-1234`)
2. Open your browser to the Nexus IDP device auth page
3. You enter the code and authenticate with Google
4. The agent saves a token to `~/.backstage-agent/config.json`

You only need to do this once. The token is valid for 30 days.

---

## Start the Agent

```bash
backstage-agent start
```

The agent runs in the foreground and connects to Nexus IDP. Keep this terminal open while you're developing.

To verify it's connected:

```bash
backstage-agent status
```

---

## Provisioning a Resource

1. Go to **Local Provisioner** in the Nexus IDP sidebar
2. Click **New Resource**
3. Select the resource type: `kafka`, `postgres`, `redis`, or `mongodb`
4. The task is queued and sent to your agent
5. The agent starts the Docker Compose stack on your machine
6. Status updates appear in real time in the UI

Connection details (host, port, credentials) are shown once the resource is running.

---

## Supported Resources

| Resource | Default Port | Notes |
|----------|-------------|-------|
| PostgreSQL | 5432 | Latest stable, database: `dev` |
| Redis | 6379 | No auth by default |
| Kafka | 9092 | Includes Zookeeper |
| MongoDB | 27017 | No auth by default |

---

## Stopping the Agent

Press `Ctrl+C` in the terminal where the agent is running. Active Docker Compose stacks continue running until you stop them manually:

```bash
docker compose down
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `backstage-agent login` — browser doesn't open | Copy the URL printed in the terminal and open it manually |
| Agent shows as offline in UI | Run `backstage-agent start` on your machine |
| Token expired | Run `backstage-agent login` again |
| Docker Compose fails | Check Docker is running: `docker info` |
| Port conflict | Stop any existing service using that port |
