# @stratpoint/plugin-local-provisioner-backend

Backend plugin for the Backstage Local Provisioning System.

## Overview

This plugin enables self-service provisioning of local development resources (Kafka, databases, etc.) from the cloud-hosted Backstage instance to developer machines using a pull-based agent architecture.

## Features

- **Task Queue Management**: PostgreSQL-based queue for provisioning tasks
- **Agent API**: RESTful endpoints for agent registration and authentication
- **Server-Sent Events (SSE)**: Real-time task delivery to local agents
- **Catalog Integration**: Auto-registers provisioned resources in Software Catalog
- **Permission Control**: RBAC-based access control for provisioning operations

## Installation

This plugin is installed as part of the Backstage backend.

```bash
# From the root of your Backstage repository
yarn add @stratpoint/plugin-local-provisioner-backend
```

## Configuration

Add the following to your `app-config.yaml`:

```yaml
localProvisioner:
  enabled: true
  sseHeartbeatInterval: 30  # seconds
  taskRetentionDays: 30
  supportedResources:
    - kafka
    - postgres
    - redis
    - mongodb
  agent:
    minimumVersion: '1.0.0'
```

## Setup

### 1. Register the Plugin

In `packages/backend/src/index.ts`:

```typescript
backend.add(import('@stratpoint/plugin-local-provisioner-backend'));
```

### 2. Database Migrations

The plugin automatically creates the required database tables:
- `provisioning_tasks`: Stores provisioning task queue
- `agent_registrations`: Tracks registered agents

### 3. Permissions

Extend your permission policy to include local provisioning permissions:

```typescript
import { localProvisionerPermissions } from '@stratpoint/plugin-local-provisioner-backend';
```

## API Endpoints

### Agent Endpoints

- `POST /api/local-provisioner/agent/auth` - Authenticate agent with Google OAuth token
- `POST /api/local-provisioner/agent/register` - Register new agent
- `GET /api/local-provisioner/agent/events/:agentId` - SSE stream for task delivery
- `PUT /api/local-provisioner/agent/tasks/:taskId/status` - Update task status

### Task Endpoints

- `GET /api/local-provisioner/tasks` - List user's provisioning tasks
- `GET /api/local-provisioner/tasks/:taskId` - Get task details
- `POST /api/local-provisioner/tasks` - Create new provisioning task
- `DELETE /api/local-provisioner/tasks/:taskId` - Delete task

### Health Endpoint

- `GET /api/local-provisioner/health` - Plugin health check

## Development

```bash
# Start in development mode
yarn start

# Build the plugin
yarn build

# Run tests
yarn test

# Run linter
yarn lint
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Backstage Backend                                      │
│  ┌───────────────────────────────────────────────────┐ │
│  │ Local Provisioner Plugin                          │ │
│  │  ├─ Task Queue Service (PostgreSQL)               │ │
│  │  ├─ Agent Service (SSE, Auth, Registration)       │ │
│  │  ├─ Catalog Service (Entity Registration)         │ │
│  │  └─ API Routes (Express)                          │ │
│  └───────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
                    ↕ HTTPS REST API + SSE
┌─────────────────────────────────────────────────────────┐
│  Developer Machine                                      │
│  └─ Backstage Agent (npm package)                      │
│     └─ Docker Compose Executor                         │
└─────────────────────────────────────────────────────────┘
```

## License

Apache-2.0
