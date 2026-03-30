resource "aws_db_subnet_group" "backstage" {
  name        = "${local.name_prefix}-db"
  description = "Backstage RDS subnet group (Data subnets)"
  subnet_ids  = [aws_subnet.private_a.id, aws_subnet.private_b.id]
  tags        = { Name = "${local.name_prefix}-db" }
}

resource "aws_db_instance" "backstage" {
  identifier = "${local.name_prefix}-db"

  engine         = "postgres"
  engine_version = "13.20"
  instance_class = var.db_instance_class

  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = 100
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = var.db_name
  username = var.db_username
  password = random_password.db_password.result

  db_subnet_group_name   = aws_db_subnet_group.backstage.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false
  multi_az               = false

  backup_retention_period = 7
  backup_window           = "17:00-18:00" # UTC = 01:00-02:00 SGT
  maintenance_window      = "sun:18:00-sun:19:00"

  deletion_protection       = false
  skip_final_snapshot       = true

  performance_insights_enabled = false # enable if you need query analysis

  tags = { Name = "${local.name_prefix}-db" }
}
