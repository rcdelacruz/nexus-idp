# ── ECS Task SG ───────────────────────────────────────────────────────────────
# Backstage + cloudflared sidecar. No inbound from internet — cloudflared
# makes outbound-only connections to Cloudflare's edge. Allow all egress
# (GitHub API, Google OAuth, Cloudflare, ECR, Secrets Manager).
resource "aws_security_group" "ecs_task" {
  name        = "${local.name_prefix}-ecs-task"
  description = "Backstage ECS Fargate task - cloudflared outbound only"
  vpc_id      = aws_vpc.backstage.id

  egress {
    description = "All outbound (cloudflared tunnel, GitHub API, Google OAuth, ECR)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-ecs-task" }
}

# ── RDS SG ────────────────────────────────────────────────────────────────────
resource "aws_security_group" "rds" {
  name        = "${local.name_prefix}-rds"
  description = "Backstage RDS PostgreSQL - allow from ECS task only"
  vpc_id      = aws_vpc.backstage.id

  ingress {
    description     = "PostgreSQL from Backstage ECS task"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_task.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-rds" }
}

# ── ElastiCache SG ────────────────────────────────────────────────────────────
resource "aws_security_group" "redis" {
  name        = "${local.name_prefix}-redis"
  description = "Backstage ElastiCache Redis - allow from ECS task only"
  vpc_id      = aws_vpc.backstage.id

  ingress {
    description     = "Redis from Backstage ECS task"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_task.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-redis" }
}
