# ECR repository holding the Lambda container image built from parser/Dockerfile.
# Build & push the image before running `terraform apply`, since the Lambda
# function resource references a specific image tag that must already exist.

resource "aws_ecr_repository" "parser" {
  name                 = var.ecr_repository_name
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "parser" {
  repository = aws_ecr_repository.parser.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep only the last 10 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}
