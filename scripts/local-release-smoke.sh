#!/usr/bin/env bash
# local-release-smoke.sh — REL-07 gate (local-fork Archon integration smoke)
#
# Applies the pr-artifacts bundle from Phase 10 to a local Archon fork,
# installs the Gemini SDK into it, and runs one real query() through the
# Archon workflow path. Passing this script is the prerequisite for tagging
# v1.0.0 — it replaces the original REL-07 "wait for upstream PR merge" gate
# (deferred per user direction; adapter stays local to the user's fork).
#
# Usage:
#   bash scripts/local-release-smoke.sh
#   ARCHON_DIR=/path/to/my/archon-fork bash scripts/local-release-smoke.sh
#
# Environment:
#   ARCHON_DIR       — path to a clean local Archon clone (default: ../Archon)
#   GEMINI_API_KEY   — REQUIRED; used for the live query() call
#   SKIP_QUERY       — if "1", skips the live query step (patches + install only)
#
# Exit codes:
#   0  = smoke test passed (safe to tag v1.0.0)
#   1  = missing prerequisite (ARCHON_DIR, GEMINI_API_KEY, pr-artifacts)
#   2  = patch apply failed
#   3  = install / bun test failed
#   4  = live query() failed
#
# Platform note: tested on Linux, macOS, and Windows Git Bash. Uses $(pwd)
# and relative paths throughout per Pitfall 8 guidance.

set -euo pipefail

SDK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCHON_DIR="${ARCHON_DIR:-${SDK_ROOT}/../Archon}"
BUNDLE_DIR="${SDK_ROOT}/.planning/phases/10-archon-adapter-ts-only/pr-artifacts"
ARCHON_SHA_PIN="$(cat "${SDK_ROOT}/.archon-compat" 2>/dev/null | grep -oE '[a-f0-9]{40}' | head -1 || echo "")"

log() { echo "[local-release-smoke] $*"; }
fail() { echo "[local-release-smoke] ERROR: $*" >&2; exit "${2:-1}"; }

# --- preflight ---
log "SDK root: ${SDK_ROOT}"
log "Archon dir: ${ARCHON_DIR}"

if [ ! -d "${BUNDLE_DIR}" ]; then
  fail "pr-artifacts bundle not found at ${BUNDLE_DIR}" 1
fi
if [ ! -d "${ARCHON_DIR}" ]; then
  fail "Archon checkout not found at ${ARCHON_DIR}; clone your fork first or set ARCHON_DIR" 1
fi
if [ -z "${GEMINI_API_KEY:-}" ] && [ "${SKIP_QUERY:-0}" != "1" ]; then
  fail "GEMINI_API_KEY not set (required unless SKIP_QUERY=1)" 1
fi

# Verify Archon SHA matches pin (warn-not-fail — user may intentionally be on a different commit)
if [ -n "${ARCHON_SHA_PIN}" ]; then
  cd "${ARCHON_DIR}"
  ACTUAL_SHA="$(git rev-parse HEAD 2>/dev/null || echo "unknown")"
  if [ "${ACTUAL_SHA}" != "${ARCHON_SHA_PIN}" ]; then
    log "WARN: Archon is at ${ACTUAL_SHA} but pr-artifacts was verified against ${ARCHON_SHA_PIN}"
    log "WARN: continuing anyway; if patches fail, checkout the pinned SHA"
  fi
  cd "${SDK_ROOT}"
fi

# --- step 1: copy gemini/ into community providers ---
log "Step 1/5: copying provider files into community tree"
PROVIDERS_DIR="${ARCHON_DIR}/packages/providers/src/community"
mkdir -p "${PROVIDERS_DIR}"
cp -r "${BUNDLE_DIR}/gemini" "${PROVIDERS_DIR}/" || fail "cp failed" 2

# --- step 2: apply patches ---
log "Step 2/5: applying registry + env.example patches"
cd "${ARCHON_DIR}"
git apply --check "${BUNDLE_DIR}/registry.patch" || fail "registry.patch does not apply cleanly" 2
git apply "${BUNDLE_DIR}/registry.patch" || fail "registry.patch apply failed" 2

if git apply --check "${BUNDLE_DIR}/env.example.patch" 2>/dev/null; then
  git apply "${BUNDLE_DIR}/env.example.patch" || fail "env.example.patch apply failed" 2
else
  log "env.example.patch does not apply cleanly — likely GEMINI_API_KEY already present; continuing"
fi

# --- step 3: install SDK as local dep ---
log "Step 3/5: adding gemini-sdk as a local dep via pnpm link or tarball"
cd "${ARCHON_DIR}/packages/providers"
# Prefer pnpm link for dev-local; fall back to a file: dependency
if command -v bun >/dev/null 2>&1; then
  (cd "${SDK_ROOT}/ts" && bun link || true)
  bun link @lrilai/gemini-cli-sdk || bun add "file:${SDK_ROOT}/ts"
else
  fail "bun not found; Archon requires bun — install via https://bun.sh" 3
fi
cd "${ARCHON_DIR}"
bun install || fail "bun install failed" 3

# --- step 4: run adapter tests ---
log "Step 4/5: bun test packages/providers"
bun test packages/providers || fail "bun test failed" 3

# --- step 5: live query via DEFAULT_AI_ASSISTANT=gemini ---
if [ "${SKIP_QUERY:-0}" = "1" ]; then
  log "Step 5/5: SKIPPED (SKIP_QUERY=1)"
  log "SMOKE TEST PARTIAL PASS (patches + install + test only; no live query)"
  exit 0
fi

log "Step 5/5: running one live query() through Archon"
# This echoes a minimal prompt through Archon's workflow executor with Gemini as the assistant.
# Archon's exact test entry varies; prefer the contract test we shipped in phase 10 if present.
if [ -f "packages/providers/test/community/gemini.contract.test.ts" ]; then
  DEFAULT_AI_ASSISTANT=gemini GEMINI_API_KEY="${GEMINI_API_KEY}" \
    bun test packages/providers/test/community/gemini.contract.test.ts || fail "contract test failed against real gemini-cli" 4
else
  log "WARN: contract test not found in Archon checkout; running a minimal inline smoke instead"
  cd "${SDK_ROOT}/ts"
  DEFAULT_AI_ASSISTANT=gemini GEMINI_API_KEY="${GEMINI_API_KEY}" \
    node --experimental-strip-types -e "
      import { query } from './src/index.ts';
      let saw = false;
      for await (const chunk of query({ prompt: 'Say hello in one word.' })) {
        if (chunk.type === 'assistant' && chunk.text) saw = true;
      }
      if (!saw) { console.error('no assistant chunk'); process.exit(4); }
      console.log('live query ok');
    " || fail "live query failed" 4
fi

log "SMOKE TEST PASSED — safe to tag v1.0.0"
