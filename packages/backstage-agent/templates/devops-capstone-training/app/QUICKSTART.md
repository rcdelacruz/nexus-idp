# Quick Start Guide

This guide helps you get started with the task management application you'll be working with.

## The Application

You'll be working with a simple task management application:
- Frontend: React web interface
- Backend: Node.js API
- Database: PostgreSQL

## Try It Out

### Option A: One-click via the Local Provisioner (recommended)

If your team's Backstage portal has the Local Provisioner module enabled, you don't need to run
Docker Compose by hand — provision this app directly from the portal (**Create** > search
"DevOps Capstone" or "DevSecOps Capstone" depending on which phase you're on). See
[`local-provisioning/`](../local-provisioning/index.md) for the full walkthrough.

### Option B: Manual Docker Compose

1. Start everything:
```bash
docker compose up
```

2. Open in your browser:
   - Web App: http://localhost:3000 (React dev server)
   - API: http://localhost:3001

3. Test basic features:
   - Create a task
   - Update its status
   - Delete a task

## Project Files

```
app/
├── frontend/          # React web interface
│   ├── src/          # React components
│   └── Dockerfile    # Frontend container
├── backend/          # Node.js API
│   ├── src/          # API endpoints
│   └── Dockerfile    # Backend container
└── database/         # PostgreSQL
    └── init.sql      # Database schema
```

## Development

### Prerequisites
- Docker and docker compose
- Node.js 16+ (optional, for local development)
- PostgreSQL 13+ (optional, for local development)

### Environment Setup
1. Frontend (.env):
```
REACT_APP_API_URL=http://localhost:3001/api
```

2. Backend (.env):
```
NODE_ENV=development
PORT=3000
DB_HOST=postgres
DB_PORT=5432
DB_NAME=taskdb
DB_USER=postgres
DB_PASSWORD=postgres
```

## API Endpoints

### GET /api/tasks
Get all tasks
```json
[
  {
    "id": "123",
    "title": "Example task",
    "status": "TODO"
  }
]
```

### POST /api/tasks
Create a task
```json
{
  "title": "New task",
  "description": "Task details"
}
```

### PUT /api/tasks/:id
Update a task
```json
{
  "status": "IN_PROGRESS"
}
```

### DELETE /api/tasks/:id
Delete a task

## Next Steps

Your task is to:
1. Set up local Kubernetes
2. Create Helm charts
3. Configure CI/CD pipeline
4. Implement GitOps with ArgoCD

Remember:
- The application code is complete
- Focus on DevOps implementation
- Ask questions in lab sessions
- Keep it simple!
