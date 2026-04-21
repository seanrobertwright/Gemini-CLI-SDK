#!/usr/bin/env bash
# scripts/lint-env-namespace.spec.sh — self-test for lint-env-namespace.sh (ARC-09).
# Builds three fixture directories and exercises the linter via LINT_ENV_NS_SCOPE:
#   Test A (pass):    only allowlisted env vars            -> exit 0
#   Test B (fail):    process.env.OPENAI_API_KEY dot form  -> exit 1, stderr mentions OPENAI_API_KEY
#   Test C (fail):    process.env['AWS_SECRET'] bracket    -> exit 1, stderr mentions AWS_SECRET
#
# Compat: macOS BSD mktemp, Git Bash on Windows, grep -E only.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LINTER="$REPO_ROOT/scripts/lint-env-namespace.sh"

if [ ! -f "$LINTER" ]; then
  echo "[lint-env-namespace.spec] FAIL: linter not found at $LINTER" >&2
  exit 1
fi

WORKDIR="$(mktemp -d 2>/dev/null || mktemp -d -t 'lint-env-ns-spec')"
trap 'rm -rf "$WORKDIR"' EXIT

FAIL=0

# ----- Test A: allowlisted-only should pass -----
A_DIR="$WORKDIR/a"
mkdir -p "$A_DIR"
cat > "$A_DIR/ok.ts" <<'TS'
export const k = process.env.GEMINI_API_KEY;
export const n = process.env.GEMINI_SDK_FOO;
export const e = process.env.NODE_ENV;
export const d = process.env.DEBUG;
export const p = process.env.PATH;
TS

if LINT_ENV_NS_SCOPE="$A_DIR" bash "$LINTER" >/dev/null 2>&1; then
  echo "[Test A] PASS: allowlisted-only fixture accepted."
else
  echo "[Test A] FAIL: allowlisted-only fixture was rejected." >&2
  FAIL=1
fi

# ----- Test B: dot-form non-namespaced should fail and mention OPENAI_API_KEY -----
B_DIR="$WORKDIR/b"
mkdir -p "$B_DIR"
cat > "$B_DIR/bad.ts" <<'TS'
export const x = process.env.OPENAI_API_KEY;
TS

B_OUT="$(LINT_ENV_NS_SCOPE="$B_DIR" bash "$LINTER" 2>&1 || true)"
B_EXIT=0
LINT_ENV_NS_SCOPE="$B_DIR" bash "$LINTER" >/dev/null 2>&1 || B_EXIT=$?
if [ "$B_EXIT" -ne 0 ] && echo "$B_OUT" | grep -q "OPENAI_API_KEY"; then
  echo "[Test B] PASS: dot-form non-namespaced var rejected and named."
else
  echo "[Test B] FAIL: expected non-zero exit + OPENAI_API_KEY in stderr. exit=$B_EXIT output:" >&2
  echo "$B_OUT" >&2
  FAIL=1
fi

# ----- Test C: bracket-form non-namespaced should fail and mention AWS_SECRET -----
C_DIR="$WORKDIR/c"
mkdir -p "$C_DIR"
cat > "$C_DIR/bad.ts" <<'TS'
export const y = process.env['AWS_SECRET'];
TS

C_OUT="$(LINT_ENV_NS_SCOPE="$C_DIR" bash "$LINTER" 2>&1 || true)"
C_EXIT=0
LINT_ENV_NS_SCOPE="$C_DIR" bash "$LINTER" >/dev/null 2>&1 || C_EXIT=$?
if [ "$C_EXIT" -ne 0 ] && echo "$C_OUT" | grep -q "AWS_SECRET"; then
  echo "[Test C] PASS: bracket-form non-namespaced var rejected and named."
else
  echo "[Test C] FAIL: expected non-zero exit + AWS_SECRET in stderr. exit=$C_EXIT output:" >&2
  echo "$C_OUT" >&2
  FAIL=1
fi

if [ "$FAIL" -ne 0 ]; then
  echo "[lint-env-namespace.spec] FAIL: one or more cases diverged." >&2
  exit 1
fi

echo "[lint-env-namespace.spec] ALL OK: 3/3 cases passed."
