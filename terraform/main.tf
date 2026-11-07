terraform {
  required_version = ">= 1.6.0"

  backend "s3" {
    bucket  = "dta-replay-tfstate-rizkiprass-2026"
    key     = "dota-replay/terraform.tfstate"
    region  = "us-east-1"
    profile = "pras-sandbox"
    encrypt = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "2.5.0"
    }
  }
}

provider "aws" {
  profile = var.aws_profile
  region  = var.aws_region
}

# CloudFront requires ACM certificates to live in us-east-1.
provider "aws" {
  alias   = "us_east_1"
  profile = var.aws_profile
  region  = "us-east-1"
}
