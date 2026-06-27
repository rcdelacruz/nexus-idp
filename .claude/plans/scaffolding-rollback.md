# Scaffolding Rollback / Compensation — Future Task

## Problem
When a scaffolding template step fails midway, all previously completed steps leave orphaned resources with no cleanup:
- Neon project created but later step fails → orphaned Neon project
- GitHub repo created but later step fails → orphaned GitHub repo
- k8s secrets created but later step fails → orphaned secrets
- ArgoCD app registered but later step fails → orphaned ArgoCD app

Backstage scaffolding has no built-in rollback/compensation mechanism.

## Scope
This is a cross-cutting concern affecting ALL templates, not just dbaas. Must be solved at the scaffolding level, not patched individually per action.

## Proposed Approach (to be designed)
- A general compensation/cleanup action that accepts a list of created resources
- Each step that creates an external resource registers it with the compensation tracker
- On failure, compensation runs in reverse order
- OR: a dedicated cleanup template that accepts resource refs and tears them down

## Affected Resources
- Neon projects (DELETE /api/v2/projects/{id})
- GitHub repos (GitHub API delete)
- k8s secrets/namespaces (kubectl delete)
- ArgoCD applications (ArgoCD API delete)
- AWS resources (Secrets Manager entries, etc.)

## Status
Deferred — tackle after dbaas auto-create feature is stable.
