variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-west-2"
}

variable "aws_profile" {
  description = "AWS CLI profile to use"
  type        = string
  default     = "cost-admin-nonprod"
}

# ── Networking ────────────────────────────────────────────────────────────────
variable "vpc_cidr" {
  description = "CIDR block for the new Backstage VPC"
  type        = string
  default     = "10.100.0.0/16"
}

# ── Backstage ─────────────────────────────────────────────────────────────────
variable "backstage_image" {
  description = "Full ECR image URI for Backstage (e.g. 746540123485.dkr.ecr.ap-southeast-1.amazonaws.com/backstage-idp-prod:latest)"
  type        = string
}

variable "backstage_app_base_url" {
  description = "Public URL of the Backstage portal (via Cloudflare Tunnel)"
  type        = string
  default     = "https://portal.stratpoint.io"
}

variable "cloudflare_tunnel_token" {
  description = "Cloudflare Tunnel token for the backstage-aws-prod tunnel (cloudflared tunnel token backstage-aws-prod)"
  type        = string
  sensitive   = true
}

# ── ECS ───────────────────────────────────────────────────────────────────────
variable "ecs_task_cpu" {
  description = "Fargate task CPU units (1024 = 1 vCPU)"
  type        = number
  default     = 1024
}

variable "ecs_task_memory" {
  description = "Fargate task memory in MB"
  type        = number
  default     = 2048
}

# ── Database ──────────────────────────────────────────────────────────────────
variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t4g.small"
}

variable "db_allocated_storage" {
  description = "RDS storage in GB"
  type        = number
  default     = 20
}

variable "db_name" {
  description = "PostgreSQL database name"
  type        = string
  default     = "backstage"
}

variable "db_username" {
  description = "PostgreSQL master username"
  type        = string
  default     = "backstage"
}

# ── Cache ─────────────────────────────────────────────────────────────────────
variable "redis_node_type" {
  description = "ElastiCache Redis node type"
  type        = string
  default     = "cache.t4g.small"
}

# ── Secrets (injected at plan time, never stored in state as plaintext) ────────
variable "auth_google_client_id" {
  description = "Google OAuth client ID"
  type        = string
  sensitive   = true
}

variable "auth_google_client_secret" {
  description = "Google OAuth client secret"
  type        = string
  sensitive   = true
}

variable "backend_secret" {
  description = "Backstage backend secret (32-byte hex)"
  type        = string
  sensitive   = true
}

variable "github_token" {
  description = "GitHub personal access token for catalog integration"
  type        = string
  sensitive   = true
}

variable "auth_github_client_id" {
  description = "GitHub OAuth app client ID"
  type        = string
  sensitive   = true
}

variable "auth_github_client_secret" {
  description = "GitHub OAuth app client secret"
  type        = string
  sensitive   = true
}

# ── ArgoCD ────────────────────────────────────────────────────────────────────
variable "argocd_auth_token" {
  description = "ArgoCD auth token with prefix for proxy Cookie header (argocd.token=<jwt>)"
  type        = string
  sensitive   = true
}

variable "argocd_token" {
  description = "ArgoCD bare JWT token for argocd plugin (no prefix)"
  type        = string
  sensitive   = true
}

# ── FinOps AWS credentials ────────────────────────────────────────────────────
variable "aws_access_key_id" {
  description = "AWS access key ID for nonprod account (FinOps plugin)"
  type        = string
  sensitive   = true
}
variable "aws_secret_access_key" {
  description = "AWS secret access key for nonprod account (FinOps plugin)"
  type        = string
  sensitive   = true
}
variable "aws_access_key_id_legacy" {
  description = "AWS access key ID for legacy account (FinOps plugin)"
  type        = string
  sensitive   = true
}
variable "aws_secret_access_key_legacy" {
  description = "AWS secret access key for legacy account (FinOps plugin)"
  type        = string
  sensitive   = true
}
variable "aws_access_key_id_prod" {
  description = "AWS access key ID for prod account (FinOps plugin)"
  type        = string
  sensitive   = true
}
variable "aws_secret_access_key_prod" {
  description = "AWS secret access key for prod account (FinOps plugin)"
  type        = string
  sensitive   = true
}

# ── FinOps account IDs ────────────────────────────────────────────────────────
variable "finops_aws_account_nonprod" {
  description = "AWS account ID for nonprod (FinOps plugin)"
  type        = string
  default     = "746540123485"
}
variable "finops_aws_account_legacy" {
  description = "AWS account ID for legacy (FinOps plugin)"
  type        = string
  default     = "309903066618"
}
variable "finops_aws_account_prod" {
  description = "AWS account ID for prod (FinOps plugin)"
  type        = string
  default     = "128388385283"
}
