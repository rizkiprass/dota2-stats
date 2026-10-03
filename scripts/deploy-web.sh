#!/usr/bin/env bash
#
# Build the React dashboard and deploy it to the S3 website bucket, then
# invalidate the CloudFront paths that changed.
#
# The static build lives in web/dist/. Assets are uploaded with a long-lived
# immutable cache (they are content-hashed), while index.html is uploaded with
# no-cache so new builds are picked up immediately. stats.json is never touched
# here: it is owned and written by the aggregator Lambda.
#
# Examples:
#   scripts/deploy-web.sh --dry-run          # show the plan, change nothing
#   scripts/deploy-web.sh                    # build + deploy + invalidate
#   scripts/deploy-web.sh --skip-build       # deploy the existing web/dist/
#   scripts/deploy-web.sh --wait             # wait for the invalidation to finish
#
# Bucket and CloudFront distribution are read from `terraform output` when not
# supplied; --bucket / --distribution-id override that.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

WEB_DIR="${WEB_DIR:-$REPO_ROOT/web}"
TF_DIR="${TF_DIR:-$REPO_ROOT/terraform}"
BUCKET="${DASHBOARD_BUCKET:-}"
DIST_ID="${CLOUDFRONT_DISTRIBUTION_ID:-}"
PROFILE="${AWS_PROFILE_NAME:-pras-sandbox}"
REGION="${AWS_REGION_NAME:-us-east-1}"
DRY_RUN=false
SKIP_BUILD=false
WAIT=false

usage() {
  cat <<'EOF'
Build and deploy the Dota 2 lobby stats dashboard (web/) to S3 + CloudFront.

Steps: npm run build -> s3 sync (assets) -> s3 cp index.html -> CloudFront
invalidation. stats.json is left untouched.

Options:
  -b, --bucket NAME            Dashboard S3 bucket (default: terraform output)
  -d, --distribution-id ID     CloudFront distribution ID (default: terraform output)
  -p, --profile NAME           AWS CLI profile
  -r, --region NAME            AWS region
      --web-dir DIR            Frontend directory (default: <repo>/web)
      --tf-dir DIR             Terraform directory (default: <repo>/terraform)
      --skip-build             Deploy the existing web/dist/ without rebuilding
  -w, --wait                   Wait for the CloudFront invalidation to complete
  -n, --dry-run                Print the plan without uploading anything
  -h, --help                   Show this help

Environment overrides: DASHBOARD_BUCKET, CLOUDFRONT_DISTRIBUTION_ID,
AWS_PROFILE_NAME, AWS_REGION_NAME, WEB_DIR, TF_DIR
EOF
}

die() { echo "error: $*" >&2; exit 1; }

# ---- parse args ----
while [[ $# -gt 0 ]]; do
  case "$1" in
    -b|--bucket)          BUCKET="${2:?--bucket needs a value}"; shift 2 ;;
    -d|--distribution-id) DIST_ID="${2:?--distribution-id needs a value}"; shift 2 ;;
    -p|--profile)         PROFILE="${2:?--profile needs a value}"; shift 2 ;;
    -r|--region)          REGION="${2:?--region needs a value}"; shift 2 ;;
    --web-dir)            WEB_DIR="${2:?--web-dir needs a value}"; shift 2 ;;
    --tf-dir)             TF_DIR="${2:?--tf-dir needs a value}"; shift 2 ;;
    --skip-build)         SKIP_BUILD=true; shift ;;
    -w|--wait)            WAIT=true; shift ;;
    -n|--dry-run)         DRY_RUN=true; shift ;;
    -h|--help)            usage; exit 0 ;;
    -*)                   die "unknown option: $1 (try --help)" ;;
    *)                    die "unexpected argument: $1 (try --help)" ;;
  esac
done

command -v aws >/dev/null 2>&1 || die "aws CLI not found on PATH"

# ---- fill in bucket / distribution from terraform when not provided ----
tf_output() {
  command -v terraform >/dev/null 2>&1 || return 1
  [[ -d "$TF_DIR" ]] || return 1
  terraform -chdir="$TF_DIR" output -raw "$1" 2>/dev/null
}

