# Backstage Agent

[![npm version](https://img.shields.io/npm/v/@stratpoint/backstage-agent.svg)](https://www.npmjs.com/package/@stratpoint/backstage-agent)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org)

Local Provisioner Agent for Backstage - Provisions local development resources using Docker Compose.

## Overview

The Backstage Agent is a CLI tool that runs on a developer's machine to provision local development resources (Kafka, PostgreSQL, Redis, etc.) as requested from the Backstage portal. It connects to the Backstage backend via Server-Sent Events (SSE) to receive provisioning tasks in real-time.

## Features

- Google OAuth authentication (reuses Backstage credentials)
- Real-time task reception via SSE
- Docker Compose-based resource provisioning
- Support for multiple resource types (Kafka, PostgreSQL, Redis, MongoDB)
- Automatic reconnection with exponential backoff
- Graceful shutdown handling
- Comprehensive logging

## Prerequisites

- **Node.js**: 18.x or higher
- **Docker**: Installed and running
- **Docker Compose**: Installed
- **Backstage Instance**: Running with Local Provisioner plugin

## Installation

### Global Installation (Recommended)

Install the agent globally using npm:

```bash
npm install -g @stratpoint/backstage-agent
```

Or using yarn:

```bash
yarn global add @stratpoint/backstage-agent
```

### Verify Installation

```bash
backstage-agent --version
backstage-agent --help
```

### From Source (Development)

If you're developing the agent or want to install from the monorepo:

```bash
# Clone the repository
git clone https://github.com/stratpoint-engineering/backstage-main-strat-eng.git
cd backstage-main-strat-eng/packages/backstage-agent

# Install dependencies
yarn install

# Build the package
yarn build

# Link for local testing
npm link
```

## Configuration

The agent stores configuration in `~/.backstage-agent/config.json`:

```json
{
  "backstageUrl": "http://localhost:7007",
  "agentId": "abc-123-xyz",
  "serviceToken": "eyJ...",
  "expiresAt": 1735228800000
}
```

Task data and Docker Compose files are stored in `~/.backstage-agent/tasks/{taskId}/`.

## Usage

### Login

Authenticate with your Backstage instance using Google OAuth:

```bash
backstage-agent login --url http://localhost:7007
```

This will:
1. Open your browser for Google OAuth
2. Authenticate with Backstage backend
3. Save authentication tokens locally
4. Register your agent with Backstage

**Example output:**

```
2024-12-26 10:00:00 - info: Starting authentication flow...
2024-12-26 10:00:00 - info: Backstage URL: http://localhost:7007
2024-12-26 10:00:01 - info: Opening browser for Google OAuth...
2024-12-26 10:00:01 - info: Please sign in with your Stratpoint Google account
2024-12-26 10:00:10 - info: Exchanging token with Backstage backend...
2024-12-26 10:00:11 - info: Registering agent with Backstage...

=================================================
  Authentication successful!
=================================================
Agent ID: abc-123-xyz
Token expires: 12/27/2024, 10:00:00 AM

Next steps:
  1. Run "backstage-agent start" to start the agent
  2. Create provisioning tasks from Backstage UI
```

### Start Agent

Start the agent to listen for provisioning tasks:

```bash
backstage-agent start
```

This will:
1. Load authentication tokens
2. Check Docker availability
3. Connect to Backstage via SSE
4. Wait for provisioning tasks
5. Execute tasks and report status

**Example output:**

```
2024-12-26 10:05:00 - info: Loading agent configuration...
2024-12-26 10:05:00 - info: Configuration loaded successfully
2024-12-26 10:05:00 - info: Agent ID: abc-123-xyz
2024-12-26 10:05:00 - info: Backstage URL: http://localhost:7007
2024-12-26 10:05:00 - info: Starting Backstage Agent abc-123-xyz
2024-12-26 10:05:01 - info: Connecting to SSE endpoint: http://localhost:7007/api/local-provisioner/agent/events/abc-123-xyz
2024-12-26 10:05:02 - info: SSE connection established
2024-12-26 10:05:02 - info: Agent started successfully. Waiting for tasks...
```

### Stop Agent

Press `Ctrl+C` to gracefully stop the agent:

```
^C
2024-12-26 10:10:00 - info: Received SIGINT signal. Shutting down gracefully...
2024-12-26 10:10:00 - info: Stopping agent...
2024-12-26 10:10:01 - info: SSE connection closed
2024-12-26 10:10:01 - info: Agent stopped
```

## Task Execution Flow

1. **Task Received**: Agent receives task via SSE
   ```
   2024-12-26 10:06:00 - info: Received task: task-123 (provision-kafka)
   2024-12-26 10:06:00 - info: Processing task task-123
   ```

2. **Status Update**: Agent updates task status to `in-progress`

3. **Docker Compose Generation**: Agent generates `docker-compose.yml` from template
   ```
   2024-12-26 10:06:01 - info: Docker Compose file written to: /Users/developer/.backstage-agent/tasks/task-123/docker-compose.yml
   ```

4. **Resource Provisioning**: Agent executes `docker-compose up -d`
   ```
   2024-12-26 10:06:02 - info: Starting Docker Compose for resource: my-kafka
   2024-12-26 10:06:10 - info: All 2 containers are running
   ```

5. **Completion**: Agent reports success or failure
   ```
   2024-12-26 10:06:11 - info: Task task-123 completed successfully
   ```

## Supported Resources

### Kafka

Provisions Kafka + Zookeeper with Confluent Platform.

**Default Configuration**:
- Kafka version: 7.5.0
- Port: 9092
- Zookeeper port: 2181

**Template**: `templates/kafka/docker-compose.yml`

**Example Task Config**:
```json
{
  "resourceName": "my-kafka",
  "kafkaVersion": "7.5.0",
  "port": 9092
}
```

### PostgreSQL (Coming Soon)

Provisions PostgreSQL database.

### Redis (Coming Soon)

Provisions Redis cache.

### MongoDB (Coming Soon)

Provisions MongoDB database.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Backstage Backend                    │
│  ┌───────────────────────────────────────────────────┐  │
│  │       Local Provisioner Backend Plugin            │  │
│  │  - Task Queue Management (PostgreSQL)             │  │
│  │  - Agent Registration & Authentication            │  │
│  │  - SSE Endpoint (/agent/events/:agentId)          │  │
│  │  - Task Status API                                │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                          │
                          │ SSE (Server-Sent Events)
                          │ HTTPS + Bearer Token
                          ▼
┌─────────────────────────────────────────────────────────┐
│              Developer's Local Machine                  │
│                                                         │
│  ┌───────────────────────────────────────────────────┐ │
│  │           Backstage Agent CLI                     │ │
│  │                                                   │ │
│  │  Components:                                      │ │
│  │  ┌─────────────────────────────────────────────┐ │ │
│  │  │  GoogleAuthClient                           │ │ │
│  │  │  - OAuth flow                               │ │ │
│  │  │  - Token exchange                           │ │ │
│  │  └─────────────────────────────────────────────┘ │ │
│  │  ┌─────────────────────────────────────────────┐ │ │
│  │  │  SSEClient                                  │ │ │
│  │  │  - Real-time task reception                │ │ │
│  │  │  - Auto-reconnection                       │ │ │
│  │  └─────────────────────────────────────────────┘ │ │
│  │  ┌─────────────────────────────────────────────┐ │ │
│  │  │  DockerComposeExecutor                     │ │ │
│  │  │  - Template rendering (Mustache)           │ │ │
│  │  │  - Docker Compose execution                │ │ │
│  │  │  - Container validation                    │ │ │
│  │  └─────────────────────────────────────────────┘ │ │
│  │  ┌─────────────────────────────────────────────┐ │ │
│  │  │  Agent Core                                │ │ │
│  │  │  - Task coordination                       │ │ │
│  │  │  - Status reporting                        │ │ │
│  │  │  - Heartbeat (30s interval)                │ │ │
│  │  └─────────────────────────────────────────────┘ │ │
│  └───────────────────────────────────────────────────┘ │
│                          │                             │
│                          ▼                             │
│  ┌───────────────────────────────────────────────────┐ │
│  │              Docker Engine                        │ │
│  │  - Kafka + Zookeeper containers                  │ │
│  │  - PostgreSQL containers                         │ │
│  │  - Redis containers                              │ │
│  └───────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

## File Structure

```
packages/backstage-agent/
├── bin/
│   └── backstage-agent.js        # CLI entry point (executable)
├── src/
│   ├── agent/
│   │   ├── Agent.ts              # Main agent coordinator
│   │   └── SSEClient.ts          # SSE client with reconnection
│   ├── auth/
│   │   ├── GoogleAuthClient.ts   # OAuth flow handler
│   │   └── TokenManager.ts       # Token storage
│   ├── commands/
│   │   ├── login.ts              # Login command
│   │   └── start.ts              # Start command
│   ├── config/
│   │   └── ConfigManager.ts      # Config file management
│   ├── executor/
│   │   └── DockerComposeExecutor.ts # Docker execution
│   ├── utils/
│   │   └── logger.ts             # Winston logger
│   ├── cli.ts                    # CLI setup
│   ├── index.ts                  # Main exports
│   └── types.ts                  # TypeScript types
├── templates/
│   └── kafka/
│       └── docker-compose.yml    # Kafka template
├── package.json
├── tsconfig.json
└── README.md
```

## Environment Variables

The agent supports these environment variables:

- `LOG_LEVEL`: Logging level (default: `info`)
  - Options: `error`, `warn`, `info`, `debug`
  - Example: `LOG_LEVEL=debug backstage-agent start`

## Troubleshooting

### Authentication Issues

**Problem**: "No configuration found"

**Solution**: Run `backstage-agent login --url <backstage-url>` first

---

**Problem**: "Authentication token has expired"

**Solution**: Run `backstage-agent login --url <backstage-url>` again

---

**Problem**: Browser doesn't open

**Solution**: Copy the URL from the terminal and open it manually

---

### Docker Issues

**Problem**: "Docker is not available or not running"

**Solution**:
1. Install Docker Desktop
2. Start Docker Desktop
3. Verify with `docker ps`

---

**Problem**: "Docker containers failed to start"

**Solution**:
1. Check Docker logs: `docker-compose logs` in task directory
2. Ensure ports are not already in use
3. Check Docker resources (CPU, memory)

---

### Connection Issues

**Problem**: "SSE connection error"

**Solution**:
1. Verify Backstage backend is running
2. Check network connectivity
3. Verify authentication token is valid
4. Check firewall settings

---

**Problem**: Agent disconnects frequently

**Solution**:
- Agent auto-reconnects with exponential backoff
- If persistent, check network stability
- Review backend logs for issues

---

### Task Execution Issues

**Problem**: Task stays in `in-progress` status

**Solution**:
1. Check agent logs for errors
2. Verify Docker Compose execution succeeded
3. Check backend API is accessible

---

## Development

### Building

```bash
yarn build
```

### Development Mode

```bash
yarn dev  # Watch mode
```

### Testing Locally

```bash
# Build
yarn build

# Link globally
npm link

# Test commands
backstage-agent login --url http://localhost:7007
backstage-agent start
```

### Adding New Resource Templates

1. Create directory: `templates/{resource-name}/`
2. Add `docker-compose.yml` with Mustache variables:
   ```yaml
   version: '3.8'
   services:
     {{resourceName}}:
       image: ...
       ports:
         - "{{port}}:{{port}}"
   ```
3. Update `DockerComposeExecutor.getTemplateForTaskType()` mapping
4. Update backend task types

## Security Considerations

- Tokens stored in `~/.backstage-agent/config.json` (user-only access)
- HTTPS recommended for production
- Service tokens expire (configurable in backend)
- Google OAuth domain restriction (`@stratpoint.com`)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes with tests
4. Submit pull request

## License

Apache-2.0

## Support

For issues or questions:
- File GitHub issue
- Contact DevOps team
- Check Backstage documentation

---

**Version**: 0.1.0
**Last Updated**: 2024-12-26
