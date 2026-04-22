# PR Artifact Bundle — Gemini Community Provider (Phase 10, ARC-08)

This directory stages the exact files to be copied into a fork of
[coleam00/Archon](https://github.com/coleam00/Archon) for the draft PR
that adds the Gemini community provider.

## Pinned Archon compatibility

- Repo: `coleam00/Archon`
- Branch: `dev`
- SHA: `7ea321419f0cd48e71e9ebf12968f539bc4166bc` (see `.archon-compat` at repo root)
- Verified: 2026-04-21

If this SHA drifts, regenerate adapter types (`adapter-archon/src/types.ts`),
re-verify `spec/archon/mapping.md`, and re-run the drift contract test
(plan 10-05) before re-staging this bundle.

## Bundle contents

```
pr-artifacts/
├── README.md                  (this file — apply instructions)
├── PR_BODY.md                 (draft PR description)
├── registry.patch             (unified diff — packages/providers/src/registry.ts)
├── env.example.patch          (unified diff — Archon .env.example)
└── gemini/                    (copy this whole dir into packages/providers/src/community/)
    ├── provider.ts
    ├── capabilities.ts
    ├── registration.ts
    ├── options-translator.ts
    └── index.ts
```

## Apply instructions

From the root of a fresh clone of your Archon fork (pinned to the SHA above):

```bash
# 1. Copy the provider source files into the community tree.
cp -r <gemini-sdk-repo>/.planning/phases/10-archon-adapter-ts-only/pr-artifacts/gemini \
      packages/providers/src/community/

# 2. Apply the registry patch.
git apply <gemini-sdk-repo>/.planning/phases/10-archon-adapter-ts-only/pr-artifacts/registry.patch

# 3. Apply the .env.example patch. If GEMINI_API_KEY already exists
#    in Archon's .env.example (check first), skip the GEMINI_API_KEY= line
#    and apply only the header comment + GEMINI_BIN_PATH= line manually.
git apply <gemini-sdk-repo>/.planning/phases/10-archon-adapter-ts-only/pr-artifacts/env.example.patch

# 4. Add the SDK as a GitHub tarball dep (draft stage — will flip to npm in Phase 11).
#    From Archon's packages/providers/:
#    Add to package.json dependencies:
#      "@gemini-sdk/gemini": "github:<gemini-sdk-owner>/<gemini-sdk-repo>#<HEAD-SHA>"

# 5. Verify.
bun install
bun test packages/providers
```

## Known adaptations vs standalone `adapter-archon/src/`

The files under `gemini/` are near-identical copies of `adapter-archon/src/`
with three targeted transformations applied during staging:

1. **Types import path.** All `from './types.js'` rewritten to
   `from '../../types.js'`. Rationale: Archon's canonical
   `IAgentProvider` / `SendQueryOptions` / `MessageChunk` / `ProviderCapabilities`
   types live at `packages/providers/src/types.ts`, two levels up from
   `packages/providers/src/community/gemini/`. The standalone repo mirrors
   those types locally at `adapter-archon/src/types.ts` (pinned via
   `.archon-compat`); the PR bundle drops the mirror and uses Archon's own.

2. **SDK package name.** `from '@gemini-sdk/core'` rewritten to
   `from '@gemini-sdk/gemini'` in `provider.ts` and `options-translator.ts`.
   Rationale: `@gemini-sdk/gemini` is the published npm name per
   `10-CONTEXT.md`. During the draft PR window, Archon's `package.json`
   resolves this via a GitHub tarball dep; Phase 11 flips it to `^1.0.0`
   after npm publish.

3. **Registration signature.** `registration.ts` drops the
   `ProviderRegistryLike` structural parameter (used standalone so the
   adapter can typecheck without `@archon/providers`) in favor of direct
   imports from `../../registry.js`. The function becomes parameterless
   (`export function registerGeminiProvider(): void`) to match the Pi
   provider's pattern verbatim.

No other changes are applied during staging. `capabilities.ts`, the
translation logic in `options-translator.ts`, and the barrel shape in
`index.ts` are byte-identical to the standalone repo modulo the import
path rewrites above.
