# Live E2E Test Suite (Phase 8: SC-1 + SC-2)

This directory contains **opt-in integration tests** that spawn a real `gemini-cli`
subprocess against the live Gemini API. They verify Phase 8 ROADMAP Success Criteria
SC-1 (allowedTools enforcement) and SC-2 (approvalMode yolo + plan filesystem behavior).

## Why opt-in?

These tests require:
- A working `gemini-cli` install on PATH (or `GEMINI_BIN_PATH` set)
- A valid `GEMINI_API_KEY` with quota
- Network access
- Real API spend (~3 prompts per run)

For those reasons, they are **not** part of the default `pnpm test` suite. The default
suite remains free, fast, and hermetic.

## How to run

From the `ts/` directory:

```bash
RUN_LIVE_E2E=1 GEMINI_API_KEY=sk-... pnpm test:live
```

If either env var is missing, every test in this suite is **skipped** (not failed) via
`describe.skipIf(!LIVE_ENABLED)` — so accidentally invoking `pnpm test:live` without
the gate set produces a green no-op run rather than confusing failures.

## What runs

Each test:
1. Creates an isolated sandbox directory via `mkdtempSync(tmpdir(), 'gemini-sdk-live-')`.
2. Runs `queryFull({ ..., cwd: sandbox })` so any filesystem mutations land in the sandbox.
3. Asserts on the returned event stream (SC-1) or on post-run `fs.stat` of the sandbox (SC-2).
4. Cleans up the sandbox in `afterAll`.

## CI guidance

Do **not** enable `RUN_LIVE_E2E` on every push. Recommended pattern:
- `workflow_dispatch` manual trigger with a dedicated `GEMINI_API_KEY` secret.
- Optional nightly run if budget allows.
- Pre-release gate before tagging.

The default `pnpm test` / `uv run pytest` paths remain the per-push contract.

## Parity with Python

The Python SDK emits byte-identical argv for `--allowed-tools` and `--approval-mode`
(proved by `diff-test-names.sh` 205:205 parity and the argv unit tests in both languages).
Live tests are TS-only because they verify **CLI-level behavior** downstream of the
argv, which is language-agnostic. Mirroring the suite in Python would spend 3x API
budget to re-verify the same CLI contract.

If a future contributor disagrees, adding `python/tests-live/` is additive — this
suite's gating pattern (`RUN_LIVE_E2E` + api-key presence) serves as the template.

---

## mcp-passthrough.live.spec.ts (Phase 9)

Verifies MCP passthrough end-to-end with a real `gemini-cli` and a stub MCP
server at `spec/fixtures/mcp/stub.mjs`. Covers:

- **SC-1** — tool-call round-trip (echo tool invoked; tool + tool_result chunks visible)
- **SC-2** — real `~/.gemini/settings.json` mtime unchanged (live complement to the mock-spawn invariant in `ts/src/mcp/mcpPassthrough.spec.ts`)
- **SC-3a/b/c** — temp `GEMINI_CONFIG_DIR` removed after success / abort / error paths

SC-4 (Windows / cross-platform) is inherited from the CI matrix — this suite
runs on Windows, macOS, and Linux via the existing FDN-06 matrix when
`RUN_LIVE_E2E=1` and `GEMINI_API_KEY` are set.

Run locally:

```bash
cd ts
RUN_LIVE_E2E=1 GEMINI_API_KEY=sk-... pnpm test:live
```

Costs: each test makes ~1 Gemini API call; the full Phase 9 suite runs
~5 calls per invocation. Approval mode is `yolo` to avoid interactive
prompts in the non-TTY test environment.
