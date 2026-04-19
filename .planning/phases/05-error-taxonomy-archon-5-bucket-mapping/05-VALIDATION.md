---
phase: 5
slug: error-taxonomy-archon-5-bucket-mapping
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-14
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (TS) + pytest 7.x (Python) |
| **Config file** | `ts/vitest.config.ts`, `python/pyproject.toml` |
| **Quick run command** | `cd ts && pnpm test -- --run errors` / `cd python && pytest tests/test_errors.py -x` |
| **Full suite command** | `cd ts && pnpm test -- --run` / `cd python && pytest` |
| **Estimated runtime** | ~20 seconds |

---

## Sampling Rate

- **After every task commit:** Run targeted test file for changed module
- **After every plan wave:** Run full suite in both TS and Python
- **Before `/gsd:verify-work`:** Both language suites must be green + CI linter passes
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 05-01-T1 | 05-01 | 1 | ERR-04, ERR-05 | fixture-validate (human-action blocker) | `node scripts/validate-fixtures.mjs` | ⬜ Wave 0 | ⬜ pending |
| 05-01-T2 | 05-01 | 1 | ERR-01..ERR-05 | unit (RED scaffolds) | `cd ts && pnpm test -- --run tests/errors.test.ts tests/errorMapper.test.ts` | ⬜ creates | ⬜ pending |
| 05-01-T3 | 05-01 | 1 | ERR-01..ERR-05, PAR-05 | unit (RED scaffolds) | `cd python && uv run pytest tests/errors/` | ⬜ creates | ⬜ pending |
| 05-02-T1 | 05-02 | 2 | ERR-01, PAR-05 | yaml-parse + class-set check | `cd ts && node -e "const y=require('js-yaml').load(require('fs').readFileSync('../spec/errors.yaml','utf8')); const names=y.errors.map(e=>e.name); const required=['GeminiError','RateLimitError','AuthError','NotConfigured','Forbidden403','Expired','ToSViolation','ModelAccessError','InvalidPromptError','ProcessError','ProcessCrashError','AbortError','ParseError','UnsupportedFeatureError','GeminiNotFoundError']; const missing=required.filter(r=>!names.includes(r)); if(missing.length){console.error('MISSING:',missing); process.exit(1)} console.log('OK',names.length,'classes')"` | ⬜ creates | ⬜ pending |
| 05-02-T2 | 05-02 | 2 | ERR-01, ERR-02, ERR-03, PAR-05 | codegen + unit (GREEN after regen) | `node scripts/gen-errors.mjs && cd python && uv run python ../scripts/gen-errors.py && cd .. && cd ts && pnpm test -- --run tests/errors.test.ts` | ⬜ creates | ⬜ pending |
| 05-03-T1 | 05-03 | 3 | ERR-04, ERR-05, ERR-06 | unit + type-check (GREEN) | `cd ts && pnpm test -- --run tests/errorMapper.test.ts tests/errors.test.ts && pnpm tsc --noEmit` | ⬜ creates | ⬜ pending |
| 05-03-T2 | 05-03 | 3 | ERR-04, ERR-05, ERR-06, PAR-05 | unit + full-suite (GREEN) | `cd python && uv run pytest tests/errors/ -x && uv run pytest -x` | ⬜ creates | ⬜ pending |
| 05-04-T1 | 05-04 | 4 | ERR-07, PAR-05 | drift-lint (integration) | `bash scripts/lint-errors.sh` | ⬜ creates | ⬜ pending |
| 05-04-T2 | 05-04 | 4 | ERR-04, ERR-05, PAR-05 | fixture-corpus contract + parity | `cd ts && pnpm test -- --run tests/errorMapperCorpus.test.ts && cd ../python && uv run pytest tests/errors/test_error_mapper_corpus.py && cd .. && bash scripts/diff-test-names.sh && bash scripts/lint-errors.sh` | ⬜ creates | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Re-capture real gemini-cli stderr fixtures for `error-auth.*` and `error-rate-limit.*` (currently synthetic)
- [ ] Confirm `retryAfter` field name in real 429 JSON responses
- [ ] `ts/tests/errors.test.ts` — stubs for ERR-01..07
- [ ] `python/tests/test_errors.py` — stubs for ERR-01..07
- [ ] `ts/tests/error-mapper-parity.test.ts` — contract test stub (PAR-05)
- [ ] `python/tests/test_error_mapper_parity.py` — contract test stub (PAR-05)

*Note: Wave 0 fixture re-capture is a `checkpoint:human-action` task (05-01-T1) — it requires an intentionally invalid `GEMINI_API_KEY` and genuine quota exhaustion against a real Gemini account, which Claude cannot perform unassisted. All downstream `ErrorMapper` regex patterns and contract assertions depend on this re-capture completing with real upstream strings (or being explicitly flagged `synthetic: true` with a justification). Until 05-01-T1 lands real fixtures, `wave_0_complete: false` remains.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Re-capture real `error-auth` + `error-rate-limit` fixtures | ERR-04, ERR-05 | Requires invalid API key + genuinely-exhausted quota on a real account; no CLI/API substitute | See 05-01-PLAN.md Task 1 `<how-to-verify>` |

*All downstream behaviors (codegen, ErrorMapper, linter, corpus test) are fully automated.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (fixture re-capture)
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending (blocked on 05-01-T1 Wave 0 re-capture)
