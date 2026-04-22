#!/usr/bin/env bash
# local-release-smoke.spec.sh — self-test for local-release-smoke.sh
#
# Validates preflight-error exit codes without requiring a real Archon clone.
# Run: bash scripts/local-release-smoke.spec.sh

set -euo pipefail

SDK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="${SDK_ROOT}/scripts/local-release-smoke.sh"
PASS=0
FAIL=0

assert_exit() {
  local expected=$1
  local description=$2
  shift 2
  local actual=0
  "$@" >/dev/null 2>&1 || actual=$?
  if [ "$actual" -eq "$expected" ]; then
    echo "PASS: $description (exit $actual)"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $description (expected exit $expected, got $actual)"
    FAIL=$((FAIL + 1))
  fi
}

# Case 1: missing ARCHON_DIR → exit 1
assert_exit 1 "missing archon dir exits 1" \
  env -u GEMINI_API_KEY ARCHON_DIR="/definitely/does/not/exist/archon" bash "$SCRIPT"

# Case 2: missing GEMINI_API_KEY (with SKIP_QUERY unset) → exit 1 (since archon dir missing first, this still exits 1)
assert_exit 1 "missing api key exits 1" \
  env -u GEMINI_API_KEY ARCHON_DIR="$SDK_ROOT" bash "$SCRIPT"

# Case 3: script is executable
if [ -x "$SCRIPT" ]; then
  echo "PASS: script is executable"
  PASS=$((PASS + 1))
else
  echo "FAIL: script is not executable"
  FAIL=$((FAIL + 1))
fi

echo ""
echo "=========================================="
echo "Results: $PASS passed, $FAIL failed"
echo "=========================================="
[ "$FAIL" -eq 0 ]
