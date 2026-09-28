# S3 bucket for raw replays (raw/*.dem) and parsed results (parsed/*.json).
# The .dem replay is always retained as the raw source of truth (plan Section 5).

resource "aws_s3_bucket" "replay_data" {
  bucket = var.bucket_name
}

resource "aws_s3_bucket_versioning" "replay_data" {
  bucket = aws_s3_bucket.replay_data.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "replay_data" {
  bucket = aws_s3_bucket.replay_data.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "replay_data" {
  bucket = aws_s3_bucket.replay_data.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Grants S3 permission to invoke the parser Lambda.
resource "aws_lambda_permission" "allow_s3_invoke" {
  statement_id  = "AllowS3InvokeParser"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.replay_parser.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.replay_data.arn
}

# Grants S3 permission to invoke the aggregation Lambda for parsed JSON only.
resource "aws_lambda_permission" "allow_s3_invoke_aggregator" {
  statement_id  = "AllowS3InvokeAggregator"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.statistics_aggregator.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.replay_data.arn
}

# Each filter is disjoint: raw uploads invoke the parser and parsed JSON invokes
# the full-rebuild aggregator. stats/stats.json cannot recursively invoke either.
resource "aws_s3_bucket_notification" "replay_upload" {
  bucket = aws_s3_bucket.replay_data.id

  lambda_function {
    lambda_function_arn = aws_lambda_function.replay_parser.arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = "raw/"
    filter_suffix       = ".dem"
  }

  lambda_function {
    lambda_function_arn = aws_lambda_function.statistics_aggregator.arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = "parsed/"
    filter_suffix       = ".json"
  }

  depends_on = [
    aws_lambda_permission.allow_s3_invoke,
    aws_lambda_permission.allow_s3_invoke_aggregator,
  ]
}
