# Creates a dedicated VPC for Backstage in us-west-2.
# 2 public subnets  (ECS Fargate tasks — cloudflared outbound, assignPublicIp=true)
# 2 private subnets (RDS + ElastiCache — no internet exposure)
# Internet Gateway for public subnets.
# No NAT Gateway — cloudflared sidecar only needs outbound via public IP.

resource "aws_vpc" "backstage" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = "${local.name_prefix}-vpc" }
}

resource "aws_internet_gateway" "backstage" {
  vpc_id = aws_vpc.backstage.id
  tags   = { Name = "${local.name_prefix}-igw" }
}

# ── Public subnets (ECS tasks) ────────────────────────────────────────────────
resource "aws_subnet" "public_a" {
  vpc_id                  = aws_vpc.backstage.id
  cidr_block              = "10.100.0.0/24"
  availability_zone       = "${var.aws_region}a"
  map_public_ip_on_launch = false # ECS service sets assignPublicIp per task
  tags                    = { Name = "${local.name_prefix}-public-a" }
}

resource "aws_subnet" "public_b" {
  vpc_id                  = aws_vpc.backstage.id
  cidr_block              = "10.100.1.0/24"
  availability_zone       = "${var.aws_region}b"
  map_public_ip_on_launch = false
  tags                    = { Name = "${local.name_prefix}-public-b" }
}

# ── Private subnets (RDS + ElastiCache) ───────────────────────────────────────
resource "aws_subnet" "private_a" {
  vpc_id            = aws_vpc.backstage.id
  cidr_block        = "10.100.10.0/24"
  availability_zone = "${var.aws_region}a"
  tags              = { Name = "${local.name_prefix}-private-a" }
}

resource "aws_subnet" "private_b" {
  vpc_id            = aws_vpc.backstage.id
  cidr_block        = "10.100.11.0/24"
  availability_zone = "${var.aws_region}b"
  tags              = { Name = "${local.name_prefix}-private-b" }
}

# ── Route tables ──────────────────────────────────────────────────────────────
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.backstage.id
  tags   = { Name = "${local.name_prefix}-public-rt" }
}

resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.backstage.id
}

resource "aws_route_table_association" "public_a" {
  subnet_id      = aws_subnet.public_a.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "public_b" {
  subnet_id      = aws_subnet.public_b.id
  route_table_id = aws_route_table.public.id
}
