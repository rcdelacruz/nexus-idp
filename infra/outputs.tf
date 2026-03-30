output "ecr_repository_url" {
  description = "ECR repository URL — use this in CI/CD to push images"
  value       = aws_ecr_repository.backstage.repository_url
}

output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = aws_ecs_cluster.backstage.name
}

output "ecs_service_name" {
  description = "ECS service name"
  value       = aws_ecs_service.backstage.name
}

output "rds_endpoint" {
  description = "RDS PostgreSQL endpoint (host:port)"
  value       = "${aws_db_instance.backstage.address}:${aws_db_instance.backstage.port}"
}

output "redis_endpoint" {
  description = "ElastiCache Redis endpoint"
  value       = "${aws_elasticache_cluster.backstage.cache_nodes[0].address}:6379"
}

output "cloudflare_tunnel_secret_arn" {
  description = "Secrets Manager ARN for the Cloudflare tunnel token — populate this manually after creating the tunnel"
  value       = aws_secretsmanager_secret.cloudflare_tunnel_token.arn
}

output "db_secret_arn" {
  description = "Secrets Manager ARN for the RDS password"
  value       = aws_secretsmanager_secret.db_password.arn
  sensitive   = true
}
