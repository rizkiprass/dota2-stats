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

output "dashboard_bucket_name" {
  description = "S3 bucket holding the static statistics dashboard build."
  value       = aws_s3_bucket.dashboard.bucket
}

output "dashboard_url" {
  description = "HTTPS URL of the statistics dashboard (CloudFront)."
  value       = "https://${aws_cloudfront_distribution.dashboard.domain_name}"
}

output "dashboard_cloudfront_domain" {
  description = "CloudFront distribution domain name (use as a CNAME target for a custom domain)."
  value       = aws_cloudfront_distribution.dashboard.domain_name
}

output "dashboard_custom_url" {
  description = "Custom-domain HTTPS URL of the dashboard (null when no domain is configured)."
  value       = var.dashboard_domain == "" ? null : "https://${var.dashboard_domain}"
}

output "dashboard_cloudfront_distribution_id" {
  description = "CloudFront distribution ID (for cache invalidations after deploy)."
  value       = aws_cloudfront_distribution.dashboard.id
}

output "dashboard_certificate_arn" {
  description = "ACM certificate ARN for the dashboard custom domain (us-east-1)."
  value       = var.dashboard_domain == "" ? null : aws_acm_certificate.dashboard[0].arn
}

output "dashboard_certificate_validation_records" {
  description = "CNAME records to add in Cloudflare (DNS-only) to validate the ACM certificate."
  value = var.dashboard_domain == "" ? [] : [
    for option in aws_acm_certificate.dashboard[0].domain_validation_options : {
      name  = option.resource_record_name
      type  = option.resource_record_type
      value = option.resource_record_value
    }
  ]
}
