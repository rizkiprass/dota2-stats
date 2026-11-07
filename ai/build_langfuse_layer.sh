#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
build="$(mktemp -d)"
trap 'rm -rf "$build"' EXIT
python3 -m pip install --requirement "$root/ai/requirements-langfuse.txt" --target "$build/python" --platform manylinux2014_x86_64 --implementation cp --python-version 3.13 --only-binary=:all: --upgrade
rm -f "$root/terraform/langfuse-layer.zip"
(cd "$build" && zip -qr "$root/terraform/langfuse-layer.zip" python)
