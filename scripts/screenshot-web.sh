#!/usr/bin/env bash
#
# Capture visual-review screenshots of the *live* dashboard.
#
# This is the verification step of the frontend workflow: after deploying,
# run this script and hand the PNGs to the `visual-reviewer` subagent. It does
# not build or deploy anything, and it never touches web/dist.
#
# Output (default /tmp/opencode/shots/):
#   dashboard-desktop.png   1440px wide, "/"
#   dashboard-mobile.png     360px wide, "/"
#   player-desktop.png      1440px wide, "/player/<id>"
#
# Examples:
#   scripts/screenshot-web.sh
#   scripts/screenshot-web.sh --url https://dls.rpras.my.id
#   scripts/screenshot-web.sh --out /tmp/opencode/shots/fase3
#   scripts/screenshot-web.sh --dry-run
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TF_DIR="${TF_DIR:-$REPO_ROOT/terraform}"

BASE_URL="${SCREENSHOT_URL:-}"
OUT_DIR="${SCREENSHOT_OUT:-/tmp/opencode/shots}"
DRY_RUN=false
DESKTOP_SIZE="1440,2400"
MOBILE_SIZE="360,2400"
BUDGET_MS=9000

usage() {
  cat <<'EOF'
Capture screenshots of the live dashboard for visual review.

Options:
  -u, --url URL       Base URL to capture (default: terraform dashboard_custom_url,
                      then dashboard_url)
  -o, --out DIR       Output directory (default: /tmp/opencode/shots)
      --desktop SIZE  Desktop window size WxH or W,H (default 1440,2400)
      --mobile SIZE   Mobile window size (default 360,2400)
  -n, --dry-run       Print the commands without capturing
  -h, --help          Show this help

Environment overrides: SCREENSHOT_URL, SCREENSHOT_OUT, TF_DIR
EOF
}

die() { echo "error: $*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    -u|--url)      BASE_URL="${2:?--url needs a value}"; shift 2 ;;
    -o|--out)      OUT_DIR="${2:?--out needs a value}"; shift 2 ;;
    --desktop)     DESKTOP_SIZE="${2:?--desktop needs a value}"; shift 2 ;;
    --mobile)      MOBILE_SIZE="${2:?--mobile needs a value}"; shift 2 ;;
    -n|--dry-run)  DRY_RUN=true; shift ;;
    -h|--help)     usage; exit 0 ;;
    *)             die "unknown option: $1 (try --help)" ;;
  esac
done

# ---- locate a headless-capable Chrome ----
CHROME=""
for candidate in google-chrome google-chrome-stable chromium chromium-browser; do
  if command -v "$candidate" >/dev/null 2>&1; then CHROME="$(command -v "$candidate")"; break; fi
done
[[ -n "$CHROME" ]] || die "no Chrome/Chromium found on PATH"

# ---- resolve the base URL from terraform when not supplied ----
tf_output() {
  command -v terraform >/dev/null 2>&1 || return 1
  [[ -d "$TF_DIR" ]] || return 1
  terraform -chdir="$TF_DIR" output -raw "$1" 2>/dev/null
}

if [[ -z "$BASE_URL" ]]; then
  BASE_URL="$(tf_output dashboard_custom_url || true)"
  [[ -n "$BASE_URL" && "$BASE_URL" != "null" ]] || BASE_URL="$(tf_output dashboard_url || true)"
fi
[[ -n "$BASE_URL" && "$BASE_URL" != "null" ]] || die "base URL unknown; pass --url or set SCREENSHOT_URL"
BASE_URL="${BASE_URL%/}"

command -v node >/dev/null 2>&1 || die "node not found (needed to read a player id from stats.json)"

# ---- find one player id for the profile route ----
PLAYER_ID="$(curl -fsSL "$BASE_URL/stats.json" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(Object.keys(j.players||{})[0]||"")}catch{console.log("")}})' \
  || true)"

capture() {
  local size="$1" url="$2" out="$3"
  if [[ "$DRY_RUN" == true ]]; then
    echo "  (dry run) $CHROME --headless=new --window-size=$size --screenshot=$out $url"
    return
  fi
  "$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
    --force-device-scale-factor=1 --force-prefers-reduced-motion \
    --window-size="$size" --virtual-time-budget="$BUDGET_MS" \
    --screenshot="$out" "$url"
}

echo "chrome : $CHROME"
echo "base   : $BASE_URL"
echo "out    : $OUT_DIR"
[[ -n "$PLAYER_ID" ]] && echo "player : $PLAYER_ID" || echo "player : (none found)"
[[ "$DRY_RUN" == true ]] && echo "mode   : DRY RUN"
echo

[[ "$DRY_RUN" == true ]] || mkdir -p "$OUT_DIR"

echo "==> dashboard desktop ($DESKTOP_SIZE)"
capture "$DESKTOP_SIZE" "$BASE_URL/" "$OUT_DIR/dashboard-desktop.png"

echo "==> dashboard mobile ($MOBILE_SIZE)"
capture "$MOBILE_SIZE" "$BASE_URL/" "$OUT_DIR/dashboard-mobile.png"

if [[ -n "$PLAYER_ID" ]]; then
  echo "==> player profile desktop ($DESKTOP_SIZE)"
  capture "$DESKTOP_SIZE" "$BASE_URL/player/$PLAYER_ID" "$OUT_DIR/player-desktop.png"
fi

if [[ "$DRY_RUN" == true ]]; then
  echo
  echo "dry run complete; nothing captured."
  exit 0
fi

echo
echo "screenshots:"
ls -1 "$OUT_DIR"/*.png 2>/dev/null || die "no screenshots were produced"
