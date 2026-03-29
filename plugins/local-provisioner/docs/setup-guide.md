# Setup Guide

Get the Nexus Agent CLI running on your local machine in 5 minutes.

## Prerequisites

- **Docker Desktop** installed and running — [download](https://www.docker.com/products/docker-desktop)
- **Node.js 18+** — [download](https://nodejs.org/)
- **Nexus IDP** portal running (local or production)
- **Google account** with your organization email

## Step 1: Build the Agent

```bash
cd packages/backstage-agent
yarn install
yarn build
```

## Step 2: Link CLI Globally (Optional)

```bash
npm link
```

Now you can run `backstage-agent` from anywhere.

## Step 3: Login

```bash
backstage-agent login --url http://localhost:7007
```

What happens:
1. Browser opens for Google sign-in
2. Sign in with your organization account
3. Tokens saved to `~/.backstage-agent/config.json`
4. Agent registered with Nexus IDP

## Step 4: Start the Agent

```bash
backstage-agent start
```

Leave this running in your terminal. The agent connects via SSE and waits for tasks.

## Step 5: Create a Task

1. Open the portal in your browser
2. Navigate to **Local Provisioner**
3. Click **Create Task**
4. Select a resource type (e.g. Kafka, PostgreSQL)
5. Fill in the configuration
6. Submit

The agent picks up the task automatically and runs Docker Compose on your machine.

## Step 6: Verify

```bash
docker ps
```

You should see your provisioned containers running.

## Stopping

Press `Ctrl+C` in the agent terminal to stop.

## Cleaning Up

```bash
cd ~/.backstage-agent/tasks/<task-id>
docker-compose down -v
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "No configuration found" | Run `backstage-agent login --url <url>` first |
| "Docker is not available" | Start Docker Desktop, verify with `docker ps` |
| "Authentication token expired" | Run `backstage-agent login` again |
| "Port already in use" | Change the port in task config or stop the existing service |
| "SSE connection error" | Check that the backend is running: `curl http://localhost:7007/api/local-provisioner/health` |
