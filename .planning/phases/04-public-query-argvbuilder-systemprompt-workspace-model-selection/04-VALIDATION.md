---
phase: 4
slug: public-query-argvbuilder-systemprompt-workspace-model-selection
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-13
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^3.2 (TS) / pytest ^8.0 + pytest-anyio (Python) |
| **Config file** | `ts/vitest.config.ts` / `python/pyproject.toml` [tool.pytest.ini_options] |
| **Quick run command** | `cd ts && pnpm test -- --reporter=verbose src/query/` |
| **Full suite command** | `cd ts && pnpm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd ts && pnpm test -- src/query/` + `cd python && uv run pytest tests/test_build_argv.py tests/test_query.py -x`
- **After every plan wave:** Run `cd ts && pnpm test` + `cd python && uv run pytest`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | API-02 | unit + property | `pnpm test -- src/query/buildArgv.spec.ts` | ❌ W0 | ⬜ pending |
| 04-01-02 | 01 | 1 | MDL-01 | unit | `pnpm test -- src/query/buildArgv.spec.ts` | ❌ W0 | ⬜ pending |
| 04-01-03 | 01 | 1 | MDL-02 | unit | `pnpm test -- src/query/buildArgv.spec.ts` | ❌ W0 | ⬜ pending |
| 04-01-04 | 01 | 1 | MDL-03 | unit | `pnpm test -- src/query/buildArgv.spec.ts` | ❌ W0 | ⬜ pending |
| 04-01-05 | 01 | 1 | CWD-02 | unit | `pnpm test -- src/query/buildArgv.spec.ts` | ❌ W0 | ⬜ pending |
| 04-02-01 | 02 | 1 | API-01 | integration (mock spawn) | `pnpm test -- src/query/query.spec.ts` | ❌ W0 | ⬜ pending |
| 04-02-02 | 02 | 1 | API-03 | unit (mock spawn) | `pnpm test -- src/query/query.spec.ts` | ❌ W0 | ⬜ pending |
| 04-02-03 | 02 | 1 | API-04 | unit (mock spawn) | `pnpm test -- src/query/query.spec.ts` | ❌ W0 | ⬜ pending |
| 04-02-04 | 02 | 1 | API-05 | unit (mock query) | `pnpm test -- src/query/query.spec.ts` | ❌ W0 | ⬜ pending |
| 04-02-05 | 02 | 1 | API-06 | unit (mock spawn) | `pnpm test -- src/query/query.spec.ts` | ❌ W0 | ⬜ pending |
| 04-02-06 | 02 | 1 | SYS-01 | unit (mock spawn) | `pnpm test -- src/query/query.spec.ts` | ❌ W0 | ⬜ pending |
| 04-02-07 | 02 | 1 | SYS-02 | unit | `pnpm test -- src/query/query.spec.ts` | ❌ W0 | ⬜ pending |
| 04-02-08 | 02 | 1 | CWD-01 | unit | `pnpm test -- src/query/query.spec.ts` | ❌ W0 | ⬜ pending |
| 04-02-09 | 02 | 1 | MDL-04 | unit | `pnpm test -- src/query/query.spec.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `ts/src/query/buildArgv.spec.ts` — unit + fuzz tests (API-02, MDL-01..04, CWD-02)
- [ ] `ts/src/query/query.spec.ts` — integration/mock tests (API-01..06, SYS-01..02, CWD-01, MDL-04)
- [ ] `python/tests/test_build_argv.py` — Python parity for buildArgv
- [ ] `python/tests/test_query.py` — Python parity for query
- [ ] Dev dep: `cd ts && pnpm add -D @fast-check/vitest fast-check` for fuzz test (API-02)

*Existing infrastructure covers test framework setup (Vitest + pytest installed in prior phases).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| First real `gemini-cli` round-trip | API-01 | Requires live CLI binary + API key | Run `pnpm tsx examples/hello.ts` with valid GEMINI_API_KEY |
| Model downgrade detection with live CLI | MDL-04 | CLI behavior varies by account/model availability | Request `2.5-pro`, verify `actualModel` field on ResultChunk |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
