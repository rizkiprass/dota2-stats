variable "aws_profile" {
  description = "Named AWS CLI shared-credentials profile Terraform uses for this deployment."
  type        = string
  default     = "pras-sandbox"
}

variable "aws_region" {
  description = "AWS region to deploy the MVP pipeline into."
  type        = string
  default     = "us-east-1"
}

variable "account_id" {
  description = "AWS account ID that owns the ECR repository / Lambda function."
  type        = string
}

variable "project_name" {
  description = "Name prefix used for all created resources."
  type        = string
  default     = "dota-replay"
}

variable "bucket_name" {
  description = "Name of the S3 bucket used to store raw replays and parsed JSON. Must be globally unique."
  type        = string
  default     = "dota-replay-data"
}

variable "dashboard_bucket_name" {
  description = "Globally unique S3 bucket name for the static statistics dashboard website."
  type        = string
  default     = "dota-replay-dashboard"
}

variable "dashboard_domain" {
  description = "Custom domain for the dashboard (CloudFront alias). Empty string disables the custom domain."
  type        = string
  default     = ""
}

variable "ecr_repository_name" {
  description = "Name of the ECR repository holding the Lambda container image."
  type        = string
  default     = "dota-replay-parser"
}

variable "image_tag" {
  description = "Tag of the container image in ECR to deploy as the Lambda function code."
  type        = string
  default     = "latest"
}

variable "lambda_memory_mb" {
  description = "Lambda memory allocation in MB (also determines proportional CPU)."
  type        = number
  default     = 4096
}

variable "lambda_ephemeral_storage_mb" {
  description = "Lambda /tmp ephemeral storage size in MB."
  type        = number
  default     = 4096
}

variable "lambda_timeout_seconds" {
  description = "Lambda function timeout in seconds."
  type        = number
  default     = 900
}

variable "lambda_reserved_concurrency" {
  description = "Optional reserved concurrency for the Lambda function. Use null to leave concurrency unreserved."
  type        = number
  default     = null
}

variable "aggregator_lambda_memory_mb" {
  description = "Memory allocation in MB for the full-rebuild statistics Lambda."
  type        = number
  default     = 1024
}

variable "aggregator_lambda_timeout_seconds" {
  description = "Timeout in seconds for the full-rebuild statistics Lambda."
  type        = number
  default     = 300
}

variable "aggregator_lambda_ephemeral_storage_mb" {
  description = "Ephemeral /tmp storage in MB for the statistics Lambda."
  type        = number
  default     = 512
}

variable "aggregator_lambda_reserved_concurrency" {
  description = "Optional reserved concurrency for the statistics Lambda. Use null to leave it unreserved."
  type        = number
  default     = null
}

variable "upload_token" {
  description = "Shared password players type once in the dashboard before they may upload a replay. Generate with `openssl rand -base64 24`."
  type        = string
  sensitive   = true
}

variable "upload_api_max_upload_mb" {
  description = "Largest replay the upload API will accept, in megabytes."
  type        = number
  default     = 512
}

variable "opencode_model" {
  description = "OpenCode inference model ID used for on-demand match recaps."
  type        = string
  default     = "glm-5.3-flash-free"
}

variable "recap_prompt_version" {
  description = "Cache namespace for generated recaps. Change it to regenerate every match."
  type        = string
  default     = "1"
}

variable "recap_max_tokens" {
  description = "Maximum completion tokens requested for one match recap."
  type        = number
  default     = 400
}
