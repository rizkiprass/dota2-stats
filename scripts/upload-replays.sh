#!/usr/bin/env bash
#
# Batch-upload Dota 2 replay files to the S3 raw/ prefix.
#
# Each '<match_id>.dem' file is uploaded as 'raw/<match_id>.dem', which is the
# exact key shape the S3 ObjectCreated trigger expects to invoke the parser
# Lambda. Files already present in raw/ are skipped unless --force is given.
#
# Examples:
#   scripts/upload-replays.sh --dry-run                 # show what would happen
#   scripts/upload-replays.sh                            # upload every missing replay
#   scripts/upload-replays.sh --latest 3                 # only the 3 newest files
#   scripts/upload-replays.sh --files a.dem b.dem        # only these files
#   scripts/upload-replays.sh --since 2026-09-28         # recorded on/after a date
#   scripts/upload-replays.sh --wait                     # upload, then wait for parsed output
#
set -euo pipefail

BUCKET="${S3_BUCKET:-dta-replay-data-rizkiprass-2026}"
PROFILE="${AWS_PROFILE_NAME:-pras-sandbox}"
REGION="${AWS_REGION_NAME:-us-east-1}"
SOURCE="${DOTA_REPLAY_DIR:-/data/SteamLibrary/steamapps/common/dota 2 beta/game/dota/replays}"
PREFIX="raw/"
DRY_RUN=false
FORCE=false
WAIT=false
LATEST=""
SINCE=""
declare -a FILES=()

usage() {
  cat <<'EOF'
Batch-upload Dota 2 replay files to the S3 raw/ prefix.

Each '<match_id>.dem' file is uploaded as 'raw/<match_id>.dem', the exact key
shape the S3 ObjectCreated trigger expects to invoke the parser Lambda. Files
already present in raw/ are skipped unless --force is given.

Examples:
  scripts/upload-replays.sh --dry-run              # show what would happen
  scripts/upload-replays.sh                         # upload every missing replay
  scripts/upload-replays.sh --latest 3              # only the 3 newest files
  scripts/upload-replays.sh --files a.dem b.dem     # only these files
  scripts/upload-replays.sh --since 2026-09-28      # recorded on/after a date
  scripts/upload-replays.sh --wait                  # upload, then await parsed output

Options:
  -s, --source DIR     Directory to scan for .dem files
  -b, --bucket NAME    Target S3 bucket
  -p, --profile NAME   AWS CLI profile
  -r, --region NAME    AWS region
  -f, --files F...     Explicit .dem files (overrides --source scan)
      --latest N       Only the N most recently modified replays
      --since DATE     Only replays modified on/after DATE (YYYY-MM-DD)
  -F, --force          Re-upload even if raw/<match_id>.dem already exists
  -w, --wait           After upload, wait for parsed/<match_id>.json to appear
  -n, --dry-run        Print the plan without uploading anything
  -h, --help           Show this help

Environment overrides: S3_BUCKET, AWS_PROFILE_NAME, AWS_REGION_NAME, DOTA_REPLAY_DIR
EOF
}

die() { echo "error: $*" >&2; exit 1; }

# ---- parse args (supports "--files a b c" and positional files) ----
while [[ $# -gt 0 ]]; do
  case "$1" in
    -s|--source)   SOURCE="${2:?--source needs a value}"; shift 2 ;;
    -b|--bucket)   BUCKET="${2:?--bucket needs a value}"; shift 2 ;;
    -p|--profile)  PROFILE="${2:?--profile needs a value}"; shift 2 ;;
    -r|--region)   REGION="${2:?--region needs a value}"; shift 2 ;;
    --latest)      LATEST="${2:?--latest needs a value}"; shift 2 ;;
    --since)       SINCE="${2:?--since needs a value}"; shift 2 ;;
    -f|--files)    shift; while [[ $# -gt 0 && "$1" != -* ]]; do FILES+=("$1"); shift; done ;;
    -F|--force)    FORCE=true; shift ;;
    -w|--wait)     WAIT=true; shift ;;
    -n|--dry-run)  DRY_RUN=true; shift ;;
    -h|--help)     usage; exit 0 ;;
    -*)            die "unknown option: $1 (try --help)" ;;
    *)             FILES+=("$1"); shift ;;
  esac
done

command -v aws >/dev/null 2>&1 || die "aws CLI not found on PATH"
[[ -n "$BUCKET" ]] || die "bucket name is empty"

