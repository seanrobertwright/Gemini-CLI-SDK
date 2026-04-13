---
phase: 3
slug: ndjson-parser-eventdispatcher-messagechunk-types
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-12
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **TS Framework** | Vitest ^3.2 |
| **TS Config file** | `ts/vitest.config.ts` |
| **TS Quick run** | `cd ts && pnpm test` |
| **TS Full suite** | `cd ts && pnpm test:coverage` |
| **Python Framework** | pytest ^8.0 + pytest-anyio |
| **Python Config file** | `python/pyproject.toml` |
| **Python Quick run** | `cd python && uv run pytest tests/test_parse_ndjson.py tests/test_dispatch.py -x` |
| **Python Full suite** | `cd python && uv run pytest` |
| **Parity check** | `bash scripts/diff-test-names.sh` |
| **Estimated runtime** | ~10 seconds (TS) + ~5 seconds (Python) |

---

## Sampling Rate

- **After every task commit:** Run `cd ts && pnpm test`
- **After every plan wave:** Run `cd ts && pnpm test && cd python && uv run pytest && bash scripts/diff-test-names.sh`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 0 | PRS-05 | fixture update | `cat spec/fixtures/*.expected.json` | ✅ (update needed) | ⬜ pending |
| 03-01-02 | 01 | 0 | PRS-06 | smoke | `node scripts/validate-schema-ts.mjs` | ✅ | ⬜ pending |
| 03-02-01 | 02 | 1 | PRS-01 | unit | `cd ts && pnpm test -- parseNdjson` | ❌ W0 | ⬜ pending |
| 03-02-02 | 02 | 1 | PRS-02 | unit | `cd ts && pnpm test -- parseNdjson` | ❌ W0 | ⬜ pending |
| 03-02-03 | 02 | 1 | PRS-03 | unit+fixture | `cd ts && pnpm test -- parseNdjson` | ❌ W0 | ⬜ pending |
| 03-02-04 | 02 | 1 | PRS-04 | unit | `cd ts && pnpm test -- parseNdjson` | ❌ W0 | ⬜ pending |
| 03-03-01 | 03 | 1 | PRS-05 | fixture | `cd ts && pnpm test -- dispatch` | ❌ W0 | ⬜ pending |
| 03-03-02 | 03 | 1 | PRS-07 | unit | `cd ts && pnpm test -- dispatch` | ❌ W0 | ⬜ pending |
| 03-03-03 | 03 | 1 | PRS-07 | unit | `cd ts && pnpm test -- dispatch` | ❌ W0 | ⬜ pending |
| 03-04-01 | 04 | 2 | PAR-02 | parity | `cd python && uv run pytest tests/test_parse_ndjson.py -x` | ❌ W0 | ⬜ pending |
| 03-04-02 | 04 | 2 | PAR-02 | parity | `cd python && uv run pytest tests/test_dispatch.py -x` | ❌ W0 | ⬜ pending |
| 03-04-03 | 04 | 2 | PAR-02 | parity | `bash scripts/diff-test-names.sh` | ✅ | ⬜ pending |
| 03-05-01 | 05 | 3 | PRS-01,03,04 | fuzz | `cd ts && pnpm test -- fuzz` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `spec/fixtures/*.expected.json` — update all 12 files from Phase 1 placeholder shapes to real EventDispatcher output
- [ ] `spec/fixtures/thinking-synthetic.ndjson` + `.expected.json` — synthetic thinking variant fixture
- [ ] `spec/fixtures/multi-tool.ndjson` + `.expected.json` — synthetic concurrent tool pairing fixture
- [ ] `ts/src/parser/parseNdjson.spec.ts` — test stubs for PRS-01/02/03/04
- [ ] `ts/src/parser/dispatch.spec.ts` — test stubs for PRS-05/07
- [ ] `python/tests/test_parse_ndjson.py` — Python mirror test stubs
- [ ] `python/tests/test_dispatch.py` — Python mirror test stubs

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
