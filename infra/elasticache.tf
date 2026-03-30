resource "aws_elasticache_subnet_group" "backstage" {
  name        = "${local.name_prefix}-redis"
  description = "Backstage ElastiCache Redis subnet group (Data subnets)"
  subnet_ids  = [aws_subnet.private_a.id, aws_subnet.private_b.id]
  tags        = { Name = "${local.name_prefix}-redis" }
}

resource "aws_elasticache_cluster" "backstage" {
  cluster_id           = "${local.name_prefix}-redis"
  engine               = "redis"
  engine_version       = "7.1"
  node_type            = var.redis_node_type
  num_cache_nodes      = 1
  parameter_group_name = "default.redis7"
  port                 = 6379

  subnet_group_name  = aws_elasticache_subnet_group.backstage.name
  security_group_ids = [aws_security_group.redis.id]

  snapshot_retention_limit = 1
  snapshot_window          = "16:00-17:00" # UTC = 00:00-01:00 SGT

  tags = { Name = "${local.name_prefix}-redis" }
}
