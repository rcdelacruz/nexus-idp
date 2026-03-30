#!/usr/bin/env bash
# Run once before `tofu init` to create the S3 backend for OpenTofu state.
# Usage: ./scripts/bootstrap-state.sh

set -euo pipefail

PROFILE="cost-admin-nonprod"
REGION="ap-southeast-1"
ACCOUNT_ID="746540123485"
BUCKET="stratpoint-tofu-state-prod"
TABLE="stratpoint-tofu-locks"

echo "==> Creating S3 bucket: $BUCKET"
aws s3api create-bucket \
  --bucket "$BUCKET" \
  --region "$REGION" \
  --create-bucket-configuration LocationConstraint="$REGION" \
  --profile "$PROFILE" 2>/dev/null || echo "    (bucket already exists)"

echo "==> Enabling versioning"
aws s3api put-bucket-versioning \
  --bucket "$BUCKET" \
  --versioning-configuration Status=Enabled \
  --profile "$PROFILE"

echo "==> Enabling server-side encryption"
aws s3api put-bucket-encryption \
  --bucket "$BUCKET" \
  --server-side-encryption-configuration '{
    "Rules":[{
      "ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},
      "BucketKeyEnabled":true
    }]
  }' \
  --profile "$PROFILE"

echo "==> Blocking public access"
aws s3api put-public-access-block \
  --bucket "$BUCKET" \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true" \
  --profile "$PROFILE"

echo "==> Tagging S3 bucket"
aws s3api put-bucket-tagging \
  --bucket "$BUCKET" \
  --tagging 'TagSet=[
    {Key=Project,Value=backstage-idp},
    {Key=Environment,Value=production},
    {Key=Owner,Value=stratpoint-platform},
    {Key=ManagedBy,Value=opentofu},
    {Key=CreditProgram,Value=APFP_SANDBOX_03_02_2026},
    {Key=CostCenter,Value=platform-engineering}
  ]' \
  --profile "$PROFILE"

echo "==> Creating DynamoDB lock table: $TABLE"
aws dynamodb create-table \
  --table-name "$TABLE" \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region "$REGION" \
  --profile "$PROFILE" \
  --tags \
    Key=Project,Value=backstage-idp \
    Key=Environment,Value=production \
    Key=Owner,Value=stratpoint-platform \
    Key=ManagedBy,Value=opentofu \
    Key=CreditProgram,Value=APFP_SANDBOX_03_02_2026 \
    Key=CostCenter,Value=platform-engineering \
  2>/dev/null || echo "    (table already exists)"

echo ""
echo "Done. Now run:"
echo "  cd infra && tofu init"