# ---- assemble the candidate list ----
if [[ ${#FILES[@]} -gt 0 ]]; then
  for f in "${FILES[@]}"; do [[ -f "$f" ]] || die "file not found: $f"; done
else
  [[ -d "$SOURCE" ]] || die "source directory not found: $SOURCE (use --source)"
  mapfile -t FILES < <(
    find "$SOURCE" -maxdepth 1 -type f -iname '*.dem' \
      ${SINCE:+-newermt "$SINCE"} -printf '%T@\t%p\n' \
      | sort -rn | cut -f2-
  )
  [[ ${#FILES[@]} -gt 0 ]] || die "no .dem files found in: $SOURCE"
  if [[ -n "$LATEST" ]]; then
    [[ "$LATEST" =~ ^[0-9]+$ ]] || die "--latest needs a positive integer"
    FILES=("${FILES[@]:0:$LATEST}")
  fi
fi

echo "bucket : s3://$BUCKET"
echo "profile: $PROFILE   region: $REGION"
echo "candidates: ${#FILES[@]} file(s)"
[[ "$DRY_RUN" == true ]] && echo "mode   : DRY RUN (nothing will be uploaded)"
echo

# ---- fetch the set of existing raw/ keys once ----
declare -A EXISTING=()
declare -A PREV_PARSED=()
if [[ "$FORCE" == false ]]; then
  while IFS= read -r key; do
    [[ -n "$key" ]] && EXISTING["$key"]=1
  done < <(aws s3api list-objects-v2 \
              --bucket "$BUCKET" --prefix "$PREFIX" \
              --query 'Contents[].Key' --output text \
              --profile "$PROFILE" --region "$REGION" 2>/dev/null \
            | tr '\t' '\n')
fi

uploaded=(); skipped=(); failed=()

for file in "${FILES[@]}"; do
  base="$(basename "$file")"
  match_id="${base%.dem}"

  if [[ ! "$match_id" =~ ^[0-9]+$ ]]; then
    echo "SKIP  $base  (filename is not <match_id>.dem)"; skipped+=("$base"); continue
  fi

  key="${PREFIX}${match_id}.dem"
  if [[ "$FORCE" == false && -n "${EXISTING[$key]:-}" ]]; then
    echo "SKIP  $base  (already in s3://$BUCKET/$key)"; skipped+=("$base"); continue
  fi

  size="$(du -h "$file" | cut -f1)"
  if [[ "$DRY_RUN" == true ]]; then
    echo "PLAN  $base  -> $key  ($size)"; uploaded+=("$match_id"); continue
  fi

  echo "UPLOAD $base -> $key  ($size)"
  if [[ "$WAIT" == true ]]; then
    PREV_PARSED["$match_id"]="$(aws s3api head-object --bucket "$BUCKET" --key "parsed/${match_id}.json" \
      --profile "$PROFILE" --region "$REGION" --query LastModified --output text 2>/dev/null || true)"
  fi
  if aws s3 cp "$file" "s3://$BUCKET/$key" \
       --profile "$PROFILE" --region "$REGION" --only-show-errors; then
    uploaded+=("$match_id")
  else
    echo "FAIL  $base" >&2; failed+=("$base")
  fi
done

echo
echo "done: ${#uploaded[@]} uploaded, ${#skipped[@]} skipped, ${#failed[@]} failed"

# ---- optionally wait for the parser+aggregator to produce parsed output ----
if [[ "$WAIT" == true && "$DRY_RUN" == false && ${#uploaded[@]} -gt 0 ]]; then
  echo
  echo "waiting for parsed/*.json to be (re)written (parser ~30-90s per replay)..."
  for match_id in "${uploaded[@]}"; do
    prev="${PREV_PARSED[$match_id]:-}"
    ready=false
    for _ in $(seq 1 120); do
      cur="$(aws s3api head-object --bucket "$BUCKET" --key "parsed/${match_id}.json" \
        --profile "$PROFILE" --region "$REGION" --query LastModified --output text 2>/dev/null || true)"
      if [[ -n "$cur" && "$cur" != "$prev" ]]; then
        echo "  parsed/${match_id}.json ready ($cur)"; ready=true; break
      fi
      sleep 10
    done
    [[ "$ready" == true ]] || echo "  timed out waiting for parsed/${match_id}.json" >&2
  done
  echo "check stats/stats.json for the updated aggregate."
fi

[[ ${#failed[@]} -eq 0 ]]
