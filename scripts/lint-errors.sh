#!/usr/bin/env bash
# scripts/lint-errors.sh
# ERR-07 + PAR-05 drift detection for the error taxonomy.
# Exits 0 when YAML <-> TS <-> Python are in sync; non-zero otherwise.
#
# Compat: macOS BSD grep (no -P). Git Bash on Windows. Use grep -E only.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

YAML_PATH="spec/errors.yaml"
TS_GEN="ts/src/errors/errors.ts"
PY_GEN="python/src/gemini_sdk/errors/errors.py"

# --- 1. Re-run codegen ---
echo "[lint-errors] Regenerating TS..."
node scripts/gen-errors.mjs >/dev/null
echo "[lint-errors] Regenerating Python..."
if command -v uv >/dev/null 2>&1; then
  (cd python && uv run python ../scripts/gen-errors.py >/dev/null)
else
  python3 scripts/gen-errors.py >/dev/null
fi

# --- 2. Drift check ---
if ! git diff --exit-code -- "$TS_GEN" "$PY_GEN"; then
  echo "[lint-errors] FAIL: generated files drifted from committed versions." >&2
  echo "  Run: node scripts/gen-errors.mjs && (cd python && uv run python ../scripts/gen-errors.py)" >&2
  echo "  Then commit the updated files." >&2
  exit 1
fi

# --- 3. Extract class names ---
# YAML names: `  - name: Foo` entries under `errors:`
yaml_names="$(grep -E '^\s*-\s*name:\s*[A-Za-z0-9_]+' "$YAML_PATH" | grep -oE '[A-Za-z0-9_]+$' | sort -u)"

# TS names: `export class Foo extends ...`
ts_names="$(grep -oE '^export class [A-Za-z0-9_]+' "$TS_GEN" | awk '{print $3}' | sort -u)"

# Python names: `class Foo(...):`
py_names="$(grep -oE '^class [A-Za-z0-9_]+' "$PY_GEN" | awk '{print $2}' | sort -u)"

# --- 4. Cross-check set equality ---
fail=0
diff_yaml_ts="$(comm -3 <(echo "$yaml_names") <(echo "$ts_names") || true)"
if [ -n "$diff_yaml_ts" ]; then
  echo "[lint-errors] FAIL: YAML <-> TS class set mismatch:" >&2
  echo "$diff_yaml_ts" >&2
  fail=1
fi
diff_yaml_py="$(comm -3 <(echo "$yaml_names") <(echo "$py_names") || true)"
if [ -n "$diff_yaml_py" ]; then
  echo "[lint-errors] FAIL: YAML <-> Python class set mismatch:" >&2
  echo "$diff_yaml_py" >&2
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  exit 1
fi

yaml_count="$(echo "$yaml_names" | wc -l | tr -d ' ')"
echo "[lint-errors] OK: $yaml_count classes in sync across YAML, TS, Python."
