# Lambda function running the replay parser container image.
# Configuration values follow the MVP starting points in plan Section 8;
# tune lambda_memory_mb / lambda_ephemeral_storage_mb down after benchmarking
# real replays (plan Section 10/14).

resource "aws_cloudwatch_log_group" "replay_parser" {
  name              = "/aws/lambda/${var.project_name}-parser"
  retention_in_days = 30
}

resource "aws_lambda_function" "replay_parser" {
  function_name = "${var.project_name}-parser"
  role          = aws_iam_role.lambda_exec.arn

  package_type = "Image"
  image_uri    = "${var.account_id}.dkr.ecr.${var.aws_region}.amazonaws.com/${aws_ecr_repository.parser.name}:${var.image_tag}"

  architectures = ["x86_64"]

  memory_size = var.lambda_memory_mb
  timeout     = var.lambda_timeout_seconds

  ephemeral_storage {
    size = var.lambda_ephemeral_storage_mb
  }

  reserved_concurrent_executions = var.lambda_reserved_concurrency

  environment {
    variables = {
      PARSER_JAR             = "/opt/parser/parser.jar"
      PARSER_TIMEOUT_SECONDS = tostring(var.lambda_timeout_seconds - 30)
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.lambda_logs,
    aws_cloudwatch_log_group.replay_parser,
  ]
}

# ZIP Lambda that rebuilds all historical statistics whenever a parsed match is
# created. The archive is generated deterministically from the source file by
# Terraform and does not require a container image.
data "archive_file" "statistics_aggregator" {
  type        = "zip"
  source_file = "${path.module}/../aggregator/aggregator.py"
  output_path = "${path.module}/aggregator.zip"
}

resource "aws_cloudwatch_log_group" "statistics_aggregator" {
  name              = "/aws/lambda/${var.project_name}-aggregator"
  retention_in_days = 30
}

resource "aws_lambda_function" "statistics_aggregator" {
  function_name = "${var.project_name}-aggregator"
  role          = aws_iam_role.aggregator_lambda_exec.arn
  runtime       = "python3.13"
  handler       = "aggregator.lambda_handler"
  filename      = data.archive_file.statistics_aggregator.output_path

  source_code_hash = data.archive_file.statistics_aggregator.output_base64sha256
  architectures    = ["x86_64"]
  memory_size      = var.aggregator_lambda_memory_mb
  timeout          = var.aggregator_lambda_timeout_seconds

  ephemeral_storage {
    size = var.aggregator_lambda_ephemeral_storage_mb
  }

  reserved_concurrent_executions = var.aggregator_lambda_reserved_concurrency

  environment {
    variables = {
      # Temporarily lowered for the small early dataset so leaderboards are not
      # empty. Raise back toward the plan defaults (5/5/3/3) as history grows.
      MIN_PLAYER_MATCHES   = "2"
      MIN_HERO_PICKS       = "2"
      MIN_TEAMMATE_MATCHES = "2"
      MIN_H2H_MATCHES      = "2"
      LEADERBOARD_LIMIT    = "10"
    }
  }

  depends_on = [
    aws_iam_role_policy.aggregator_lambda_s3,
    aws_iam_role_policy_attachment.aggregator_lambda_logs,
    aws_cloudwatch_log_group.statistics_aggregator,
  ]
}
