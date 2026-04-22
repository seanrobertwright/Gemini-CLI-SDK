---
"@gemini-sdk/core": major
---

Initial v1.0.0 release.

First public release of the Gemini SDK. TypeScript + Python packages ship in lock-step with shared NDJSON fixtures.

Highlights:
- Public `query()` async generator (TS + Python) wraps `gemini-cli` as a subprocess
- 8-variant `MessageChunk` union matches Claude Agent SDK shape
- Typed `GeminiError` hierarchy with 1:1 mapping to Archon's 5 retry buckets
- Multi-turn sessions via `--resume`; transcript-prepend fallback for #14180
- MCP passthrough via isolated temp `GEMINI_CONFIG_DIR` (never mutates user settings)
- Tools + approval-mode + best-effort structured output (Zod/Pydantic retry once)
- `GEMINI_SDK_COMPAT` env var controls the runtime compat probe (warn/strict/silent)
- Archon adapter subpackage ships as a local bundle in `pr-artifacts/`

See `docs/known-issues.md` for the upstream bugs this SDK defends against.

Requirements: gemini-cli 0.37.x, Node 18+, Python 3.10+.
