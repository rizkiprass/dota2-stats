# Least-privilege IAM role for the Lambda function: S3 read/write scoped to
# this bucket's raw/ and parsed/ prefixes, plus CloudWatch Logs.
# ECR pull permissions for Lambda-managed container images are handled by AWS
# automatically via the Lambda service-linked access to the account's ECR
# repositories referenced by the function; no extra ECR IAM policy is needed
# on the execution role itself.

resource "aws_iam_role" "lambda_exec" {
  name = "${var.project_name}-lambda-exec-role"

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

resource "aws_iam_role_policy" "lambda_s3" {
  name = "${var.project_name}-lambda-s3-access"
  role = aws_iam_role.lambda_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadRawReplays"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.replay_data.arn}/raw/*"
      },
      {
        Sid      = "WriteParsedResults"
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = "${aws_s3_bucket.replay_data.arn}/parsed/*"
      },
      {
        # Failure markers the upload API reads back to report a failed parse.
        Sid      = "WriteParseFailures"
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = "${aws_s3_bucket.replay_data.arn}/parse-failed/*"
      },
      {
        Sid      = "ListBucket"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.replay_data.arn
        Condition = {
          StringLike = {
            "s3:prefix" = ["raw/*", "parsed/*"]
          }
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_logs" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# The aggregator needs no raw replay access: it lists and reads parsed JSON,
# then writes only the single dashboard-ready object under stats/.
resource "aws_iam_role" "aggregator_lambda_exec" {
  name               = "${var.project_name}-aggregator-lambda-exec-role"
  assume_role_policy = aws_iam_role.lambda_exec.assume_role_policy
}

resource "aws_iam_role_policy" "aggregator_lambda_s3" {
  name = "${var.project_name}-aggregator-lambda-s3-access"
  role = aws_iam_role.aggregator_lambda_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadParsedMatches"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.replay_data.arn}/parsed/*"
      },
      {
        Sid      = "WriteAggregatedStatistics"
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = "${aws_s3_bucket.replay_data.arn}/stats/*"
      },
      {
        Sid      = "ListParsedMatches"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.replay_data.arn
        Condition = {
          StringLike = {
            "s3:prefix" = ["parsed/*"]
          }
        }
      },
      {
        Sid      = "PublishDashboardStats"
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = "${aws_s3_bucket.dashboard.arn}/*"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "aggregator_lambda_logs" {
  role       = aws_iam_role.aggregator_lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}
