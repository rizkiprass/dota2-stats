# Static statistics dashboard.
#
# A dedicated bucket (separate from the replay data bucket) serves the vanilla
# HTML/CSS/JS frontend as an S3 static website. The aggregator publishes a copy
# of stats.json here so the browser can fetch it from the same origin and the
# page never needs cross-bucket CORS or a public data bucket.

resource "aws_s3_bucket" "dashboard" {
  bucket = var.dashboard_bucket_name
}

# Public read is required for S3 static website hosting. The data bucket stays
# fully private; only this website bucket is readable.
resource "aws_s3_bucket_public_access_block" "dashboard" {
  bucket = aws_s3_bucket.dashboard.id

  block_public_acls       = true
  block_public_policy     = false
  ignore_public_acls      = true
  restrict_public_buckets = false
}

resource "aws_s3_bucket_website_configuration" "dashboard" {
  bucket = aws_s3_bucket.dashboard.id

  index_document {
    suffix = "index.html"
  }

  # Serve the app shell for unknown paths so client-side routing/refresh works.
  error_document {
    key = "index.html"
  }
}

resource "aws_s3_bucket_policy" "dashboard_public_read" {
  bucket = aws_s3_bucket.dashboard.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "PublicReadWebsite"
        Effect    = "Allow"
        Principal = "*"
        Action    = ["s3:GetObject"]
        Resource  = "${aws_s3_bucket.dashboard.arn}/*"
      }
    ]
  })

  depends_on = [aws_s3_bucket_public_access_block.dashboard]
}
