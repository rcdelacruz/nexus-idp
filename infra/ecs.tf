resource "aws_ecs_cluster" "backstage" {
  name = "${local.name_prefix}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = { Name = "${local.name_prefix}-cluster" }
}

resource "aws_ecs_cluster_capacity_providers" "backstage" {
  cluster_name       = aws_ecs_cluster.backstage.name
  capacity_providers = ["FARGATE"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
  }
}

# ── Task Definition ───────────────────────────────────────────────────────────
resource "aws_ecs_task_definition" "backstage" {
  family                   = "${local.name_prefix}-task"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.ecs_task_cpu
  memory                   = var.ecs_task_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    # ── Init 1: create plugin database ───────────────────────────────────────
    # Mirrors the k8s create-db init container exactly.
    {
      name        = "create-db"
      image       = "postgres:18"
      entryPoint  = ["/bin/sh", "-c"]
      command     = ["PGPASSWORD=$POSTGRES_PASSWORD psql -h $POSTGRES_HOST -U $POSTGRES_USER -d postgres -c 'CREATE DATABASE \"backstage_plugin_local-provisioner\";' 2>/dev/null && echo 'Database created' || echo 'Database already exists, skipping'"]

      environment = [
        { name = "POSTGRES_HOST", value = aws_db_instance.backstage.address },
        { name = "POSTGRES_USER", value = var.db_username },
      ]
      secrets = [
        { name = "POSTGRES_PASSWORD", valueFrom = aws_secretsmanager_secret.db_password.arn }
      ]

      essential = false # exits after completing; task continues

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.backstage.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "create-db"
        }
      }
    },
    # ── Init 2: run Knex migrations ───────────────────────────────────────────
    # Mirrors the k8s db-migrations init container exactly.
    {
      name             = "db-migrations"
      image            = var.backstage_image
      entryPoint       = ["/bin/sh", "-c"]
      command          = ["node scripts/run-migrations.js"]
      workingDirectory = "/app"

      environment = [
        { name = "POSTGRES_HOST", value = aws_db_instance.backstage.address },
        { name = "POSTGRES_PORT", value = "5432" },
        { name = "POSTGRES_USER", value = var.db_username },
        { name = "POSTGRES_DB",   value = "backstage_plugin_local-provisioner" },
      ]
      secrets = [
        { name = "POSTGRES_PASSWORD", valueFrom = aws_secretsmanager_secret.db_password.arn }
      ]

      essential = false # exits after completing; task continues

      dependsOn = [
        { containerName = "create-db", condition = "SUCCESS" }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.backstage.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "db-migrations"
        }
      }
    },
    # ── Main: Backstage ───────────────────────────────────────────────────────
    {
      name  = "backstage"
      image = var.backstage_image

      portMappings = [] # No inbound — cloudflared handles ingress

      dependsOn = [
        { containerName = "db-migrations", condition = "SUCCESS" }
      ]

      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "PORT", value = "7007" },
        { name = "APP_BASE_URL", value = var.backstage_app_base_url },
        { name = "POSTGRES_HOST", value = aws_db_instance.backstage.address },
        { name = "POSTGRES_PORT", value = "5432" },
        { name = "POSTGRES_USER", value = var.db_username },
        { name = "POSTGRES_DB", value = "backstage_plugin_local-provisioner" },
        { name = "REDIS_URL", value = "redis://${aws_elasticache_cluster.backstage.cache_nodes[0].address}:6379" },
        { name = "CACHE_STORE", value = "redis" },
        { name = "AUTH_GOOGLE_ALLOWED_DOMAINS", value = "stratpoint.com" },
        { name = "SESSION_DOMAIN", value = ".stratpoint.io" },
        { name = "ARGOCD_URL", value = "https://argocd.coderstudio.co" },
        { name = "FINOPS_AWS_ACCOUNT_NONPROD", value = var.finops_aws_account_nonprod },
        { name = "FINOPS_AWS_ACCOUNT_LEGACY",  value = var.finops_aws_account_legacy },
        { name = "FINOPS_AWS_ACCOUNT_PROD",    value = var.finops_aws_account_prod },
      ]

      secrets = [
        {
          name      = "POSTGRES_PASSWORD"
          valueFrom = aws_secretsmanager_secret.db_password.arn
        },
        {
          name      = "AUTH_GOOGLE_CLIENT_ID"
          valueFrom = aws_secretsmanager_secret.auth_google_client_id.arn
        },
        {
          name      = "AUTH_GOOGLE_CLIENT_SECRET"
          valueFrom = aws_secretsmanager_secret.auth_google_client_secret.arn
        },
        {
          name      = "GITHUB_TOKEN"
          valueFrom = aws_secretsmanager_secret.github_token.arn
        },
        {
          name      = "AUTH_GITHUB_CLIENT_ID"
          valueFrom = aws_secretsmanager_secret.auth_github_client_id.arn
        },
        {
          name      = "AUTH_GITHUB_CLIENT_SECRET"
          valueFrom = aws_secretsmanager_secret.auth_github_client_secret.arn
        },
        {
          name      = "BACKEND_SECRET"
          valueFrom = aws_secretsmanager_secret.backend_secret.arn
        },
        {
          name      = "ARGOCD_AUTH_TOKEN"
          valueFrom = aws_secretsmanager_secret.argocd_auth_token.arn
        },
        {
          name      = "ARGOCD_TOKEN"
          valueFrom = aws_secretsmanager_secret.argocd_token.arn
        },
        {
          name      = "AWS_ACCESS_KEY_ID"
          valueFrom = aws_secretsmanager_secret.aws_access_key_id.arn
        },
        {
          name      = "AWS_SECRET_ACCESS_KEY"
          valueFrom = aws_secretsmanager_secret.aws_secret_access_key.arn
        },
        {
          name      = "AWS_ACCESS_KEY_ID_LEGACY"
          valueFrom = aws_secretsmanager_secret.aws_access_key_id_legacy.arn
        },
        {
          name      = "AWS_SECRET_ACCESS_KEY_LEGACY"
          valueFrom = aws_secretsmanager_secret.aws_secret_access_key_legacy.arn
        },
        {
          name      = "AWS_ACCESS_KEY_ID_PROD"
          valueFrom = aws_secretsmanager_secret.aws_access_key_id_prod.arn
        },
        {
          name      = "AWS_SECRET_ACCESS_KEY_PROD"
          valueFrom = aws_secretsmanager_secret.aws_secret_access_key_prod.arn
        },
      ]

      healthCheck = {
        command     = ["CMD-SHELL", "node -e \"require('http').get('http://localhost:7007/.backstage/health/v1/liveness',(r)=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))\""]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 90
      }

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.backstage.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "backstage"
        }
      }

      # ECS Exec support
      linuxParameters = {
        initProcessEnabled = true
      }
    },
    {
      name  = "cloudflared"
      image = "cloudflare/cloudflared:2025.4.0"

      command = ["tunnel", "--no-autoupdate", "run"]

      portMappings = []

      environment = []

      secrets = [
        {
          name      = "TUNNEL_TOKEN"
          valueFrom = aws_secretsmanager_secret.cloudflare_tunnel_token.arn
        }
      ]

      # Only start cloudflared after Backstage is healthy
      dependsOn = [
        {
          containerName = "backstage"
          condition     = "HEALTHY"
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.cloudflared.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "cloudflared"
        }
      }
    }
  ])

  tags = { Name = "${local.name_prefix}-task" }
}

# ── ECS Service ───────────────────────────────────────────────────────────────
resource "aws_ecs_service" "backstage" {
  name            = "${local.name_prefix}-service"
  cluster         = aws_ecs_cluster.backstage.id
  task_definition = aws_ecs_task_definition.backstage.arn
  desired_count        = 1 # Keep at 1 — prevents concurrent DB migration races (see CLAUDE.md)
  launch_type          = "FARGATE"
  force_new_deployment = true # trigger redeployment on every tofu apply

  # ECS Exec — enable for live debugging via `aws ecs execute-command`
  enable_execute_command = true

  network_configuration {
    subnets          = [aws_subnet.public_a.id, aws_subnet.public_b.id]
    security_groups  = [aws_security_group.ecs_task.id]
    assign_public_ip = true # No NAT Gateway needed — cloudflared uses outbound-only tunnel
  }

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  tags = { Name = "${local.name_prefix}-service" }

  depends_on = [
    aws_iam_role_policy_attachment.ecs_execution_managed,
    aws_iam_role_policy.ecs_execution_secrets,
  ]

  lifecycle {
    ignore_changes = [] # task_definition managed by tofu; CI/CD updates image via ECR + force_new_deployment
  }
}
