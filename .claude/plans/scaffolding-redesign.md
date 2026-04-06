# Scaffolding Redesign Plan

**Created:** 2026-04-04
**Last Updated:** 2026-04-04
**Owner:** Ronald
**Status:** In Progress — redesign in progress, nothing committed yet
**Related plans:** `scaffolder-template-visibility.md`, `rbac-plan.md`

---

## Vision

A fully self-service IDP where:
- **Portal Admin** configures available infra in `app-config.yaml` once — no hardcoded values anywhere
- **DevOps/Admins** run infra templates to provision environments, service templates to generate deployment config for existing apps
- **Engineers** use `generic-service` or framework-specific templates (e.g. `nextjs-fullstack`) — pick framework + target, app is live, zero infra knowledge needed

All credentials and config fetched from env vars and `app-config.yaml` only. No hardcoding in templates or skeletons.

---

## 3-Layer Architecture

```
Layer 1: Portal Admin
└── app-config.yaml + env vars
    └── All credentials, endpoints, account IDs, cluster names
    └── Single source of truth — templates read from here

Layer 2: DevOps / Admins (engineering-standards repo)
├── Service templates — deployment config generators for existing apps
│   └── Read infra values from app-config (no user entry for infra details)
│   └── Pick existing service via EntityPicker → update catalog entity annotations
└── Infra templates — provision environments via OpenTofu
    └── EC2, EKS, ECS clusters, K8s namespaces, RDS, etc.
    └── Register provisioned resources as Resource entities in catalog

Layer 3: Engineers
└── generic-service or framework templates (nextjs-fullstack, etc.)
└── Pick framework + deployment target only
└── Infra pre-configured — zero infra knowledge required
└── GitHub repo + CI/CD + manifests + catalog registration → done
```

---

## Template Taxonomy

### Developer Templates (all engineers can run)

| Template | Description | Catalog Type |
|----------|-------------|--------------|
| `generic-service` | Framework + target chooser — guides engineer | Creates `Component` (type: service) |
| `nextjs-fullstack` | Opinionated Next.js full-stack app | Creates `Component` (type: service) |
| *(future)* `nodejs-api`, `nestjs-api`, `python-api` | Framework-specific templates | Creates `Component` (type: service) |

These templates:
- Generate framework boilerplate + deployment config
- Create a new GitHub repo
- Register a new `Component` entity in Backstage catalog

---

### Service Templates (DevOps/admin only — NOT standalone, require existing app)

| Template | Description | Owner |
|----------|-------------|-------|
| `service-k8s` | Generate K8s deployment config for existing app | `group:default/devops-team` |
| `service-ecs` | Generate ECS task definition + CI/CD for existing app | `group:default/devops-team` |
| `service-lambda` | Generate SAM template + CI/CD for existing app | `group:default/devops-team` |
| `service-app-runner` | Generate App Runner config + CI/CD for existing app | `group:default/devops-team` |

These templates:
- Use `EntityPicker` to select an **existing** service from catalog
- Pull repo URL, port, owner from the catalog entity — NOT re-entered by user
- Read all infra config from `app-config.yaml` (cluster names, ECR registry, account IDs, etc.)
- Generate deployment config files + CI/CD
- Create a **PR to the existing repo** adding those files
- Update `catalog-info.yaml` in the PR to add annotations (e.g. `backstage.io/kubernetes-id`)
- **NO `catalog:register` step** — entity already exists, annotation update triggers catalog refresh

---

### Infra Templates (DevOps/admin only — provision environments)

| Template | Description | Catalog Type |
|----------|-------------|--------------|
| `infra-aws-ecs` | Provision full ECS environment (VPC + cluster + ECR + IAM) | Creates `Resource` |
| `infra-aws-ec2` | Provision standalone EC2 instance | Creates `Resource` |
| `infra-aws-eks` | Provision standalone EKS cluster | Creates `Resource` |
| `infra-aws-rds` | Provision RDS instance | Creates `Resource` |
| `infra-k8s-namespace` | Provision namespace + RBAC on existing K8s cluster | Creates `Resource` |

These templates:
- Use OpenTofu to provision actual infrastructure
- AWS credentials from env vars / app-config — never user input
- Include proper AWS tags for FinOps dashboard (see AWS Tagging section)
- Register provisioned resource as a `Resource` entity in catalog
- **NOT granular** — `infra-aws-ecs` provisions VPC + cluster + ECR together, not separate VPC template

---

## AWS Tagging (FinOps)

All OpenTofu-managed resources must include these tags:

```hcl
tags = {
  Project     = var.project_id
  Environment = var.environment
  Owner       = var.owner
  Service     = var.app_name
  ManagedBy   = "backstage-scaffolder"
  IaC         = "opentofu"
  CreatedAt   = timestamp()
}
```

Tags fed from template values — no hardcoding. Enables FinOps dashboard cost breakdown by project, environment, owner.

---

## app-config Schema

All infra targets, credentials, and endpoints live here. Templates read via custom actions. No values hardcoded in templates.

```yaml
scaffolder:
  engineeringStandards:
    localPath: ${ENGINEERING_STANDARDS_LOCAL_PATH}   # local dev
    githubUrl: ${ENGINEERING_STANDARDS_REPO_URL}     # production

  targets:
    kubernetes:
      - name: talos-homelab
        displayName: 'Talos Homelab (Self-hosted)'
        type: k8s-selfhosted
        ingressDomain: ${SCAFFOLDER_INGRESS_DOMAIN}
        storageClass: longhorn
        ingressClass: nginx
        argocdUrl: ${ARGOCD_URL}

    aws:
      - name: stratpoint-nonprod
        displayName: 'Stratpoint (Non-prod)'
        accountId: '${FINOPS_AWS_ACCOUNT_NONPROD}'
        region: us-west-2
        ecrRegistry: '${FINOPS_AWS_ACCOUNT_NONPROD}.dkr.ecr.us-west-2.amazonaws.com'
        targets:
          ecs:
            - name: backstage-idp
              displayName: 'Backstage IDP Cluster'
              clusterName: backstage-idp-cluster
          ec2:
            enabled: true
          lambda:
            enabled: true
            supportedFrameworks: [nodejs, nestjs, springboot, python]
          appRunner:
            enabled: true
          rds:
            enabled: true

  tofu:
    stateBackend:
      s3Bucket: ${TOFU_STATE_BUCKET}
      s3Region: ${TOFU_STATE_REGION}
      dynamoTable: ${TOFU_LOCK_TABLE}
```

Admin adds a new AWS account or K8s cluster → it appears in dropdowns automatically. Engineers never see account IDs or cluster names.

---

## How Values Flow (No Hardcoding)

```
env vars (.env / ECS Secrets Manager)
  → app-config.yaml substitution (${VAR})
    → custom scaffolder actions read app-config
      → passed as template values to fetch:template
        → skeleton files use {{ values.xxx }}
          → generated files reference correct resources
```

Zero hardcoding at any layer.

---

## Shared Skeleton Architecture

```
engineering-standards/
└── templates/
    ├── skeletons/
    │   ├── frameworks/
    │   │   ├── nextjs/        # Next.js app boilerplate
    │   │   ├── nodejs/        # Node.js API boilerplate
    │   │   └── nestjs/        # NestJS boilerplate
    │   └── targets/
    │       ├── k8s/           # K8s manifests + CI/CD
    │       ├── ecs/           # ECS task definition + CI/CD
    │       ├── lambda/        # SAM template + CI/CD
    │       ├── app-runner/    # apprunner.yaml + CI/CD
    │       ├── ec2/           # Docker Compose + Caddyfile + deploy.yml
    │       ├── db-cnpg/       # CNPG cluster manifest
    │       └── catalog/       # catalog-info.yaml (Nunjucks conditionals)
    └── projects/
        └── cloud/
            ├── generic-service/template.yaml
            ├── nextjs-fullstack/template.yaml
            ├── service-k8s/template.yaml
            ├── service-ecs/template.yaml
            ├── service-lambda/template.yaml
            ├── service-app-runner/template.yaml
            └── infra/
                ├── infra-aws-ecs/template.yaml
                ├── infra-aws-ec2/template.yaml
                ├── infra-aws-eks/template.yaml
                ├── infra-aws-rds/template.yaml
                └── infra-k8s-namespace/template.yaml
```

`scaffolder:resolve-skeleton-url` action resolves skeleton paths from app-config at runtime — `file://` for local dev, GitHub URL for production.

---

## Custom Actions Needed

| Action | Purpose |
|--------|---------|
| `scaffolder:resolve-skeleton-url` | Resolve skeleton path from app-config (local vs prod) ✓ done |
| `scaffolder:get-targets` | Read `scaffolder.targets` from app-config, return as form options |
| `scaffolder:get-target-config` | Given target name, return all its config values (account, region, cluster, ECR, etc.) |
| `infra:tofu-apply` | Run `tofu init` + `tofu apply` in scaffolder step (admin only) |

---

## Catalog Model

