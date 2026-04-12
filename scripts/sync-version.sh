#!/usr/bin/env bash
# Syncs the root VERSION file into ts/package.json and python/pyproject.toml.
# Usage: bash scripts/sync-version.sh
# Run before publish or in CI release step.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION_FILE="$REPO_ROOT/VERSION"

if [[ ! -f "$VERSION_FILE" ]]; then
  echo "ERROR: VERSION file not found at $VERSION_FILE" >&2
  exit 1
fi

VERSION=$(tr -d '[:space:]' < "$VERSION_FILE")

if [[ -z "$VERSION" ]]; then
  echo "ERROR: VERSION file is empty" >&2
  exit 1
fi

# Patch ts/package.json using node (handles JSON correctly).
# Pass REPO_ROOT and VERSION as env vars to avoid shell-escaping issues
# with Windows backslash paths inside -e strings.
REPO_ROOT="$REPO_ROOT" PKG_VERSION="$VERSION" node -e "
const fs = require('fs');
const path = require('path');
const pkgPath = path.join(process.env.REPO_ROOT, 'ts', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.version = process.env.PKG_VERSION;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
"

# Patch python/pyproject.toml using sed
# Match: version = "anything" and replace with version = "VERSION"
# The .bak pattern ensures portability across GNU sed and macOS BSD sed
# (BSD sed requires -i '' or -i .bak; .bak suffix works on both)
sed -i.bak "s/^version = \".*\"/version = \"${VERSION}\"/" "$REPO_ROOT/python/pyproject.toml"
rm -f "$REPO_ROOT/python/pyproject.toml.bak"

echo "Synced version ${VERSION} to ts/package.json and python/pyproject.toml"
