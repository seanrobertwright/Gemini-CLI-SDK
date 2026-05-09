# Archon Integration Guide

Use Gemini as a third AI assistant in [coleam00/Archon](https://github.com/coleam00/Archon) alongside Claude and Codex. `DEFAULT_AI_ASSISTANT=gemini` end-to-end.

## Status

The adapter currently ships as a **local bundle** applied to a user-owned Archon fork. An upstream PR to `coleam00/Archon` is intentionally deferred per project decision — see the [Archon-local project memory](https://github.com/seanrobertwright/Gemini-SDK/blob/master/.planning/STATE.md).

## What's in the bundle

The SDK repo stages nine files under `.planning/phases/10-archon-adapter-ts-only/pr-artifacts/`:

```
pr-artifacts/
├── README.md                  apply instructions
├── PR_BODY.md                 draft PR narrative (for reference)
├── registry.patch             unified diff for packages/providers/src/registry.ts
├── env.example.patch          unified diff for Archon .env.example
└── gemini/                    copy this whole directory into packages/providers/src/community/
    ├── provider.ts
    ├── capabilities.ts
    ├── registration.ts
    ├── options-translator.ts
    └── index.ts
```

## Applying the bundle

From the root of a fresh clone of your Archon fork (pin to the SHA in `.archon-compat`):

```bash
GEMINI_SDK_DIR=/path/to/Gemini-SDK

# 1. Copy the provider source files into the community tree.
cp -r "$GEMINI_SDK_DIR/.planning/phases/10-archon-adapter-ts-only/pr-artifacts/gemini" \
      packages/providers/src/community/

# 2. Apply the registry patch.
git apply "$GEMINI_SDK_DIR/.planning/phases/10-archon-adapter-ts-only/pr-artifacts/registry.patch"

# 3. Apply the .env.example patch.
git apply "$GEMINI_SDK_DIR/.planning/phases/10-archon-adapter-ts-only/pr-artifacts/env.example.patch"

# 4. Add the SDK as a dependency. For pre-1.0.0, use the GitHub tarball ref.
#    Post-1.0.0, use the npm package:
cd packages/providers
bun add @lrilai/gemini-cli-sdk
cd ../..

# 5. Install + verify.
bun install
bun test packages/providers
```

## Configuring DEFAULT_AI_ASSISTANT=gemini

In your Archon `.env`:

```bash
DEFAULT_AI_ASSISTANT=gemini
GEMINI_API_KEY=your-key-from-ai.google.dev
# Optional:
# GEMINI_BIN_PATH=/custom/path/to/gemini
# GEMINI_SDK_COMPAT=warn   # or strict / silent
```

Start Archon normally. The Gemini provider registers at `DEFAULT_AI_ASSISTANT=gemini`, workflow-dispatch events match the Claude/Codex clients (verified by contract test in plan 10-05).

## Namespace discipline

The adapter uses **only** `GEMINI_*` and `GEMINI_SDK_*` env var names — guaranteed no collisions with Archon's existing Claude/Codex vars (ARC-09). The `scripts/lint-env-namespace.sh` CI gate enforces this at every commit.

## Release gate

Tagging `v1.0.0` of this SDK requires the local smoke-test script (`scripts/local-release-smoke.sh`) to exit 0 — which means the bundle applies cleanly AND one real `query()` succeeds against a real `gemini-cli` from inside Archon. See REL-07 in the roadmap.
