#!/usr/bin/env bash
# scripts/lint-env-namespace.sh — ARC-09 enforcement.
# Fails if adapter-archon/src/** references any env var outside the
# GEMINI_* / GEMINI_SDK_* / platform-essential allowlist.
# Scope: adapter-archon/src/** only. SDK code (ts/src/**, python/src/**) is out of scope.
# Compat: macOS BSD grep (no -P). Git Bash on Windows. Use grep -E only.
#
# Override scope for self-testing via LINT_ENV_NS_SCOPE env var.
set -euo pipefail

SCOPE_DIR="${LINT_ENV_NS_SCOPE:-$(cd "$(dirname "$0")/.." && pwd)/adapter-archon/src}"

if [ ! -d "$SCOPE_DIR" ]; then
  echo "[lint-env-namespace] SKIP: $SCOPE_DIR does not exist yet."
  exit 0
fi

ALLOWLIST='^(GEMINI_|GEMINI_SDK_|PATH|HOME|USERPROFILE|TMPDIR|TEMP|TMP|NODE_ENV|DEBUG)'

NAMES=$(grep -rhE "process\.env\.[A-Z_]{3,}|process\.env\[['\"][A-Z_]{3,}['\"]\]" \
  "$SCOPE_DIR" --include="*.ts" 2>/dev/null \
  | grep -oE "[A-Z_]{3,}" \
  | sort -u || true)

BAD=$(echo "$NAMES" | grep -vE "$ALLOWLIST" || true)

if [ -n "${BAD// /}" ]; then
  echo "[lint-env-namespace] FAIL: non-namespaced env vars in $SCOPE_DIR:" >&2
  echo "$BAD" >&2
  echo "Allowed prefixes: GEMINI_*, GEMINI_SDK_*; platform: PATH, HOME, USERPROFILE, TMPDIR, TEMP, TMP, NODE_ENV, DEBUG." >&2
  exit 1
fi
echo "[lint-env-namespace] OK: all env-var references in $SCOPE_DIR are namespaced."
