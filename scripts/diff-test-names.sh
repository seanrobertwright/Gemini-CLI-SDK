#!/usr/bin/env bash
# Enforces TS/Python test name parity (PAR-03).
# Extracts test descriptions from TS spec files and Python test docstrings.
# Exits nonzero if they diverge.
# Usage: bash scripts/diff-test-names.sh
set -euo pipefail

# Use C.utf8 locale for sort: avoids "Invalid or incomplete multibyte or wide character"
# errors when test names contain non-ASCII characters (e.g. em-dash U+2014).
# Falls back to LC_ALL=C if C.utf8 is unavailable (CI runner without full glibc locales).
if locale -a 2>/dev/null | grep -q '^C\.utf8$'; then
  export LC_ALL=C.utf8
else
  export LC_ALL=C
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

TS_DIR="$REPO_ROOT/ts/src"
PY_DIR="$REPO_ROOT/python/tests"

TS_TESTS=$(mktemp)
PY_TESTS=$(mktemp)
trap "rm -f '$TS_TESTS' '$PY_TESTS'" EXIT

# Detect a working Python interpreter.
# Tries python3 first (Linux/macOS/CI), then python (Windows Git Bash).
# Verifies with a simple -c call to skip broken Windows Store stubs that
# report themselves via 'command -v python3' but exit 49 on execution.
PYTHON=""
for _py in python3 python py; do
  if $_py -c "import sys; sys.exit(0)" &>/dev/null 2>&1; then
    PYTHON="$_py"
    break
  fi
done

if [[ -z "$PYTHON" ]]; then
  echo "ERROR: No working Python interpreter found (tried python3, python, py)" >&2
  exit 1
fi

# Extract TS test names: test('description') or it('description')
# Handles both single and double quotes.
# Uses -oE (ERE) for portability — avoids -oP (PCRE) which requires special locale
# support in some grep builds (e.g. Git Bash on Windows with grep 3.0).
grep -rhn --include="*.spec.ts" --include="*.test.ts" \
  -E "^[[:space:]]*(test|it)\(['\"]" "$TS_DIR" 2>/dev/null \
  | grep -oE "(test|it)\(['\"][^'\"]+['\"]" \
  | sed "s/^\\(test\\|it\\)(['\"]//;s/['\"]$//" \
  | tr -d '\r' \
  | sort > "$TS_TESTS" || true  # grep exits 1 when no matches; || true prevents pipefail abort

# Extract Python test docstrings (first line of each test function's docstring)
# PYTHONIOENCODING=utf-8: forces Python stdout to UTF-8 on Windows where the default
# code page (cp1252) would encode non-ASCII chars differently from the TS grep output.
PYTHONIOENCODING=utf-8 "$PYTHON" - "$PY_DIR" <<'PYEOF' | tr -d '\r' | sort > "$PY_TESTS"
import ast
import pathlib
import sys

test_dir = pathlib.Path(sys.argv[1])
for f in sorted(test_dir.rglob("test_*.py")):
    try:
        tree = ast.parse(f.read_text(encoding="utf-8"))
    except SyntaxError:
        continue
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if node.name.startswith("test_"):
                doc = ast.get_docstring(node)
                if doc:
                    print(doc.split("\n")[0].strip())
                else:
                    # No docstring — emit function name as fallback (will likely fail parity)
                    print(f"MISSING_DOCSTRING: {node.name}")
PYEOF

TS_COUNT=$(wc -l < "$TS_TESTS")
PY_COUNT=$(wc -l < "$PY_TESTS")

echo "TS tests found: $TS_COUNT"
echo "Python tests found: $PY_COUNT"

if [[ "$TS_COUNT" -eq 0 ]] && [[ "$PY_COUNT" -eq 0 ]]; then
  echo "OK: No tests found in either language (expected during scaffolding)."
  exit 0
fi

if diff "$TS_TESTS" "$PY_TESTS"; then
  echo "OK: TS and Python test names match ($TS_COUNT tests)."
  exit 0
else
  echo ""
  echo "ERROR: TS and Python test names diverge. Fix parity before merging."
  echo "  TS tests:     $TS_TESTS (inspect with: cat $TS_TESTS)"
  echo "  Python tests: $PY_TESTS (inspect with: cat $PY_TESTS)"
  exit 1
fi
