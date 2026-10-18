# Upload API: turns a browser file picker into a direct-to-S3 upload, with the
# duplicate check and the shared upload password enforced server-side.
#
# A ZIP Lambda behind an API Gateway HTTP API issues short-lived presigned S3
# POSTs for raw/<match_id>.dem. The replay bytes never pass through API Gateway
# or Lambda, so replay size is not bounded by the 10 MB payload limit.
#
# The parser and the aggregator keep their existing S3 event triggers: an
# accepted upload still runs the normal raw/ -> parsed/ -> stats/ pipeline.

data "archive_file" "upload_api" {
  type        = "zip"
  source_file = "${path.module}/../api/handler.py"
  output_path = "${path.module}/upload-api.zip"
}

resource "aws_cloudwatch_log_group" "upload_api" {
  name              = "/aws/lambda/${var.project_name}-upload-api"
  retention_in_days = 30
}

resource "aws_iam_role" "upload_api_exec" {
  name = "${var.project_name}-upload-api-exec-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

# HeadObject / GetObject are the duplicate check; PutObject on raw/* is what the
# presigned POST is signed against (S3 validates the signer's permission when
# the URL is used). The upload API never reads replay bytes.
resource "aws_iam_role_policy" "upload_api_s3" {
  name = "${var.project_name}-upload-api-s3-access"
  role = aws_iam_role.upload_api_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # Only the parse-failure marker is read directly; duplicates and status
        # come from a prefix listing, which carries the same metadata.
        Sid      = "ReadParseFailures"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.replay_data.arn}/parse-failed/*"
      },
      {
        Sid      = "ReadParsedSchema"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.replay_data.arn}/parsed/*"
      },
      {
        # A duplicate check is an exact-key prefix listing, so the role needs
        # ListBucket for the three prefixes the API inspects.
        Sid      = "ListReplayObjects"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.replay_data.arn
        Condition = {
          StringLike = {
            "s3:prefix" = ["raw/*", "parsed/*", "parse-failed/*"]
          }
        }
      },
      {
        Sid      = "AcceptReplayUploads"
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = "${aws_s3_bucket.replay_data.arn}/raw/*"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "upload_api_logs" {
  role       = aws_iam_role.upload_api_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "upload_api" {
  function_name = "${var.project_name}-upload-api"
  role          = aws_iam_role.upload_api_exec.arn
  runtime       = "python3.13"
  handler       = "handler.lambda_handler"
  filename      = data.archive_file.upload_api.output_path

  source_code_hash = data.archive_file.upload_api.output_base64sha256
  architectures    = ["x86_64"]
  memory_size      = 256
  timeout          = 15

  environment {
    variables = {
      REPLAY_BUCKET    = aws_s3_bucket.replay_data.bucket
      UPLOAD_TOKEN     = var.upload_token
      MAX_UPLOAD_BYTES = tostring(var.upload_api_max_upload_mb * 1024 * 1024)
      # Echo only the dashboard's own origins back, never an arbitrary site.
      ALLOWED_ORIGINS = join(",", compact([
        "https://${aws_cloudfront_distribution.dashboard.domain_name}",
        var.dashboard_domain == "" ? "" : "https://${var.dashboard_domain}",
      ]))
    }
  }

  depends_on = [
    aws_iam_role_policy.upload_api_s3,
    aws_iam_role_policy_attachment.upload_api_logs,
    aws_cloudwatch_log_group.upload_api,
  ]
}

resource "aws_apigatewayv2_api" "upload" {
  name          = "${var.project_name}-upload-api"
  protocol_type = "HTTP"
  description   = "Presigned replay upload endpoint for the Dota 2 lobby stats dashboard"
}

resource "aws_apigatewayv2_integration" "upload" {
  api_id                 = aws_apigatewayv2_api.upload.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.upload_api.invoke_arn
  payload_format_version = "2.0"
}

# One catch-all route: the Lambda dispatches on method + path and owns the CORS
# headers, including the OPTIONS preflight.
resource "aws_apigatewayv2_route" "upload_default" {
  api_id    = aws_apigatewayv2_api.upload.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.upload.id}"
}

resource "aws_apigatewayv2_stage" "upload" {
  api_id      = aws_apigatewayv2_api.upload.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = 20
    throttling_rate_limit  = 10
  }
}

resource "aws_lambda_permission" "upload_api_apigw" {
  statement_id  = "AllowAPIGatewayInvokeUploadApi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.upload_api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.upload.execution_arn}/*/*"
}
