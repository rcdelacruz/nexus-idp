terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.40"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Bootstrap first: run ./scripts/bootstrap-state.sh
  # then uncomment this block and run: tofu init -migrate-state
  backend "s3" {
    bucket         = "your-org-tofu-state-prod" # replace with the bucket bootstrap-state.sh created
    key            = "backstage-idp/production/terraform.tfstate"
    region         = "ap-southeast-1"
    dynamodb_table = "your-org-tofu-locks"
    encrypt        = true
  }
}