| Template type | Registers as | Notes |
|---------------|-------------|-------|
| Developer templates | `Component` (type: service) | New entity, `catalog:register` step |
| Service templates | Updates existing `Component` | PR to existing repo updating `catalog-info.yaml` annotations — no `catalog:register` |
| Infra templates | `Resource` | New entity, `catalog:register` step |

### Catalog Correlation (Infra ↔ App)

Apps and infra linked via:
1. `spec.dependsOn` in `catalog-info.yaml` — app lists its infra resource
2. `project-registration/project-id` annotation — shared across app + infra
3. `spec.system` — both part of same Backstage System entity

---

## RBAC

### Groups
- `general-engineers` — access to developer templates only
- `devops-team` — access to service templates + infra templates
- `backstage-admins` — full access

### Permission policy (`permission.ts`)
- Engineers: CONDITIONAL — filtered to non-devops-team-owned templates
- DevOps + Admins: ALLOW all scaffolder actions

---

## Implementation Phases

### Phase 1 — Foundation
- [x] Update `app-config.yaml` — all values from env vars, no hardcoding; ecrRegistry at account level
- [x] Add `devops-team` group to `stratpoint/org/groups.yaml`
- [x] Update `permission.ts` — `isDevOps` helper + infra template restriction
- [x] `scaffolder:resolve-skeleton-url` action

### Phase 2 — Developer Templates
- [x] `generic-service` — DeploymentTargetPicker (reads from app-config, filters by framework)
- [x] `nextjs-fullstack` — DeploymentTargetPicker with framework:nextjs

### Phase 3 — Service Templates (DevOps)
- [x] `service-k8s` — EntityPicker, reads cluster config from app-config, PR to existing repo
- [x] `service-ecs` — EntityPicker, reads ECS config from app-config, PR to existing repo
- [x] `service-lambda` — EntityPicker, reads Lambda config from app-config, PR to existing repo
- [x] `service-app-runner` — EntityPicker, reads App Runner config from app-config, PR to existing repo

### Phase 4 — Infra Templates (DevOps/Admin)
- [x] `infra-aws-ecs` — OpenTofu (VPC + ECS cluster + ECR + IAM), FinOps tags
- [x] `infra-aws-ec2` — OpenTofu (EC2 + security groups + Elastic IP), FinOps tags
- [x] `infra-aws-eks` — OpenTofu (EKS cluster + node groups), FinOps tags
- [x] `infra-aws-rds` — OpenTofu (RDS instance + subnet group + security group), FinOps tags
- [x] `infra-k8s-namespace` — kubectl (namespace + RBAC + pull secret)
- [x] `infra:tofu-apply` custom action

### Phase 5 — Custom Actions
- [x] `scaffolder:get-targets` — dynamic dropdowns via DeploymentTargetPicker + scaffolder-targets API
- [x] `scaffolder:get-target-config` — resolve target config values at runtime

### Deferred
- [ ] Decision #9: DB write-back (`scaffolder_targets` table) — after infra templates run end-to-end

---

## Decisions (resolved 2026-04-04)

1. **Service vs Infra** — Services are golden-path deployment config generators for existing apps. Infra provisions the environments. These are separate concerns, separate templates, separate RBAC.

2. **Service templates don't create repos** — They use EntityPicker to pick an existing service, generate deployment config, and submit a PR to the existing repo. No `catalog:register` — entity already exists.

3. **Infra templates are not granular** — `infra-aws-ecs` provisions VPC + cluster + ECR + IAM together. No separate `infra-aws-vpc` template.

4. **All infra config from app-config** — Account IDs, cluster names, ECR registry, ingress domain, storage class — all from app-config via env vars. Engineers never type infra details.

5. **FinOps tagging** — All OpenTofu resources tagged with project, environment, owner, service, managed-by. Consistent across all infra templates.

6. **OpenTofu for AWS infra** — OpenTofu only. Pulumi and Crossplane supported in future via same `infra:tofu-apply` pattern extended to `infra:pulumi-up` etc.

7. **EC2 provisioning** — OpenTofu only, always provisions new instance. No SSH-to-existing.

8. **Lambda framework support** — Restricted to backend frameworks: Node.js, NestJS, Spring Boot, Python. No Next.js or frontend frameworks.

9. **Infra write-back** — DB-backed `scaffolder_targets` table. After infra template runs, outputs written to DB. Custom action reads DB for dynamic dropdowns.

10. **No hardcoding anywhere** — Every credential, endpoint, account ID, cluster name pulled from env var or app-config. Templates and skeletons use `{{ values.xxx }}` only.
