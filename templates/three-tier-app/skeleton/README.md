# ${{ values.appName | title }}

${{ values.description }}

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│    Frontend      │────▶│    Backend API   │────▶│   PostgreSQL    │
│  React + Vite    │     │  Express + TS    │     │   CNPG Cluster  │
│  Port ${{ values.frontendPort }}       │     │  Port ${{ values.backendPort }}       │     │   Port 5432     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                        │
        └────── Traefik Ingress ─┘
                     │
              ArgoCD GitOps
```

## Quick Start (Local Development)

```bash
# Start PostgreSQL
docker run -d --name ${{ values.appName }}-db \
  -e POSTGRES_DB=${{ values.dbName }} \
  -e POSTGRES_USER=${{ values.appName }} \
  -e POSTGRES_PASSWORD=password \
  -p 5432:5432 postgres:16

# Backend
cd backend
cp ../.env.example .env
npm install
npm run migrate
npm run dev

# Frontend (new terminal)
cd frontend
npm install
npm run dev
```

Open http://localhost:${{ values.frontendPort }}

## Project Structure

```
├── frontend/              # React + Vite + TypeScript
│   ├── src/
│   │   ├── App.tsx        # Main application
│   │   ├── main.tsx       # Entry point
│   │   └── styles.css     # Global styles (dark/light mode)
│   ├── Dockerfile         # Multi-stage build → nginx
│   └── nginx.conf         # SPA routing + API proxy
├── backend/               # Express + TypeScript
│   ├── src/
│   │   ├── index.ts       # Server entry
│   │   ├── routes/        # API routes (health, items)
│   │   ├── middleware/     # Error handler, logger
│   │   └── db/            # Knex connection + config
│   ├── migrations/        # Database migrations
│   └── Dockerfile         # Multi-stage build → Node.js
├── k8s/
│   ├── base/              # Kustomize base manifests
│   │   ├── frontend/      # Deployment, Service, Ingress
│   │   ├── backend/       # Deployment (+ init migrate), Service, Ingress
│   │   └── database/      # CNPG Cluster + PgBouncer Pooler
│   ├── overlays/
│   │   ├── dev/           # 1 replica, 1 DB instance, 1Gi storage
│   │   ├── staging/       # 2 replicas, 2 DB instances, 5Gi storage
│   │   └── prod/          # 3 replicas, 3 DB instances, 25Gi storage
│   └── argocd-application.yaml
├── .github/workflows/
│   └── ci.yaml            # Lint, test, build, push to GHCR
├── catalog-info.yaml      # Backstage catalog entities
└── .env.example
```

## Deployment

### First Deploy

```bash
# Register ArgoCD Application
kubectl apply -f k8s/argocd-application.yaml
```

ArgoCD syncs automatically on every push to `main`.

### Manual Sync

```bash
argocd app sync ${{ values.appName }}-${{ values.environment }}
```

### Environments

| Environment | Namespace | Frontend URL | API URL |
|-------------|-----------|-------------|---------|
| Dev | ${{ values.appName }}-dev | ${{ values.appName }}-dev.${{ values.ingressDomain }} | api.${{ values.appName }}-dev.${{ values.ingressDomain }} |
| Staging | ${{ values.appName }}-staging | ${{ values.appName }}-staging.${{ values.ingressDomain }} | api.${{ values.appName }}-staging.${{ values.ingressDomain }} |
| Prod | ${{ values.appName }}-prod | ${{ values.appName }}.${{ values.ingressDomain }} | api.${{ values.appName }}.${{ values.ingressDomain }} |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (includes DB status) |
| GET | `/ready` | Readiness probe |
| GET | `/live` | Liveness probe |
| GET | `/api/items` | List items (paginated, searchable) |
| GET | `/api/items/:id` | Get single item |
| POST | `/api/items` | Create item |
| PUT | `/api/items/:id` | Update item |
| DELETE | `/api/items/:id` | Delete item |

## Infrastructure

- **Kubernetes:** Talos Linux cluster
- **Ingress:** Traefik
- **Database:** CloudNativePG (CNPG) with Longhorn storage
- **Backups:** WAL archiving to MinIO (S3-compatible)
- **GitOps:** ArgoCD (auto-sync on push)
- **CI/CD:** GitHub Actions → GHCR
- **Monitoring:** CNPG PodMonitor (Prometheus)

## Owner

${{ values.owner }}
