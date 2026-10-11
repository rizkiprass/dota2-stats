#!/usr/bin/env bash
#
# Fetch the live stats.json so the built dashboard can be verified locally.
#
# `vite preview` serves `web/dist/`, which never contains stats.json (the
# aggregator writes it to S3 at deploy time). Without a real file the SPA
# fallback returns index.html for /stats.json and the app shows a connection
# error. Run this after `npm run build` and before the Playwright UI tests.
#
# Examples:
#   scripts/fetch-stats.sh
#   scripts/fetch-stats.sh --url https://dls.rpras.my.id
#   scripts/fetch-stats.sh --out /tmp/stats.json
#   scripts/fetch-stats.sh --dry-run
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TF_DIR="${TF_DIR:-$REPO_ROOT/terraform}"

SRC_URL="${STATS_URL:-}"
OUT="${STATS_OUT:-$REPO_ROOT/web/dist/stats.json}"
DRY_RUN=false

usage() {
  cat <<'EOF'
Fetch the live stats.json into web/dist/ for local UI verification.

Options:
  -u, --url URL   Base URL to fetch from (default: terraform dashboard_custom_url,
                  then dashboard_url)
  -o, --out PATH  Output file (default: <repo>/web/dist/stats.json)
  -n, --dry-run   Print the plan without downloading
  -h, --help      Show this help

Environment overrides: STATS_URL, STATS_OUT, TF_DIR
EOF
}

die() { echo "error: $*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    -u|--url)     SRC_URL="${2:?--url needs a value}"; shift 2 ;;
    -o|--out)     OUT="${2:?--out needs a value}"; shift 2 ;;
    -n|--dry-run) DRY_RUN=true; shift ;;
    -h|--help)    usage; exit 0 ;;
    *)            die "unknown option: $1 (try --help)" ;;
  esac
done

command -v curl >/dev/null 2>&1 || die "curl not found on PATH"

# ---- resolve the base URL from terraform when not supplied ----
tf_output() {
  command -v terraform >/dev/null 2>&1 || return 1
  [[ -d "$TF_DIR" ]] || return 1
  terraform -chdir="$TF_DIR" output -raw "$1" 2>/dev/null
}

if [[ -z "$SRC_URL" ]]; then
  SRC_URL="$(tf_output dashboard_custom_url || true)"
  [[ -n "$SRC_URL" && "$SRC_URL" != "null" ]] || SRC_URL="$(tf_output dashboard_url || true)"
fi
[[ -n "$SRC_URL" && "$SRC_URL" != "null" ]] || die "base URL unknown; pass --url or set STATS_URL"
SRC_URL="${SRC_URL%/}"

echo "source : $SRC_URL/stats.json"
echo "out    : $OUT"
[[ "$DRY_RUN" == true ]] && echo "mode   : DRY RUN"
echo

if [[ "$DRY_RUN" == true ]]; then
  echo "dry run complete; nothing downloaded."
  exit 0
fi

mkdir -p "$(dirname "$OUT")"
curl -fsSL "$SRC_URL/stats.json" -o "$OUT"

# Fail loudly if the response was not valid JSON (e.g. an HTML error page).
command -v node >/dev/null 2>&1 || die "node not found (needed to validate the downloaded JSON)"
node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))' "$OUT" \
  || die "downloaded file is not valid JSON: $OUT"

echo "wrote $(wc -c <"$OUT" | tr -d ' ') bytes to $OUT"
