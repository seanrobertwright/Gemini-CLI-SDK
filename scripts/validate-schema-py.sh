#!/usr/bin/env bash
# scripts/validate-schema-py.sh
#
# Smoke test: compile spec/events.schema.json with datamodel-code-generator@0.30.2
# (via uvx) and import-smoke-test the generated Pydantic v2 model.
#
# Usage: bash scripts/validate-schema-py.sh
#
# Exit 0 = codegen + import smoke test both passed.
# Exit 1 = any failure.
#
# Requires: uvx (from uv — https://docs.astral.sh/uv/getting-started/installation/)
set -euo pipefail

SCHEMA="spec/events.schema.json"
if [ ! -f "$SCHEMA" ]; then
  echo "FAIL: $SCHEMA not found" >&2
  exit 1
fi

TMPDIR_LOCAL="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_LOCAL"' EXIT

OUT="$TMPDIR_LOCAL/events.py"

# Generate Pydantic v2 model from the JSON Schema using pinned datamodel-code-generator
uvx --from "datamodel-code-generator==0.30.2" datamodel-codegen \
  --input "$SCHEMA" \
  --input-file-type jsonschema \
  --output "$OUT" \
  --output-model-type pydantic_v2.BaseModel \
  --target-python-version 3.10 \
  --use-annotated \
  --use-union-operator

if [ ! -s "$OUT" ]; then
  echo "FAIL: datamodel-codegen produced empty output" >&2
  exit 1
fi

# Import-smoke-test the generated module with Pydantic available
# Note: single-quoted heredoc; OUT is expanded by the outer shell via double-quotes
uvx --with "pydantic==2.*" python -c "
import importlib.util
spec = importlib.util.spec_from_file_location('events', '$OUT')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
print('ok')
" | grep -q '^ok$'

echo "PASS: validate-schema-py"
