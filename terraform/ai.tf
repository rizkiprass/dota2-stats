# Optional public analysis API. Set the OpenRouter key's monthly limit to $1
# in OpenRouter before enabling this infrastructure.
variable "ai_enabled" {
  type    = bool
  default = false
}

variable "openrouter_key_parameter_arn" {
  description = "ARN of an existing SSM SecureString containing the OpenRouter key."
  type        = string
  default     = ""
}

variable "openrouter_model" {
  type    = string
  default = "google/gemini-2.5-flash-lite"
}

variable "langfuse_enabled" {
  type    = bool
  default = false
}

variable "langfuse_public_key" {
  type    = string
  default = ""
}

variable "langfuse_secret_key_parameter_arn" {
  description = "ARN of an existing SSM SecureString containing the Langfuse secret key."
  type        = string
  default     = ""
}

variable "langfuse_base_url" {
  type    = string
  default = "https://cloud.langfuse.com"
}

resource "aws_lambda_layer_version" "langfuse" {
  count                    = var.ai_enabled && var.langfuse_enabled ? 1 : 0
  filename                 = "${path.module}/langfuse-layer.zip"
  source_code_hash         = filebase64sha256("${path.module}/langfuse-layer.zip")
  layer_name               = "${var.project_name}-langfuse"
  compatible_runtimes      = ["python3.13"]
  compatible_architectures = ["x86_64"]
}

data "archive_file" "ai" {
  count       = var.ai_enabled ? 1 : 0
  type        = "zip"
  output_path = "${path.module}/ai-api.zip"
  source {
    content  = file("${path.module}/../ai/handler.py")
    filename = "handler.py"
  }
  source {
    content  = file("${path.module}/../web/src/lib/hero-slugs.json")
    filename = "hero-slugs.json"
  }
}

resource "aws_iam_role" "ai" {
  count              = var.ai_enabled ? 1 : 0
  name               = "${var.project_name}-ai-exec-role"
  assume_role_policy = aws_iam_role.lambda_exec.assume_role_policy
}

resource "aws_iam_role_policy_attachment" "ai_logs" {
  count      = var.ai_enabled ? 1 : 0
  role       = aws_iam_role.ai[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "ai" {
  count = var.ai_enabled ? 1 : 0
  role  = aws_iam_role.ai[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["s3:GetObject"], Resource = ["${aws_s3_bucket.replay_data.arn}/parsed/*", "${aws_s3_bucket.replay_data.arn}/ai-cache/*"] },
      { Effect = "Allow", Action = ["s3:ListBucket"], Resource = aws_s3_bucket.replay_data.arn, Condition = { StringLike = { "s3:prefix" = ["parsed/*", "ai-cache/*"] } } },
      { Effect = "Allow", Action = ["s3:PutObject"], Resource = "${aws_s3_bucket.replay_data.arn}/ai-cache/*" },
      { Effect = "Allow", Action = ["ssm:GetParameter"], Resource = concat([var.openrouter_key_parameter_arn], var.langfuse_enabled ? [var.langfuse_secret_key_parameter_arn] : []) },
      { Effect = "Allow", Action = ["dynamodb:UpdateItem"], Resource = aws_dynamodb_table.ai_rate[0].arn }
    ]
  })
}

resource "aws_dynamodb_table" "ai_rate" {
  count        = var.ai_enabled ? 1 : 0
  name         = "${var.project_name}-ai-rate"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"
  attribute {
    name = "id"
    type = "S"
  }
  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }
}

resource "aws_lambda_function" "ai" {
  count            = var.ai_enabled ? 1 : 0
  function_name    = "${var.project_name}-ai"
  role             = aws_iam_role.ai[0].arn
  runtime          = "python3.13"
  handler          = "handler.lambda_handler"
  filename         = data.archive_file.ai[0].output_path
  source_code_hash = data.archive_file.ai[0].output_base64sha256
  timeout          = var.langfuse_enabled ? 45 : 30
  memory_size      = 256
  layers           = var.langfuse_enabled ? [aws_lambda_layer_version.langfuse[0].arn] : []
  environment {
    variables = {
      REPLAY_BUCKET                 = aws_s3_bucket.replay_data.bucket
      OPENROUTER_KEY_PARAMETER      = var.openrouter_key_parameter_arn
      OPENROUTER_MODEL              = var.openrouter_model
      AI_RATE_TABLE                 = aws_dynamodb_table.ai_rate[0].name
      LANGFUSE_PUBLIC_KEY           = var.langfuse_enabled ? var.langfuse_public_key : ""
      LANGFUSE_SECRET_KEY_PARAMETER = var.langfuse_enabled ? var.langfuse_secret_key_parameter_arn : ""
      LANGFUSE_BASE_URL             = var.langfuse_base_url
      ALLOWED_ORIGINS = join(",", compact([
        "https://${aws_cloudfront_distribution.dashboard.domain_name}",
        var.dashboard_domain == "" ? "" : "https://${var.dashboard_domain}"
      ]))
    }
  }
  lifecycle {
    precondition {
      condition     = var.openrouter_key_parameter_arn != ""
      error_message = "An existing SSM SecureString ARN is required for AI."
    }
    precondition {
      condition     = !var.langfuse_enabled || (var.langfuse_public_key != "" && var.langfuse_secret_key_parameter_arn != "")
      error_message = "Langfuse requires a public key and an existing SSM SecureString ARN."
    }
  }
}

resource "aws_apigatewayv2_api" "ai" {
  count         = var.ai_enabled ? 1 : 0
  name          = "${var.project_name}-ai"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "ai" {
  count                  = var.ai_enabled ? 1 : 0
  api_id                 = aws_apigatewayv2_api.ai[0].id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.ai[0].invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "ai" {
  count     = var.ai_enabled ? 1 : 0
  api_id    = aws_apigatewayv2_api.ai[0].id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.ai[0].id}"
}

resource "aws_apigatewayv2_stage" "ai" {
  count       = var.ai_enabled ? 1 : 0
  api_id      = aws_apigatewayv2_api.ai[0].id
  name        = "$default"
  auto_deploy = true
  default_route_settings {
    throttling_burst_limit = 2
    throttling_rate_limit  = 1
  }
}

resource "aws_lambda_permission" "ai" {
  count         = var.ai_enabled ? 1 : 0
  statement_id  = "AllowApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ai[0].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.ai[0].execution_arn}/*/*"
}

output "ai_api_url" {
  value = var.ai_enabled ? aws_apigatewayv2_stage.ai[0].invoke_url : ""
}
