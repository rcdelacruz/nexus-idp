# Local Provisioning System - Quick Start Guide

**For**: Development team starting implementation
**When**: Before starting Phase 1
**Read**: Full implementation plan at `LOCAL_PROVISIONING_IMPLEMENTATION_PLAN.md`

---

## Overview

This quick-start guide provides the essential commands and steps to begin implementing the Local Provisioning System for Backstage.

---

## Pre-Implementation Checklist

Before starting implementation, ensure:

- [ ] Full implementation plan reviewed and approved
- [ ] Team assigned to phases
- [ ] Development environment set up (PostgreSQL, Docker)
- [ ] GitHub repository access confirmed
- [ ] npm organization access configured (@stratpoint)
- [ ] This plan reviewed with stakeholders

---

## Phase 1: Backend Plugin (Week 1-2)

### Step 1: Create Backend Plugin Package

```bash
# From repository root
cd /Users/ronalddelacruz/Projects/stratpoint/backstage-main-strat-eng

# Create plugin using Backstage CLI
yarn new --select backend-plugin

# When prompted:
# - Plugin ID: local-provisioner-backend
# - Owner: @stratpoint
```

### Step 2: Set Up Database Schema

```bash
# Create migration directory
mkdir -p plugins/local-provisioner-backend/src/database/migrations

# Create migration file (see implementation plan for SQL schema)
touch plugins/local-provisioner-backend/src/database/migrations/001-create-provisioning-tasks.ts
```

**Copy schema from implementation plan section 1.2**

### Step 3: Implement Core Services

```bash
# Create service directory structure
mkdir -p plugins/local-provisioner-backend/src/service
mkdir -p plugins/local-provisioner-backend/src/api
mkdir -p plugins/local-provisioner-backend/src/database

# Create files (templates in implementation plan)
touch plugins/local-provisioner-backend/src/service/TaskQueueService.ts
touch plugins/local-provisioner-backend/src/service/AgentService.ts
touch plugins/local-provisioner-backend/src/service/CatalogService.ts
touch plugins/local-provisioner-backend/src/api/agentRoutes.ts
touch plugins/local-provisioner-backend/src/api/taskRoutes.ts
touch plugins/local-provisioner-backend/src/database/TaskStore.ts
touch plugins/local-provisioner-backend/src/permissions.ts
touch plugins/local-provisioner-backend/src/types.ts
```

### Step 4: Register Plugin in Backend

**Edit**: `packages/backend/src/index.ts`

```typescript
// Add after sonarqube plugin (line 59)
backend.add(import('../../plugins/local-provisioner-backend'));
```

### Step 5: Update Permission Policy

**Edit**: `packages/backend/src/plugins/permission.ts`

Add local provisioning permissions (see implementation plan section 1.4)

### Step 6: Test Backend Plugin

```bash
# Start backend
yarn workspace backend start

# Test API endpoints
curl http://localhost:7007/api/local-provisioner/health
```

---

## Phase 2: Frontend Plugin (Week 3-4)

### Step 1: Create Frontend Plugin Package

```bash
# Create plugin using Backstage CLI
yarn new --select plugin

# When prompted:
# - Plugin ID: local-provisioner
# - Owner: @internal
```

### Step 2: Implement UI Components

```bash
# Create component directory structure
mkdir -p plugins/local-provisioner/src/components/LocalProvisionerPage
mkdir -p plugins/local-provisioner/src/components/TaskDetails
mkdir -p plugins/local-provisioner/src/components/AgentStatus
mkdir -p plugins/local-provisioner/src/api
mkdir -p plugins/local-provisioner/src/hooks

# Create files (templates in implementation plan)
touch plugins/local-provisioner/src/api/LocalProvisionerClient.ts
touch plugins/local-provisioner/src/components/LocalProvisionerPage/LocalProvisionerPage.tsx
touch plugins/local-provisioner/src/components/LocalProvisionerPage/TasksList.tsx
touch plugins/local-provisioner/src/hooks/useProvisioningTasks.ts
```

### Step 3: Add Route to App

**Edit**: `packages/app/src/App.tsx`

