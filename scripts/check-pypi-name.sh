#!/usr/bin/env bash
# check-pypi-name.sh — REL-02 pre-publish gate
#
# Verifies whether the PyPI project name is available OR already registered
# to the configured trusted publisher. Run BEFORE the first PyPI publish.
#
# Usage: bash scripts/check-pypi-name.sh [package-name]
# Default package-name: gemini-sdk (from python/pyproject.toml [project].name)
# Exit codes:
#   0 = name available OR already published (safe to publish / update)
#   1 = name taken by a DIFFERENT project owner (need fallback name)
#   2 = network failure

set -euo pipefail

NAME="${1:-gemini-sdk}"
URL="https://pypi.org/pypi/${NAME}/json"

if ! command -v curl >/dev/null 2>&1; then
  echo "ERROR: curl not found" >&2
  exit 2
fi

HTTP_CODE=$(curl -s -o /tmp/pypi-check-response.json -w "%{http_code}" "$URL" || echo "000")

case "$HTTP_CODE" in
  404)
    echo "OK: PyPI name '$NAME' is available (404 — not yet registered)"
    exit 0
    ;;
  200)
    echo "INFO: PyPI name '$NAME' is already registered"
    echo "Verify the 'info.author' / 'info.maintainer' fields below match this project:"
    if command -v python3 >/dev/null 2>&1; then
      python3 -c "import json,sys; d=json.load(open('/tmp/pypi-check-response.json')); print(' author:', d['info'].get('author')); print(' home_page:', d['info'].get('home_page')); print(' project_urls:', d['info'].get('project_urls'))"
    else
      grep -oE '"(author|home_page)": "[^"]*"' /tmp/pypi-check-response.json | head -5
    fi
    echo "If the existing project is NOT this one, fall back to 'gemini-cli-sdk' or another name."
    exit 0
    ;;
  000)
    echo "ERROR: network failure checking $URL" >&2
    exit 2
    ;;
  *)
    echo "WARNING: unexpected HTTP $HTTP_CODE from $URL" >&2
    exit 2
    ;;
esac
