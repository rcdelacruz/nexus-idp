# Backstage IDP — AWS ECS Fargate Infrastructure

OpenTofu-managed infrastructure for `portal.stratpoint.io`.

## Overview

| Resource | Details |
|----------|---------|
| **URL** | https://portal.stratpoint.io (via Cloudflare Tunnel) |
| **AWS Account** | 746540123485 (nonprod), profile: `cost-admin-nonprod` |
| **Region** | `us-west-2` |
| **State Backend** | S3 `stratpoint-tofu-state-prod` + DynamoDB lock |
| **Estimated Cost** | ~$90-95/month base |
| **Credits** | APFP_SANDBOX_03_02_2026 ($4,200, expires 2026-09-30) |

## Architecture

### 4-Container ECS Task

```
create-db (init)       postgres:18
    ↓ SUCCESS
db-migrations (init)   backstage image  — runs Knex migrations for local-provisioner-backend
    ↓ SUCCESS
backstage (main)       backstage image  — Node.js app on :7007
    ↓ HEALTHY
cloudflared (sidecar)  cloudflare/cloudflared:2025.4.0  — tunnel to portal.stratpoint.io
```

### Infrastructure Components

| Component | Size | Purpose |
|-----------|------|---------|
| ECS Fargate | 1 vCPU / 2GB | Backstage app |
| RDS PostgreSQL 13.20 | db.t4g.small | Primary database |
| ElastiCache Redis 7.1 | cache.t4g.small | Cache + session store |
| ECR | — | Docker image registry |
| Secrets Manager | 16 secrets | All sensitive config |
| CloudWatch | — | Container logs |

### Networking

- **VPC:** `10.100.0.0/16`
- **ECS tasks:** public subnets (`10.100.0.0/24`, `10.100.1.0/24`) with `assignPublicIp=true`
- **RDS + Redis:** private subnets (`10.100.10.0/24`, `10.100.11.0/24`)
- **No NAT Gateway** — cloudflared makes outbound-only connections via public IP

### Cloudflare Tunnels

| Tunnel | Account | Routes |
|--------|---------|--------|
| `backstage-aws-prod` (ID: a6f27602) | stratpoint.io | `portal.stratpoint.io` → `localhost:7007` |
| `argocd-k8s` | coderstudio.co | `argocd.coderstudio.co` → homelab ArgoCD |

## Deploy Workflow

> **Never configure manually — always use `tofu apply`.**

```bash
cd infra/

# 1. Build & push image
docker build -t 746540123485.dkr.ecr.us-west-2.amazonaws.com/backstage-idp-prod:latest \
  -f packages/backend/Dockerfile .

aws ecr get-login-password --region us-west-2 --profile cost-admin-nonprod \
  | docker login --username AWS --password-stdin \
    746540123485.dkr.ecr.us-west-2.amazonaws.com

docker push 746540123485.dkr.ecr.us-west-2.amazonaws.com/backstage-idp-prod:latest

# 2. Apply — force_new_deployment=true triggers redeployment automatically
AWS_PROFILE=cost-admin-nonprod tofu apply -auto-approve
```

## First-Time Setup

```bash
# Bootstrap S3 state backend (only needed once)
./scripts/bootstrap-state.sh

# Initialize OpenTofu
AWS_PROFILE=cost-admin-nonprod tofu init

# Copy and fill in secrets
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with actual values — never commit this file
```

## File Reference

| File | Purpose |
|------|---------|
| `networking.tf` | VPC, subnets, IGW, route tables |
| `security_groups.tf` | SGs for ECS, RDS, Redis |
| `rds.tf` | PostgreSQL RDS instance + subnet group |
| `elasticache.tf` | Redis ElastiCache cluster + subnet group |
| `ecr.tf` | ECR repository |
| `ecs.tf` | ECS cluster, task definition, service |
| `iam.tf` | ECS execution + task IAM roles |
| `secrets.tf` | Secrets Manager secrets + versions |
| `cloudwatch.tf` | CloudWatch log group |
| `locals.tf` | Name prefix + common tags |
| `variables.tf` | All input variables |
| `outputs.tf` | ECR URL, RDS endpoint, Redis endpoint |
| `providers.tf` | AWS + Cloudflare providers with default tags |
| `versions.tf` | OpenTofu + provider version constraints |
| `terraform.tfvars` | Secret values — **gitignored, never commit** |
| `terraform.tfvars.example` | Template for tfvars — safe to commit |
| `scripts/bootstrap-state.sh` | Creates S3 + DynamoDB state backend |

## Tagging

All resources are tagged with:

```hcl
Project       = "backstage-idp"
Environment   = "production"
Owner         = "stratpoint-platform"
ManagedBy     = "opentofu"
CreditProgram = "APFP_SANDBOX_03_02_2026"
CostCenter    = "platform-engineering"
Repository    = "stratpoint-engineering/backstage-main"
```

> **Important:** Scaffolded test services must also include `Project=backstage-idp` so they are tracked by the AWS Budget alert. The budget filter is `Project=backstage-idp` — untagged resources will not be counted.

## Budget Alert

| Threshold | Action |
|-----------|--------|
| $300/month | Early warning — scaffolded resources accumulating |
| $500/month | Review & destroy unused test resources |
| $800/month | Hard stop — something is out of control |

Alerts sent to: `ronaldo.delacruz@stratpoint.com`

## Critical Lessons (Do Not Repeat)

1. **k8s → ECS mapping:** k8s `command` = ECS `entryPoint`, k8s `args` = ECS `command`
2. **Shell quoting:** `$VAR` inside single quotes is NOT expanded — use double quotes
3. **No curl in image:** `node:20-bookworm-slim` has no curl — use Node.js for health checks
4. **dependsOn:** Always `condition = "SUCCESS"`, never `"COMPLETE"`
5. **Secrets after destroy:** 7-day recovery window — force-delete before re-applying
6. **ElastiCache snapshotting:** Wait for `available` state before `tofu apply`
