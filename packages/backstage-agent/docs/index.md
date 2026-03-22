# Backstage Agent Setup Guide

## Overview

The Backstage Agent is a CLI tool that runs on your local development machine to provision infrastructure resources (Docker containers) for training and development purposes. It connects to the Backstage portal via Server-Sent Events (SSE) to receive provisioning tasks in real-time.

## Prerequisites

Before installing the Backstage Agent, ensure you have:

1. **Node.js** - Version 20.x or 22.x
   ```bash
   node --version  # Should be v20.x or v22.x
   ```

2. **Docker Desktop** - Installed and running
   - [Download Docker Desktop](https://www.docker.com/products/docker-desktop/)
   - Verify: `docker --version`

3. **Google Account** - With @stratpoint.com domain
   - Required for OAuth authentication

4. **Network Access** - Ability to connect to Backstage portal
   - Production: `https://portal.stratpoint.io`
   - Local Dev: `http://localhost:7007`

---

## Installation

### Option 1: Install from Monorepo (Development)

If you have the backstage-main-strat-eng repository cloned:

```bash
# Navigate to agent package
cd /path/to/backstage-main-strat-eng/packages/backstage-agent

# Install dependencies
yarn install

# Build the package
yarn build

# Link globally
npm link

# Verify installation
backstage-agent --version
```

### Option 2: Install from npm (Production - Coming Soon)

```bash
npm install -g @stratpoint/backstage-agent

# Verify installation
backstage-agent --version
```

---

## Authentication

The Backstage Agent uses **OAuth 2.0 Device Authorization Grant (RFC 8628)** - the same authentication pattern used by GitHub CLI, AWS CLI, and Azure CLI.

### Step 1: Login to Backstage

```bash
backstage-agent login --url http://localhost:7007
```

**For production:**
```bash
backstage-agent login --url https://portal.stratpoint.io
```

### Step 2: Complete Device Authorization

The CLI will display:

```
To authorize this device, visit:
  http://localhost:7007/device

And enter code: ABCD-1234

Waiting for authorization... (expires in 10 minutes)
```

### Step 3: Authorize in Browser

1. Open the displayed URL in your browser
2. Sign in with your Google account (@stratpoint.com)
3. Enter the displayed code (e.g., `ABCD-1234`)
4. Click "Authorize"

### Step 4: Confirmation

Once authorized, the CLI will display:

```
✓ Device authorized!
✓ Token saved to ~/.backstage-agent/config.json
✓ Agent ID: agent-abc123
```

---

## Starting the Agent

After successful authentication, start the agent:

```bash
backstage-agent start
```

You should see:

```
[INFO] Backstage Agent v1.0.0
[INFO] Agent ID: agent-abc123
[INFO] Connecting to Backstage at http://localhost:7007
[INFO] ✓ Connected via Server-Sent Events
[INFO] ✓ Waiting for provisioning tasks...
```

The agent is now running and will:
- Maintain a connection to Backstage via SSE
- Receive provisioning tasks in real-time
- Execute Docker Compose commands
- Report task status back to Backstage
- Send heartbeat every 30 seconds

---

## Using the Agent

### Provisioning Resources

Once the agent is running, you can provision resources from the Backstage UI:

1. Navigate to **Create** in Backstage
2. Search for "Training" templates (e.g., "Kafka Local Provision")
3. Fill in the configuration form
4. Click **Create**

The agent will:
1. Receive the task via SSE
2. Generate `docker-compose.yml` from the template
3. Execute `docker-compose up -d`
4. Validate containers are running
5. Report success/failure to Backstage

### Monitoring Tasks

View active and completed tasks:

1. Open Backstage UI
2. Navigate to **Local Provisioner** (sidebar)
3. View:
   - Agent status (online/offline)
   - Active tasks
   - Task history

---

## Configuration

### Config File Location

```
~/.backstage-agent/config.json
```

**Example:**
```json
{
  "backstageUrl": "http://localhost:7007",
  "agentId": "agent-abc123",
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "tokenExpiry": "2025-01-26T10:30:00Z"
}
```

### Task Directory

Tasks are stored in:
```
~/.backstage-agent/tasks/<task-id>/
```

Each task directory contains:
- `docker-compose.yml` - Generated compose file
- `task.json` - Task metadata

---

## Troubleshooting

### Issue: "Cannot connect to Backstage"

**Symptom:**
```
[ERROR] Failed to connect to Backstage: ECONNREFUSED
```

**Solution:**
- Verify Backstage backend is running: `curl http://localhost:7007/api/local-provisioner/health`
- Check the URL in config: `cat ~/.backstage-agent/config.json`
- Ensure network connectivity

---

### Issue: "Token expired"

**Symptom:**
```
[ERROR] Authentication failed: Token expired
```

**Solution:**
```bash
backstage-agent login --url http://localhost:7007
```

Tokens expire after 30 days and must be refreshed.

---

### Issue: "Docker not running"

**Symptom:**
```
[ERROR] Docker is not available. Please start Docker Desktop.
```

**Solution:**
- Start Docker Desktop
- Verify: `docker ps`
- Restart agent: `backstage-agent start`

---

### Issue: "Port already in use"

**Symptom:**
```
[ERROR] Task failed: bind: address already in use
```

**Solution:**
- Check what's using the port: `lsof -i :9092`
- Stop the conflicting service
- Or use a different port when creating the resource

---

### Issue: Containers not starting

**Symptom:**
Agent reports success but containers exit immediately

**Solution:**
```bash
# Check task directory
cd ~/.backstage-agent/tasks/<task-id>

# Check logs
docker-compose logs

# Verify docker-compose.yml
cat docker-compose.yml

# Try manual start
docker-compose up
```

---

## Advanced Usage

### Custom Backstage URL

```bash
backstage-agent login --url https://custom.backstage.url
```

### Debug Mode

Enable verbose logging:

```bash
LOG_LEVEL=debug backstage-agent start
```

### Graceful Shutdown

Stop the agent gracefully:

```
Press Ctrl+C
```

The agent will:
1. Stop accepting new tasks
2. Finish active task (if any)
3. Send final heartbeat
4. Close SSE connection
5. Exit

---

## Security Considerations

### Token Storage

- Tokens are stored in `~/.backstage-agent/config.json`
- File permissions: `600` (owner read/write only)
- Never commit this file to version control
- Tokens expire after 30 days

### Network Security

- Agent connects to Backstage backend only
- No inbound connections required
- Firewall-friendly (outbound-only)
- Uses HTTPS in production

### Docker Security

- Agent executes `docker-compose` commands
- Runs with your user permissions (no root required)
- Containers run in isolated Docker networks
- Volumes are created with appropriate permissions

---

## Uninstallation

### Remove Agent

```bash
# If installed via npm
npm uninstall -g @stratpoint/backstage-agent

# If installed via npm link
npm unlink -g backstage-agent
```

### Clean Up Files

```bash
# Remove configuration and task data
rm -rf ~/.backstage-agent

# Remove Docker containers (if any)
cd ~/.backstage-agent/tasks/<task-id>
docker-compose down -v
```

---

## Support

For issues or questions:

- **Backstage Issues**: File in `backstage-main-strat-eng` repository
- **Agent Bugs**: File in `backstage-main-strat-eng/packages/backstage-agent`
- **Training Questions**: Contact DevOps team

---

## Next Steps

- [Provision Kafka Instance](./kafka-provisioning.md) (Coming Soon)
- [Authentication Details](./AUTHENTICATION.md)
- [Architecture Overview](./architecture.md) (Coming Soon)

---

**Version**: 1.0.0
**Last Updated**: 2025-12-27
**Maintained By**: DevOps Team
