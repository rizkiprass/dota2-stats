# Static statistics dashboard (React + Vite build).
#
# A private S3 bucket is fronted by CloudFront using Origin Access Control. The
# aggregator publishes a copy of stats.json here, so the browser fetches it
# same-origin. CloudFront also terminates TLS (HTTPS) and serves the SPA.

resource "aws_s3_bucket" "dashboard" {
  bucket = var.dashboard_bucket_name
}

# The bucket is private: only CloudFront may read it.
resource "aws_s3_bucket_public_access_block" "dashboard" {
  bucket = aws_s3_bucket.dashboard.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# AWS-managed cache policies.
data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

# Vite content-hashes every file in /assets, so it is safe to cache for a year.
resource "aws_cloudfront_cache_policy" "assets" {
  name        = "${var.project_name}-dashboard-assets"
  default_ttl = 31536000
  max_ttl     = 31536000
  min_ttl     = 31536000

  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "none"
    }
  }
}

resource "aws_cloudfront_origin_access_control" "dashboard" {
  name                              = "${var.project_name}-dashboard-oac"
  description                       = "OAC for the ${var.dashboard_bucket_name} dashboard bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_response_headers_policy" "dashboard" {
  name = "${var.project_name}-dashboard-security-headers"

  security_headers_config {
    content_type_options {
      override = true
    }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      preload                    = false
      override                   = true
    }
  }
}

resource "aws_cloudfront_distribution" "dashboard" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "Dota 2 lobby stats dashboard"
  default_root_object = "index.html"
  price_class         = "PriceClass_100"
  aliases             = var.dashboard_domain == "" ? [] : [var.dashboard_domain]

  origin {
    domain_name              = aws_s3_bucket.dashboard.bucket_regional_domain_name
    origin_id                = "s3-dashboard"
    origin_access_control_id = aws_cloudfront_origin_access_control.dashboard.id
  }

  # App shell and other files.
  default_cache_behavior {
    target_origin_id           = "s3-dashboard"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_optimized.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.dashboard.id
  }

  # Content-hashed build assets: cache for a year.
  ordered_cache_behavior {
    path_pattern               = "/assets/*"
    target_origin_id           = "s3-dashboard"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = aws_cloudfront_cache_policy.assets.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.dashboard.id
  }

  # Live data must never be served stale from the edge.
  ordered_cache_behavior {
    path_pattern               = "/stats.json"
    target_origin_id           = "s3-dashboard"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_disabled.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.dashboard.id
  }

  # The lazy per-match payload is live data too.
  ordered_cache_behavior {
    path_pattern               = "/matches.json"
    target_origin_id           = "s3-dashboard"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_disabled.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.dashboard.id
  }

  # SPA fallback: serve the app shell for client-side routes (history API).
  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }
  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = var.dashboard_domain == "" ? true : false
    acm_certificate_arn            = var.dashboard_domain == "" ? null : aws_acm_certificate.dashboard[0].arn
    ssl_support_method             = var.dashboard_domain == "" ? null : "sni-only"
    minimum_protocol_version       = var.dashboard_domain == "" ? null : "TLSv1.2_2021"
  }
}

# Only CloudFront (via this distribution) may read the bucket.
resource "aws_s3_bucket_policy" "dashboard" {
  bucket = aws_s3_bucket.dashboard.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowCloudFrontRead"
        Effect    = "Allow"
        Principal = { Service = "cloudfront.amazonaws.com" }
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.dashboard.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.dashboard.arn
          }
        }
      }
    ]
  })
}

# Custom-domain TLS certificate (us-east-1, required by CloudFront).
# Validation is DNS-based; the CNAME records are added in Cloudflare manually.
resource "aws_acm_certificate" "dashboard" {
  count             = var.dashboard_domain == "" ? 0 : 1
  provider          = aws.us_east_1
  domain_name       = var.dashboard_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}
