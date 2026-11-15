# On-demand AI player profile analysis.
#
# A separate function from `dota-replay-ai`, not a new route on it. The
# match-analysis function is live and healthy, and its worst observed duration
# already sits above the API Gateway integration ceiling; a player-scoped payload
# that reads up to twenty parsed replays has to be tuned and isolated rather than
# folded into the request path that currently has zero errors.
#
# Both functions share the one HTTP API and the one rate-limit table, so a single
# client is bounded across both surfaces rather than getting a fresh budget on
# each. Nothing here is public: the generated analysis lives in the private replay
# bucket under ai-cache/profile/ and is served through this API. It is not
# mirrored to the dashboard bucket, because aggregate lobby statistics are already
# public while an interpretive judgement of a named person is a different thing.

variable "ai_profile_enabled" {
  description = "Deploy the player profile analysis route. Only applies when ai_enabled is also true."
  type        = bool
  default     = true
}

variable "langfuse_capture_profile_output" {
  description = "Send the generated profile and its metrics payload to Langfuse. Unlike a match insight, this is a standing judgement about a named person, so it is opt-in."
  type        = bool
  default     = false
}

locals {
  ai_profile_enabled = var.ai_enabled && var.ai_profile_enabled ? 1 : 0
}

# profile_handler.py imports profile_metrics flat, the way the Lambda runtime lays
# the archive out, so both modules ship side by side at the archive root.
data "archive_file" "ai_profile" {
  count       = local.ai_profile_enabled
  type        = "zip"
  output_path = "${path.module}/ai-profile-api.zip"
  source {
    content  = file("${path.module}/../ai/profile_handler.py")
    filename = "profile_handler.py"
  }
  source {
    content  = file("${path.module}/../ai/profile_metrics.py")
    filename = "profile_metrics.py"
  }
  source {
    content  = file("${path.module}/../web/src/lib/hero-slugs.json")
    filename = "hero-slugs.json"
  }
}

# Explicit, retained log group. The three pipeline functions each declare one;
# `dota-replay-ai` does not, so CloudWatch created its group on first invocation
# with no retention at all and it still keeps every line forever. Importing that
# existing group into Terraform is a separate deliberate step, but the new
# function does not have to inherit the gap.
resource "aws_cloudwatch_log_group" "ai_profile" {
  count             = local.ai_profile_enabled
  name              = "/aws/lambda/${var.project_name}-ai-profile"
  retention_in_days = 30
}

# Its own role rather than the match-analysis one. That role grants ai-cache/* for
# writing, which would let this function overwrite a stored match insight, and it
# has no reason to read stats/. Widening the live function's role to cover this
# one's needs would trade a working permission set for a broader one.
resource "aws_iam_role" "ai_profile" {
  count              = local.ai_profile_enabled
  name               = "${var.project_name}-ai-profile-exec-role"
  assume_role_policy = aws_iam_role.lambda_exec.assume_role_policy
}

resource "aws_iam_role_policy_attachment" "ai_profile_logs" {
  count      = local.ai_profile_enabled
  role       = aws_iam_role.ai_profile[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "ai_profile" {
  count = local.ai_profile_enabled
  role  = aws_iam_role.ai_profile[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # stats/ holds the published aggregates the benchmark and lifetime figures
      # are quoted from; it is read-only here and the match-analysis function
      # never needed it.
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = ["${aws_s3_bucket.replay_data.arn}/parsed/*", "${aws_s3_bucket.replay_data.arn}/stats/*", "${aws_s3_bucket.replay_data.arn}/ai-cache/profile/*"]
      },
      # Scoped to ai-cache/profile/ so a bug in this function cannot overwrite a
      # stored match insight or item analysis.
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = "${aws_s3_bucket.replay_data.arn}/ai-cache/profile/*"
      },
      {
        Effect   = "Allow"
        Action   = ["ssm:GetParameter"]
        Resource = concat([var.openrouter_key_parameter_arn], var.langfuse_enabled ? [var.langfuse_secret_key_parameter_arn] : [])
      },
      # Shared with the match-analysis function on purpose: one hourly counter per
      # client across both AI surfaces, so neither can be used to route around the
      # other when the provider's monthly limit is nearly spent.
      {
        Effect   = "Allow"
        Action   = ["dynamodb:UpdateItem"]
        Resource = aws_dynamodb_table.ai_rate[0].arn
      }
    ]
  })
}

# No s3:ListBucket anywhere above. The window is selected from the published
# matches.json index, so the function reads the objects it needs by key and never
# enumerates the bucket.
resource "aws_lambda_function" "ai_profile" {
  count            = local.ai_profile_enabled
  function_name    = "${var.project_name}-ai-profile"
  role             = aws_iam_role.ai_profile[0].arn
  runtime          = "python3.13"
  handler          = "profile_handler.lambda_handler"
  filename         = data.archive_file.ai_profile[0].output_path
  source_code_hash = data.archive_file.ai_profile[0].output_base64sha256
  timeout          = var.langfuse_enabled ? 45 : 30
  memory_size      = 256
  layers           = var.langfuse_enabled ? [aws_lambda_layer_version.langfuse[0].arn] : []
  # Declared before the first invocation so CloudWatch does not create the group
  # itself with no retention, which is what happened to dota-replay-ai.
  depends_on = [aws_cloudwatch_log_group.ai_profile]
  environment {
    variables = {
      REPLAY_BUCKET                   = aws_s3_bucket.replay_data.bucket
      OPENROUTER_KEY_PARAMETER        = var.openrouter_key_parameter_arn
      OPENROUTER_MODEL                = var.openrouter_model
      AI_RATE_TABLE                   = aws_dynamodb_table.ai_rate[0].name
      AI_PROFILE_ENABLED              = "true"
      LANGFUSE_PUBLIC_KEY             = var.langfuse_enabled ? var.langfuse_public_key : ""
      LANGFUSE_SECRET_KEY_PARAMETER   = var.langfuse_enabled ? var.langfuse_secret_key_parameter_arn : ""
      LANGFUSE_BASE_URL               = var.langfuse_base_url
      LANGFUSE_TRACING_ENVIRONMENT    = "production"
      LANGFUSE_CAPTURE_PROFILE_OUTPUT = var.langfuse_enabled && var.langfuse_capture_profile_output ? "true" : "false"
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

resource "aws_apigatewayv2_integration" "ai_profile" {
  count                  = local.ai_profile_enabled
  api_id                 = aws_apigatewayv2_api.ai[0].id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.ai_profile[0].invoke_arn
  payload_format_version = "2.0"
}

# Explicit routes on the existing API. A specific route_key takes precedence over
# the $default route that already carries every match-analysis request, so adding
# these cannot change how the live function is reached.
resource "aws_apigatewayv2_route" "ai_profile" {
  for_each   = local.ai_profile_enabled == 1 ? toset(["GET", "POST", "OPTIONS"]) : toset([])
  api_id     = aws_apigatewayv2_api.ai[0].id
  route_key  = "${each.value} /players/{account_id}/profile"
  target     = "integrations/${aws_apigatewayv2_integration.ai_profile[0].id}"
  depends_on = [aws_apigatewayv2_route.ai]
}

resource "aws_lambda_permission" "ai_profile" {
  count         = local.ai_profile_enabled
  statement_id  = "AllowApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ai_profile[0].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.ai[0].execution_arn}/*/*"
}

output "ai_profile_enabled" {
  description = "Whether the player profile route is deployed on the AI API."
  value       = local.ai_profile_enabled == 1
}
