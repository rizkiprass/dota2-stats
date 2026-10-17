#!/usr/bin/env bash
#
# Capture a dashboard screenshot through the Orca browser for visual review.
#
# Opens (or reuses) a tab at the given URL, captures the viewport, and writes a
# PNG ready to hand to the `visual-reviewer` agent. This replaces the old
# headless-Chrome screenshot script; Playwright (`npm run test:ui` in web/) still
# owns the automated assertions.
#
# The Orca browser is resized through the Orca app itself, so a "mobile" capture
# is whatever the Orca browser pane currently shows; use Playwright's viewport
# emulation when an exact width is required.
#
# Examples:
#   scripts/orca-shot.sh --url http://localhost:4173
#   scripts/orca-shot.sh --url https://dls.rpras.my.id --out /tmp/opencode/shots/dash.png
#   scripts/orca-shot.sh --page <browserPageId> --out /tmp/opencode/shots/dash.png
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TF_DIR="${TF_DIR:-$REPO_ROOT/terraform}"

URL="${ORCA_SHOT_URL:-}"
OUT="${ORCA_SHOT_OUT:-/tmp/opencode/shots/dashboard.png}"
PAGE="${ORCA_SHOT_PAGE:-}"
FORMAT="png"

usage() {
  cat <<'EOF'
Capture a dashboard screenshot through the Orca browser.

Options:
  -u, --url URL     Open this URL in a new tab before capturing (default:
                    terraform dashboard_custom_url, then dashboard_url)
  -o, --out PATH    Output PNG path (default: /tmp/opencode/shots/dashboard.png)
  -p, --page ID     Capture an existing tab by browserPageId instead of opening one
      --format FMT  png or jpeg (default: png)
  -h, --help        Show this help

Environment overrides: ORCA_SHOT_URL, ORCA_SHOT_OUT, ORCA_SHOT_PAGE, TF_DIR
EOF
}

die() { echo "error: $*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    -u|--url)    URL="${2:?--url needs a value}"; shift 2 ;;
    -o|--out)    OUT="${2:?--out needs a value}"; shift 2 ;;
    -p|--page)   PAGE="${2:?--page needs a value}"; shift 2 ;;
    --format)    FORMAT="${2:?--format needs a value}"; shift 2 ;;
    -h|--help)   usage; exit 0 ;;
    *)           die "unknown option: $1 (try --help)" ;;
  esac
done

case "$FORMAT" in png|jpeg) ;; *) die "invalid --format: $FORMAT (png or jpeg)" ;; esac

command -v node >/dev/null 2>&1 || die "node not found (needed to decode the screenshot)"

# ---- resolve the Orca CLI (ORCA_CLI_COMMAND wins, then the WSL shim) ----
ORCA=""
for candidate in "${ORCA_CLI_COMMAND:-}" orca-ide orca; do
  [[ -n "$candidate" ]] || continue
  if command -v "$candidate" >/dev/null 2>&1; then ORCA="$candidate"; break; fi
done
[[ -n "$ORCA" ]] || die "Orca CLI not found (set ORCA_CLI_COMMAND or put orca-ide on PATH)"

# ---- resolve the base URL from terraform when opening a new tab ----
tf_output() {
  command -v terraform >/dev/null 2>&1 || return 1
  [[ -d "$TF_DIR" ]] || return 1
  terraform -chdir="$TF_DIR" output -raw "$1" 2>/dev/null
}

if [[ -z "$PAGE" ]]; then
  if [[ -z "$URL" ]]; then
    URL="$(tf_output dashboard_custom_url || true)"
    [[ -n "$URL" && "$URL" != "null" ]] || URL="$(tf_output dashboard_url || true)"
  fi
  [[ -n "$URL" && "$URL" != "null" ]] || die "URL unknown; pass --url or set ORCA_SHOT_URL"

  echo "==> opening tab: $URL"
  PAGE="$("$ORCA" tab create --url "$URL" --json \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);process.stdout.write((j.result&&j.result.browserPageId)||"")})')"
  [[ -n "$PAGE" ]] || die "could not open an Orca browser tab"
fi

echo "orca   : $ORCA"
echo "page   : $PAGE"
echo "out    : $OUT"
echo "format : $FORMAT"

mkdir -p "$(dirname "$OUT")"

"$ORCA" screenshot --format "$FORMAT" --page "$PAGE" --json \
  | node -e '
const fs = require("node:fs");
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  let j;
  try { j = JSON.parse(s); } catch { console.error("invalid screenshot JSON"); process.exit(1); }
  const r = j.result || {};
  if (!r.data) { console.error("screenshot response carried no image data"); process.exit(1); }
  fs.writeFileSync(process.argv[1], Buffer.from(r.data, "base64"));
});
' "$OUT"

[[ -s "$OUT" ]] || die "screenshot file is empty: $OUT"
echo "wrote $(wc -c <"$OUT" | tr -d ' ') bytes to $OUT"
