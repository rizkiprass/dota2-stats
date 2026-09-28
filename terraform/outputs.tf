output "bucket_name" {
  description = "S3 bucket storing raw replays and parsed JSON results."
  value       = aws_s3_bucket.replay_data.bucket
}

output "ecr_repository_url" {
  description = "ECR repository URL to push the Lambda container image to."
  value       = aws_ecr_repository.parser.repository_url
}

output "lambda_function_name" {
  description = "Name of the deployed Lambda function."
  value       = aws_lambda_function.replay_parser.function_name
}

output "lambda_function_arn" {
  description = "ARN of the deployed Lambda function."
  value       = aws_lambda_function.replay_parser.arn
}

output "cloudwatch_log_group" {
  description = "CloudWatch Logs group for the Lambda function."
  value       = aws_cloudwatch_log_group.replay_parser.name
}

output "aggregator_lambda_function_name" {
  description = "Name of the deployed full-rebuild statistics Lambda function."
  value       = aws_lambda_function.statistics_aggregator.function_name
}

output "aggregator_lambda_function_arn" {
  description = "ARN of the deployed full-rebuild statistics Lambda function."
  value       = aws_lambda_function.statistics_aggregator.arn
}

output "aggregator_cloudwatch_log_group" {
  description = "CloudWatch Logs group for the statistics Lambda function."
  value       = aws_cloudwatch_log_group.statistics_aggregator.name
}
