resource "aws_cloudwatch_log_group" "backstage" {
  name              = "/ecs/${local.name_prefix}"
  retention_in_days = 30
  tags              = { Name = "/ecs/${local.name_prefix}" }
}

resource "aws_cloudwatch_log_group" "cloudflared" {
  name              = "/ecs/${local.name_prefix}-cloudflared"
  retention_in_days = 14
  tags              = { Name = "/ecs/${local.name_prefix}-cloudflared" }
}
