resource "random_password" "db_password" {
  length           = 32
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

# ── Database credentials ───────────────────────────────────────────────────────
resource "aws_secretsmanager_secret" "db_password" {
  name                    = "${local.name_prefix}/db-password"
  description             = "Backstage RDS PostgreSQL master password"
  recovery_window_in_days = 7
  tags                    = { Name = "${local.name_prefix}/db-password" }
}

resource "aws_secretsmanager_secret_version" "db_password" {
  secret_id     = aws_secretsmanager_secret.db_password.id
  secret_string = random_password.db_password.result
}

# ── Google OAuth ──────────────────────────────────────────────────────────────
resource "aws_secretsmanager_secret" "auth_google_client_id" {
  name                    = "${local.name_prefix}/auth-google-client-id"
  description             = "Google OAuth client ID for Backstage"
  recovery_window_in_days = 7
  tags                    = { Name = "${local.name_prefix}/auth-google-client-id" }
}

resource "aws_secretsmanager_secret_version" "auth_google_client_id" {
  secret_id     = aws_secretsmanager_secret.auth_google_client_id.id
  secret_string = var.auth_google_client_id
}

resource "aws_secretsmanager_secret" "auth_google_client_secret" {
  name                    = "${local.name_prefix}/auth-google-client-secret"
  description             = "Google OAuth client secret for Backstage"
  recovery_window_in_days = 7
  tags                    = { Name = "${local.name_prefix}/auth-google-client-secret" }
}

resource "aws_secretsmanager_secret_version" "auth_google_client_secret" {
  secret_id     = aws_secretsmanager_secret.auth_google_client_secret.id
  secret_string = var.auth_google_client_secret
}

# ── GitHub ────────────────────────────────────────────────────────────────────
resource "aws_secretsmanager_secret" "github_token" {
  name                    = "${local.name_prefix}/github-token"
  description             = "GitHub PAT for Backstage catalog integration"
  recovery_window_in_days = 7
  tags                    = { Name = "${local.name_prefix}/github-token" }
}

resource "aws_secretsmanager_secret_version" "github_token" {
  secret_id     = aws_secretsmanager_secret.github_token.id
  secret_string = var.github_token
}

resource "aws_secretsmanager_secret" "auth_github_client_id" {
  name                    = "${local.name_prefix}/auth-github-client-id"
  description             = "GitHub OAuth app client ID for Backstage"
  recovery_window_in_days = 7
  tags                    = { Name = "${local.name_prefix}/auth-github-client-id" }
}

resource "aws_secretsmanager_secret_version" "auth_github_client_id" {
  secret_id     = aws_secretsmanager_secret.auth_github_client_id.id
  secret_string = var.auth_github_client_id
}

resource "aws_secretsmanager_secret" "auth_github_client_secret" {
  name                    = "${local.name_prefix}/auth-github-client-secret"
  description             = "GitHub OAuth app client secret for Backstage"
  recovery_window_in_days = 7
  tags                    = { Name = "${local.name_prefix}/auth-github-client-secret" }
}

resource "aws_secretsmanager_secret_version" "auth_github_client_secret" {
  secret_id     = aws_secretsmanager_secret.auth_github_client_secret.id
  secret_string = var.auth_github_client_secret
}

# ── Backstage backend secret ──────────────────────────────────────────────────
resource "aws_secretsmanager_secret" "backend_secret" {
  name                    = "${local.name_prefix}/backend-secret"
  description             = "Backstage backend signing secret (32-byte hex)"
  recovery_window_in_days = 7
  tags                    = { Name = "${local.name_prefix}/backend-secret" }
}

resource "aws_secretsmanager_secret_version" "backend_secret" {
  secret_id     = aws_secretsmanager_secret.backend_secret.id
  secret_string = var.backend_secret
}

# ── Cloudflare Tunnel token ───────────────────────────────────────────────────
# backstage-aws-prod tunnel (ID: 807e68af-b69c-421c-9ebc-310934186aab)
# Token managed in terraform.tfvars as cloudflare_tunnel_token.
resource "aws_secretsmanager_secret" "cloudflare_tunnel_token" {
  name                    = "${local.name_prefix}/cloudflare-tunnel-token"
  description             = "Cloudflare Tunnel token for cloudflared sidecar (backstage-aws-prod tunnel)"
  recovery_window_in_days = 7
  tags                    = { Name = "${local.name_prefix}/cloudflare-tunnel-token" }
}

resource "aws_secretsmanager_secret_version" "cloudflare_tunnel_token" {
  secret_id     = aws_secretsmanager_secret.cloudflare_tunnel_token.id
  secret_string = var.cloudflare_tunnel_token
}

# ── ArgoCD ────────────────────────────────────────────────────────────────────
# ARGOCD_AUTH_TOKEN: used by the proxy (Cookie header) — needs "argocd.token=<jwt>" format
resource "aws_secretsmanager_secret" "argocd_auth_token" {
  name                    = "${local.name_prefix}/argocd-auth-token"
  description             = "ArgoCD auth token for Backstage proxy (argocd.token=<jwt> format)"
  recovery_window_in_days = 7
  tags                    = { Name = "${local.name_prefix}/argocd-auth-token" }
}

resource "aws_secretsmanager_secret_version" "argocd_auth_token" {
  secret_id     = aws_secretsmanager_secret.argocd_auth_token.id
  secret_string = var.argocd_auth_token
}

# ARGOCD_TOKEN: used by the argocd plugin directly — bare JWT (no "argocd.token=" prefix)
resource "aws_secretsmanager_secret" "argocd_token" {
  name                    = "${local.name_prefix}/argocd-token"
  description             = "ArgoCD bare JWT token for Backstage argocd plugin"
  recovery_window_in_days = 7
  tags                    = { Name = "${local.name_prefix}/argocd-token" }
}

resource "aws_secretsmanager_secret_version" "argocd_token" {
  secret_id     = aws_secretsmanager_secret.argocd_token.id
  secret_string = var.argocd_token
}

# ── FinOps AWS credentials ────────────────────────────────────────────────────
resource "aws_secretsmanager_secret" "aws_access_key_id" {
  name                    = "${local.name_prefix}/aws-access-key-id"
  description             = "AWS access key ID (nonprod account) for FinOps plugin"
  recovery_window_in_days = 7
  tags                    = { Name = "${local.name_prefix}/aws-access-key-id" }
}
resource "aws_secretsmanager_secret_version" "aws_access_key_id" {
  secret_id     = aws_secretsmanager_secret.aws_access_key_id.id
  secret_string = var.aws_access_key_id
}

resource "aws_secretsmanager_secret" "aws_secret_access_key" {
  name                    = "${local.name_prefix}/aws-secret-access-key"
  description             = "AWS secret access key (nonprod account) for FinOps plugin"
  recovery_window_in_days = 7
  tags                    = { Name = "${local.name_prefix}/aws-secret-access-key" }
}
resource "aws_secretsmanager_secret_version" "aws_secret_access_key" {
  secret_id     = aws_secretsmanager_secret.aws_secret_access_key.id
  secret_string = var.aws_secret_access_key
}

resource "aws_secretsmanager_secret" "aws_access_key_id_legacy" {
  name                    = "${local.name_prefix}/aws-access-key-id-legacy"
  description             = "AWS access key ID (legacy account) for FinOps plugin"
  recovery_window_in_days = 7
  tags                    = { Name = "${local.name_prefix}/aws-access-key-id-legacy" }
}
resource "aws_secretsmanager_secret_version" "aws_access_key_id_legacy" {
  secret_id     = aws_secretsmanager_secret.aws_access_key_id_legacy.id
  secret_string = var.aws_access_key_id_legacy
}

resource "aws_secretsmanager_secret" "aws_secret_access_key_legacy" {
  name                    = "${local.name_prefix}/aws-secret-access-key-legacy"
  description             = "AWS secret access key (legacy account) for FinOps plugin"
  recovery_window_in_days = 7
  tags                    = { Name = "${local.name_prefix}/aws-secret-access-key-legacy" }
}
resource "aws_secretsmanager_secret_version" "aws_secret_access_key_legacy" {
  secret_id     = aws_secretsmanager_secret.aws_secret_access_key_legacy.id
  secret_string = var.aws_secret_access_key_legacy
}

resource "aws_secretsmanager_secret" "aws_access_key_id_prod" {
  name                    = "${local.name_prefix}/aws-access-key-id-prod"
  description             = "AWS access key ID (prod account) for FinOps plugin"
  recovery_window_in_days = 7
  tags                    = { Name = "${local.name_prefix}/aws-access-key-id-prod" }
}
resource "aws_secretsmanager_secret_version" "aws_access_key_id_prod" {
  secret_id     = aws_secretsmanager_secret.aws_access_key_id_prod.id
  secret_string = var.aws_access_key_id_prod
}

resource "aws_secretsmanager_secret" "aws_secret_access_key_prod" {
  name                    = "${local.name_prefix}/aws-secret-access-key-prod"
  description             = "AWS secret access key (prod account) for FinOps plugin"
  recovery_window_in_days = 7
  tags                    = { Name = "${local.name_prefix}/aws-secret-access-key-prod" }
}
resource "aws_secretsmanager_secret_version" "aws_secret_access_key_prod" {
  secret_id     = aws_secretsmanager_secret.aws_secret_access_key_prod.id
  secret_string = var.aws_secret_access_key_prod
}