```typescript
// Add import
import { LocalProvisionerPage } from '@internal/plugin-local-provisioner';

// Add route
<Route path="/local-provisioner" element={<LocalProvisionerPage />} />
```

### Step 4: Update Homepage

**Edit**: `packages/app/src/components/home/HomePage.tsx`

Add "Training & Local Development" section (see implementation plan section 2.5)

### Step 5: Add Navigation Menu Item

**Edit**: `packages/app/src/components/Root/Root.tsx`

```typescript
// Add import
import StorageIcon from '@material-ui/icons/Storage';

// Add menu item
<SidebarItem icon={StorageIcon} to="local-provisioner" text="Local Provisioner" />
```

### Step 6: Test Frontend Plugin

```bash
# Start development server
yarn dev

# Navigate to http://localhost:3000/local-provisioner
# Verify homepage "Training" section visible
```

---

## Phase 3: Agent Package (Week 5-7)

### Step 1: Create Agent Repository

```bash
# Option A: Separate repository (recommended)
mkdir backstage-agent
cd backstage-agent
npm init -y

# Update package.json
# - name: "@stratpoint/backstage-agent"
# - bin: { "backstage-agent": "./bin/backstage-agent.js" }

# Option B: Monorepo package
cd /Users/ronalddelacruz/Projects/stratpoint/backstage-main-strat-eng
mkdir packages/backstage-agent
```

### Step 2: Implement CLI Commands

```bash
# Create directory structure
mkdir -p src/cli/commands
mkdir -p src/auth
mkdir -p src/agent
mkdir -p src/executor
mkdir -p bin

# Create files (templates in implementation plan)
touch src/cli/commands/login.ts
touch src/cli/commands/start.ts
touch src/cli/commands/stop.ts
touch src/auth/GoogleAuthClient.ts
touch src/agent/Agent.ts
touch src/agent/SSEClient.ts
touch src/executor/DockerComposeExecutor.ts
touch bin/backstage-agent.js
```

### Step 3: Install Dependencies

```bash
npm install commander eventsource open winston
npm install --save-dev typescript @types/node
```

### Step 4: Build and Test Locally

```bash
# Build TypeScript
npm run build

# Link globally for testing
npm link

# Test commands
backstage-agent --help
backstage-agent login --url http://localhost:7007
```

---

## Phase 4: Scaffolder Template (Week 8)

### Step 1: Create Template in Engineering Standards Repo

```bash
# Clone engineering-standards repository
cd ~/Projects
git clone https://github.com/stratpoint-engineering/engineering-standards.git
cd engineering-standards

# Create template directory
mkdir -p templates/training/kafka-local
cd templates/training/kafka-local

# Create files
touch template.yaml
touch README.md
mkdir skeleton
touch skeleton/docker-compose.yml
```

### Step 2: Implement Template

Copy template YAML from implementation plan section 4.3

### Step 3: Create Custom Scaffolder Action

**Edit**: `packages/backend/src/plugins/scaffolder/actions/localProvision.ts`

Implement `stratpoint:local-provision` action (see implementation plan section 4.4)

### Step 4: Register Template in Backstage

**Edit**: `app-config.local.yaml`

```yaml
catalog:
  locations:
    - type: url
      target: https://github.com/stratpoint-engineering/engineering-standards/blob/main/templates/training/kafka-local/template.yaml
      rules:
        - allow: [Template]
```

### Step 5: Test Template

```bash
# Restart Backstage
yarn dev

# Navigate to http://localhost:3000/create
# Find "Provision Kafka Instance Locally" template
# Test template execution
```

---

## Phase 5: Testing & Documentation (Week 9)

### Step 1: End-to-End Test

**Manual Test Flow**:

1. Start agent: `backstage-agent start`
2. Open Backstage: http://localhost:3000
3. Navigate to `/create`
4. Select "Provision Kafka Instance Locally"
5. Fill in parameters
6. Click "Create"
7. Verify task appears in agent logs
8. Verify Kafka containers start
9. Verify catalog entity created
10. Navigate to `/local-provisioner` and verify task status

### Step 2: Write TechDocs

```bash
cd docs
touch local-provisioner-setup.md
touch training-templates.md
```

### Step 3: Create Agent Documentation

