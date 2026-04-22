# Add Gemini community provider (draft)

## Summary

- Adds a new **Gemini community provider** under `packages/providers/src/community/gemini/`, implementing `IAgentProvider` end-to-end on top of the Google Gemini CLI via the `@gemini-sdk/gemini` npm package.
- SDK dependency during draft stage: `"@gemini-sdk/gemini": "github:<gemini-sdk-owner>/<gemini-sdk-repo>#<HEAD-SHA>"` (GitHub tarball, pinned SHA). This will swap to `"^1.0.0"` once the SDK is published to npm.
- **Draft status** until the SDK v1.0.0 npm release lands (tracked as **Phase 11** in the SDK repo). Flipping this PR to ready-for-review is gated on that publish event.

## Files added / changed

New files under `packages/providers/src/community/gemini/`:

- `provider.ts` — `GeminiProvider` class (thin `IAgentProvider` delegation shim, <50 LOC)
- `capabilities.ts` — `GEMINI_CAPABILITIES` static capability matrix
- `registration.ts` — `registerGeminiProvider()` wiring into `../../registry.ts` (parameterless, mirrors the Pi provider pattern)
- `options-translator.ts` — Pure translation core: `translateOptions`, `translateChunk`, `warnIgnoredOptions`, plus the 25-key `OPTION_MAPPING` table (buckets 7 honored / 5 partial / 4 deferred / 9 ignored per the SDK repo's `spec/archon/mapping.md`)
- `index.ts` — Barrel export for provider + registration + capabilities

Modified files:

- `packages/providers/src/registry.ts` — 2-line edit: import `registerGeminiProvider` and call it inside `registerCommunityProviders()`. Preserves the existing `registerPiProvider()` call.
- `.env.example` — adds `GEMINI_BIN_PATH=` (and `GEMINI_API_KEY=` if not already present in a Pi-related section) with a comment header scoping it to the Gemini community provider.

## Verification

In this PR's working tree, from repo root:

```bash
bun install
bun test packages/providers
```

Should be green. The Gemini SDK tarball dep resolves during `bun install`; the provider has no additional runtime deps beyond what the existing community provider pattern brings in.

Beyond that, the Gemini SDK repo itself runs an `archon-contract` CI job on every push that pins this commit's SHA in `.archon-compat` and re-verifies structural compatibility of the `IAgentProvider` interface and the 25-key option mapping surface. Breaks in this PR surface on the SDK side within one CI cycle.

## Architectural precedent

This provider follows the **Pi community provider** layout as its architectural template, verbatim:

- Same directory structure (`packages/providers/src/community/<name>/`)
- Same file set (provider + capabilities + registration + options-translator + index barrel)
- Same registration idiom (parameterless `register<Name>Provider()` called from `registerCommunityProviders()`)
- Same type-import convention (`../../types.js` for the canonical provider types)

Anything Gemini-specific (capability matrix, option triage, chunk translation) is isolated to its own files; the registry touch is a single-line addition.

## Links

- **Gemini SDK repo:** `<gemini-sdk-owner>/<gemini-sdk-repo>` — source of `@gemini-sdk/gemini`, option triage rationale (`spec/archon/mapping.md`), and the standalone adapter mirror (`adapter-archon/src/`).
- **Option triage:** `spec/archon/mapping.md` in the SDK repo — row-by-row triage of every SendQueryOptions / NodeConfig / AgentRequestOptions key against Gemini CLI capability.
- **Pi community provider:** `packages/providers/src/community/pi/` (in this repo) — the architectural template this PR mirrors.
- **`.archon-compat`:** pinned Archon SHA the SDK was authored against: `7ea321419f0cd48e71e9ebf12968f539bc4166bc`.

---

**Draft PR** — will flip to ready-for-review in **Phase 11** after `@gemini-sdk/gemini` v1.0.0 is published to npm. The dependency will swap from `"github:<gemini-sdk-repo>#<SHA>"` to `"^1.0.0"` at that time, and this PR body will be updated to reflect the final published-npm wiring.
