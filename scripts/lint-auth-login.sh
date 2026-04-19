#!/usr/bin/env bash
# scripts/lint-auth-login.sh — AUT-05 + Phase 6 SC-4 enforcement.
# Fails if the literal string 'auth login' appears in ts/src or python/src.
# Scope is source-only: tests and docs may legitimately mention 'auth login' in
# prohibition prose (e.g. "SDK NEVER calls auth login"). See .planning/phases/
# 06-auth-environment/06-CONTEXT.md §"ADC pickup + AUT-09 + CI linter" for rationale.
#
# Compat: macOS BSD grep (no -P). Git Bash on Windows. Use grep -E only.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Source-only scope
matches="$(grep -rn 'auth login' ts/src python/src 2>/dev/null || true)"
if [ -n "$matches" ]; then
  echo "[lint-auth-login] FAIL: 'auth login' must not appear in SDK source." >&2
  echo "$matches" >&2
  echo "SDK NEVER automates interactive OAuth (AUT-05 / Phase 6 SC-4)." >&2
  exit 1
fi
echo "[lint-auth-login] OK: no interactive OAuth automation detected in ts/src or python/src."
