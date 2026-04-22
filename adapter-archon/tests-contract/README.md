# adapter-archon — Contract Tests

This suite is the **Archon contract layer**: the adapter translation is verified
against a recorded stream (`fixtures/gemini-stub-stream.ndjson`) to guarantee
that `GeminiProvider.sendQuery()` emits Archon-shaped `MessageChunk`s in the
exact order and with the field names Archon expects.

Unlike `adapter-archon/src/*.spec.ts` (unit tests on translation helpers), the
tests here:

- Hand-author the pre-computed array of SDK-shape `MessageChunk`s that Phase 3
  dispatch would produce from the fixture NDJSON lines.
- Mock `@gemini-sdk/core` so `query()` yields those chunks.
- Invoke `new GeminiProvider().sendQuery(...)` through the public barrel.
- Assert: variant order, `workflow_dispatch` sentinel shape, field renames
  (`toolCallId`/`toolInput`/`toolOutput` — NOT `toolId`/`parameters`/`output`),
  and that no SDK-specific names leak through.

## Local run

```bash
cd adapter-archon
pnpm test
```

The custom `tests-contract/` glob is wired up in `vitest.config.ts`, so the
contract spec runs alongside the unit specs.

## CI

- `.github/workflows/archon-contract.yml` runs this suite on every PR and then
  **additionally** clones Archon at the pinned SHA (`.archon-compat`), copies
  the PR bundle (produced by plan 10-06) into the cloned tree, applies
  `registry.patch`, and runs Archon's `bun test packages/providers` to prove
  the bundle applies cleanly.
- `.github/workflows/archon-drift.yml` runs weekly against Archon's `dev`
  HEAD instead of the pinned SHA. On failure it opens an issue titled
  "Archon drift detected YYYY-MM-DD".

## Fixture

The NDJSON fixture is a minimal 5-line stream (init, message, tool_use,
tool_result, result) that exercises every field-rename and the
`workflow_dispatch` sentinel emission. Each line is valid JSON conforming
to `spec/events.schema.json`. When the fixture is expanded, update the
hand-authored SDK chunks in `contract.spec.ts` to match.
