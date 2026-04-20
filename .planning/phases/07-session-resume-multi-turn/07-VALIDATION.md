---
phase: 7
slug: session-resume-multi-turn
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-19
updated: 2026-04-19
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

Phase 7 leverages existing test infrastructure (vitest + pytest + fast-check + hypothesis + diff-test-names.sh) — no Wave 0 scaffolding needed beyond the new Python test package init.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **TS framework** | Vitest `^3.2` |
| **TS config file** | `ts/vitest.config.ts` (include: `src/**/*.{test,spec}.ts`) |
| **TS quick run command** | `cd ts && pnpm test -- --run <spec-file>` |
| **TS full suite command** | `cd ts && pnpm test` |
| **Python framework** | pytest `>=8.0` + hypothesis |
| **Python config file** | `python/pyproject.toml` (testpaths: `tests/`) |
| **Python quick run command** | `cd python && uv run pytest <test-file> -x` |
| **Python full suite command** | `cd python && uv run pytest` |
| **Parity check** | `bash scripts/diff-test-names.sh` |
| **Spec citation check** | `node scripts/validate-fixtures.mjs citations` |
| **TS type check** | `cd ts && pnpm exec tsc --noEmit` |
| **Estimated runtime** | ~60 seconds TS full suite + ~30 seconds Python full suite + ~5 seconds parity |

---

## Sampling Rate

- **After every task commit:** Run the task's `<automated>` verify command (see Per-Task Verification Map below).
- **After every plan wave:** Run `cd ts && pnpm test && cd ../python && uv run pytest && cd .. && bash scripts/diff-test-names.sh`.
- **Before `/gsd:verify-work`:** Full TS + Python suites green, parity green, `tsc --noEmit` clean, citations validator green.
- **Max feedback latency:** ~90 seconds per full-suite cycle.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | 1 | SES-03 | unit | `cd ts && pnpm test -- --run src/session/Session.spec.ts` | ❌ created in Task | ⬜ pending |
| 07-01-02 | 01 | 1 | SES-03 | unit | `cd python && uv run pytest tests/session/ -x` | ❌ created in Task | ⬜ pending |
| 07-01-03 | 01 | 1 | SES-03 | smoke + parity | `cd ts && pnpm exec tsc --noEmit && cd ../python && uv run python -c "from gemini_sdk import Session, TranscriptEntry, normalise_session_id" && cd .. && bash scripts/diff-test-names.sh` | ✅ existing | ⬜ pending |
| 07-02-01 | 02 | 2 | SES-02, SES-04 | unit (pure function + env mock) | `cd ts && pnpm test -- --run src/query/buildArgv.spec.ts` | ✅ extend existing | ⬜ pending |
| 07-02-02 | 02 | 2 | SES-01, SES-02, SES-04 | integration (mock spawn + fixture NDJSON) | `cd ts && pnpm test -- --run src/query/query.spec.ts` | ✅ extend existing | ⬜ pending |
| 07-03-01 | 03 | 3 | SES-02, SES-04 (Python side) | unit + parity | `cd python && uv run pytest tests/test_build_argv.py -x && cd .. && bash scripts/diff-test-names.sh` | ✅ extend existing | ⬜ pending |
| 07-03-02 | 03 | 3 | SES-01, SES-02, SES-04 (Python side) | integration + parity + spec | `cd python && uv run pytest tests/test_query.py -x && cd .. && bash scripts/diff-test-names.sh && node scripts/validate-fixtures.mjs citations` | ✅ extend existing | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `ts/src/session/Session.spec.ts` — created in Plan 07-01 Task 1 (covers SES-03 round-trip, construction paths, normalisation)
- [x] `python/tests/session/__init__.py` — created in Plan 07-01 Task 2 (empty file so pytest collects the session/ subdirectory)
- [x] `python/tests/session/test_session.py` — created in Plan 07-01 Task 2 (Python mirror of Session.spec.ts)
- [x] Session source files (`ts/src/session/Session.ts`, `python/src/gemini_sdk/session/session.py`, and their barrel exports) — created in Plan 07-01

All downstream plans (07-02, 07-03) import from these files via standard package paths. No framework install required — vitest, pytest, fast-check, hypothesis are already present from Phase 2/4.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Kill-mid-session subprocess + resume in a new query() call on all three OSes | Phase 7 ROADMAP SC-4 | Requires live `gemini-cli` binary + real OAuth/API-key auth; not hermetic within a unit-test harness | On each of Windows/macOS/Linux: run `query(prompt="long-running prompt")`, call `abortSignal.abort()` after receiving the first chunk, confirm subprocess is killed (`psutil.pid_exists(pid)` returns False within 5s), then issue `queryFull(prompt="ok?", session=captured_session)` and confirm the second call completes successfully. |
| Live bad-id probe (RESEARCH Open Question #2) | Research follow-up only — not a Phase 7 v1 requirement | Requires running `gemini --resume nonexistent-id-12345 -p "hello"` on the capture host; output is environment-dependent and not deterministic across CLI versions. | Out of scope for v1 Phase 7 execution. Tracked as a research follow-up; if run, record exit code + stderr + first init event in `.planning/phases/07-session-resume-multi-turn/07-03-SUMMARY.md`. If a distinct stderr pattern emerges, open a follow-up plan to add `SessionNotFoundError` to `spec/errors.yaml` (deferred per CONTEXT.md). |

**SC-4 rationale for manual status:** Per 07-RESEARCH.md §"Cross-Platform: Kill-Mid-Session Resume Semantics", no new teardown logic is introduced in Phase 7. The kill-mid-session mechanics are already covered by Phase 2's `kill_tree` tests and Phase 4's abort-flush tests. Phase 7 adds no SDK-owned state to tear down (Session is a plain value object; gemini-cli owns checkpoint state internally). A live cross-OS smoke test is the honest way to verify SC-4 — but it is neither a code-level contract nor a per-commit gate. Treat as pre-release phase-gate verification (run once before `/gsd:verify-work` sign-off).

---

## Test Count Expectations

| File | Before Phase 7 | After Phase 7 | Delta |
|------|----------------|---------------|-------|
| `ts/src/session/Session.spec.ts` | 0 | 8 | +8 new |
| `python/tests/session/test_session.py` | 0 | 9 (8 mirrored + 1 Python-only frozen) | +9 new |
| `ts/src/query/buildArgv.spec.ts` | ~40 | ~50 | +10 new session tests |
| `python/tests/test_build_argv.py` | 29+3 | 39+3 | +10 new session tests |
| `ts/src/query/query.spec.ts` | ~17 | ~27 | +10 new Phase 7 tests |
| `python/tests/test_query.py` | ~17 | ~27 | +10 new Phase 7 tests |

**Parity (diff-test-names.sh):** TS Phase-7-added count = Python Phase-7-added count after all three plans complete. The TestSessionFrozen Python-only test must not appear in the TS↔Python diff (verified in Plan 07-01 Task 3).

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify commands or Wave 0 dependencies (Wave 0 satisfied within Plan 07-01 itself — no external scaffolding)
- [x] Sampling continuity: every task has an automated command; no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (all new source + test files created within Plan 07-01)
- [x] No watch-mode flags — all commands run `-x` / `--run` / single-shot
- [x] Feedback latency < 90 seconds (quick-run per spec file is seconds; full suite ~60-90s)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-04-19 (planner self-approval; updated after Phase 7 research + all three plans authored)
