#!/usr/bin/env bash
# scripts/audit-fixtures.sh
#
# Security audit: run trufflehog filesystem scan over spec/fixtures/ and
# exit non-zero on any detected secret.
#
# Usage: bash scripts/audit-fixtures.sh
#
# Exit 0 = no secrets detected (or no fixtures present yet).
# Exit 1 = secrets detected, trufflehog unavailable, or fixture dir missing.
#
# Requires: trufflehog on PATH, or docker available as fallback.
# Install trufflehog: https://github.com/trufflesecurity/trufflehog#installation
set -euo pipefail

FIXTURE_DIR="spec/fixtures"
if [ ! -d "$FIXTURE_DIR" ]; then
  echo "FAIL: $FIXTURE_DIR not found" >&2
  exit 1
fi

# Count fixture files; if zero, nothing to audit (W0 seed state)
COUNT=$(find "$FIXTURE_DIR" -type f \( -name '*.ndjson' -o -name '*.stderr.txt' -o -name '*.expected.json' \) 2>/dev/null | wc -l)
if [ "$COUNT" -eq 0 ]; then
  echo "INFO: 0 fixture files present, audit is a no-op (W3 populates)"
  exit 0
fi

# Run trufflehog filesystem scan; --fail means exit non-zero on any detection
if command -v trufflehog >/dev/null 2>&1; then
  trufflehog filesystem "$FIXTURE_DIR" --fail --no-update --only-verified=false
elif command -v docker >/dev/null 2>&1; then
  # Fallback: docker image (cross-platform, no PATH install needed)
  docker run --rm -v "$PWD:/work" -w /work \
    trufflesecurity/trufflehog:latest \
    filesystem spec/fixtures --fail --no-update --only-verified=false
else
  echo "FAIL: trufflehog not on PATH and docker unavailable" >&2
  echo "Install trufflehog: https://github.com/trufflesecurity/trufflehog#installation" >&2
  exit 1
fi

echo "PASS: audit-fixtures"