if [[ -z "$BUCKET" ]]; then
  BUCKET="$(tf_output dashboard_bucket_name || true)"
fi
[[ -n "$BUCKET" ]] || die "dashboard bucket unknown; pass --bucket or set DASHBOARD_BUCKET"

if [[ -z "$DIST_ID" ]]; then
  DIST_ID="$(tf_output dashboard_cloudfront_distribution_id || true)"
fi
[[ -n "$DIST_ID" ]] || die "CloudFront distribution ID unknown; pass --distribution-id or set CLOUDFRONT_DISTRIBUTION_ID"

DIST="$WEB_DIR/dist"
[[ -d "$WEB_DIR" ]] || die "web directory not found: $WEB_DIR"

echo "web dir        : $WEB_DIR"
echo "bucket         : s3://$BUCKET"
echo "distribution   : $DIST_ID"
echo "profile/region : $PROFILE / $REGION"
[[ "$SKIP_BUILD" == true ]] && echo "build          : skipped (using existing $DIST)"
[[ "$DRY_RUN" == true ]] && echo "mode           : DRY RUN (nothing will be uploaded)"
echo

# ---- 1. build ----
if [[ "$SKIP_BUILD" == false ]]; then
  command -v npm >/dev/null 2>&1 || die "npm not found on PATH (use --skip-build to deploy an existing build)"
  echo "==> building (npm run build)"
  if [[ "$DRY_RUN" == true ]]; then
    echo "    (dry run) cd \"$WEB_DIR\" && npm run build"
  else
    ( cd "$WEB_DIR" && npm run build )
  fi
fi
[[ -f "$DIST/index.html" ]] || die "build output missing: $DIST/index.html (run without --skip-build)"

echo "==> syncing assets (stats.json and index.html are preserved)"
SYNC_ARGS=(
  s3 sync "$DIST/" "s3://$BUCKET/"
  --exclude "stats.json"
  --exclude "index.html"
  --delete
  --cache-control "public, max-age=31536000, immutable"
  --profile "$PROFILE" --region "$REGION"
)
[[ "$DRY_RUN" == true ]] && SYNC_ARGS+=(--dryrun)
aws "${SYNC_ARGS[@]}"

echo "==> uploading index.html (no-cache)"
CP_ARGS=(
  s3 cp "$DIST/index.html" "s3://$BUCKET/index.html"
  --cache-control "no-cache"
  --profile "$PROFILE" --region "$REGION"
)
[[ "$DRY_RUN" == true ]] && CP_ARGS+=(--dryrun)
aws "${CP_ARGS[@]}"

# ---- 2. invalidate the mutable entrypoints and hashed assets ----
PATHS=(/index.html / /assets/*)
if [[ "$DRY_RUN" == true ]]; then
  echo "==> (dry run) would invalidate: ${PATHS[*]}"
  echo
  echo "dry run complete; nothing was uploaded."
  exit 0
fi

echo "==> creating CloudFront invalidation: ${PATHS[*]}"
INVALIDATION_ID="$(aws cloudfront create-invalidation \
  --distribution-id "$DIST_ID" \
  --paths "${PATHS[@]}" \
  --profile "$PROFILE" \
  --query 'Invalidation.Id' --output text)"
echo "    invalidation id: $INVALIDATION_ID"

if [[ "$WAIT" == true ]]; then
  echo "==> waiting for invalidation to complete..."
  aws cloudfront wait invalidation-completed \
    --distribution-id "$DIST_ID" --id "$INVALIDATION_ID" \
    --profile "$PROFILE"
  echo "    invalidation completed"
fi

DASHBOARD_URL="$(tf_output dashboard_custom_url || true)"
[[ -n "$DASHBOARD_URL" && "$DASHBOARD_URL" != "null" ]] || DASHBOARD_URL="$(tf_output dashboard_url || true)"

echo
echo "deployed to s3://$BUCKET (distribution $DIST_ID)"
[[ -n "$DASHBOARD_URL" && "$DASHBOARD_URL" != "null" ]] && echo "url: $DASHBOARD_URL"