```bash
cd backstage-agent
# Update README.md with:
# - Installation instructions
# - Authentication guide
# - Command reference
# - Troubleshooting
```

---

## Pilot Rollout (Week 10)

### Step 1: Select Pilot Users

- Choose 10 developers from different teams
- Ensure they have Docker installed
- Provide setup instructions

### Step 2: Deploy to Staging

```bash
# Deploy backend plugin to staging environment
# Publish agent package to npm (private registry)
# Update production config
```

### Step 3: Gather Feedback

- Create feedback form
- Monitor logs and metrics
- Document issues
- Iterate on improvements

---

## Useful Commands During Development

### Backend Development

```bash
# Start backend only
yarn start-backend

# View backend logs
yarn workspace backend start --log-level debug

# Test API endpoint
curl -H "Authorization: Bearer <token>" http://localhost:7007/api/local-provisioner/tasks
```

### Frontend Development

```bash
# Start frontend only
yarn start

# Build plugin
yarn workspace @internal/plugin-local-provisioner build

# Test plugin in isolation
yarn workspace @internal/plugin-local-provisioner start
```

### Database Management

```bash
# Connect to PostgreSQL
psql -h localhost -U backstage -d backstage

# View tasks
SELECT * FROM provisioning_tasks ORDER BY created_at DESC LIMIT 10;

# View agents
SELECT * FROM agent_registrations ORDER BY last_seen DESC;

# Clear test data
TRUNCATE provisioning_tasks CASCADE;
```

### Agent Development

```bash
# Build agent
cd backstage-agent
npm run build

# Test locally
npm link
backstage-agent --help

# Publish to npm (when ready)
npm publish --access restricted
```

---

## Troubleshooting Common Issues

### Issue: Plugin not loading in backend

**Solution**:
```bash
# Check backend logs for errors
yarn workspace backend start --log-level debug

# Verify plugin export in packages/backend/src/index.ts
# Ensure migration ran successfully
```

### Issue: SSE connection failing

**Solution**:
```bash
# Check CORS settings in app-config.yaml
# Verify authentication token is valid
# Check firewall/proxy settings
```

### Issue: Docker Compose execution failing

**Solution**:
```bash
# Verify Docker is running
docker ps

# Check Docker Compose version
docker-compose version

# Test manually
docker-compose up -d
```

### Issue: Catalog entity not created

**Solution**:
```bash
# Check catalog logs
# Verify CatalogService integration
# Check entity YAML format
# Manually register entity via Backstage UI
```

---

## Key Files Reference

**Backend Plugin**:
- Plugin registration: `plugins/local-provisioner-backend/src/plugin.ts`
- Task queue: `plugins/local-provisioner-backend/src/service/TaskQueueService.ts`
- Agent API: `plugins/local-provisioner-backend/src/api/agentRoutes.ts`
- Database schema: `plugins/local-provisioner-backend/src/database/migrations/001-create-provisioning-tasks.ts`

**Frontend Plugin**:
- Plugin definition: `plugins/local-provisioner/src/plugin.ts`
- Main page: `plugins/local-provisioner/src/components/LocalProvisionerPage/LocalProvisionerPage.tsx`
- API client: `plugins/local-provisioner/src/api/LocalProvisionerClient.ts`

**Agent Package**:
- CLI entry: `backstage-agent/bin/backstage-agent.js`
- Main agent: `backstage-agent/src/agent/Agent.ts`
- SSE client: `backstage-agent/src/agent/SSEClient.ts`
- Docker executor: `backstage-agent/src/executor/DockerComposeExecutor.ts`

**Templates**:
- Kafka template: `engineering-standards/templates/training/kafka-local/template.yaml`

**Configuration**:
- App config: `app-config.yaml` (add `localProvisioner` section)
- Permission policy: `packages/backend/src/plugins/permission.ts`

---

## Next Steps After Quick Start

1. Review full implementation plan: `LOCAL_PROVISIONING_IMPLEMENTATION_PLAN.md`
2. Set up GitHub issues for tracking
3. Schedule daily standups during implementation
4. Prepare test environments
5. Communicate with pilot users

---

**For detailed implementation guidance, always refer to `LOCAL_PROVISIONING_IMPLEMENTATION_PLAN.md`**
