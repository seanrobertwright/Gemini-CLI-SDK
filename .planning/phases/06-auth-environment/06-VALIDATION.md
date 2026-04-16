---
phase: 6
slug: auth-environment
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-15
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (TS) + pytest 7.x (Python) |
| **Config file** | `typescript/vitest.config.ts`, `python/pyproject.toml` |
| **Quick run command** | `cd typescript && pnpm test -- auth` / `cd python && pytest tests/auth -q` |
| **Full suite command** | `cd typescript && pnpm test` / `cd python && pytest` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run quick run command for the affected language
- **After every plan wave:** Run full suite command for both languages
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| TBD | — | — | AUT-01..09 | unit + integration + lint | see plans | ⬜ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `typescript/src/auth/resolveAuth.ts` — pure precedence resolver (stub + tests)
- [ ] `typescript/tests/auth/resolveAuth.test.ts` — snapshot tests for 4 fixtures + warning
- [ ] `python/src/gemini_sdk/auth/resolve.py` — Python port
- [ ] `python/tests/auth/test_resolve.py` — parity fixtures
- [ ] `tests/fixtures/auth/` — 4 env fixtures (API-key, SA-JSON, Vertex-key, ADC)
- [ ] `scripts/lint-auth-login.sh` — CI linter asserting no `auth login` in sources

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live invalid-API-key `AuthError` classification (SC-3) | AUT-07 | Requires network + may hit Windows OAuth-cache bypass (see Phase 5 notes) | Unset OAuth creds, set `GEMINI_API_KEY=invalid`, run `query("ping")`, confirm `AuthError` subtype + bucket=auth |

*If no live capture succeeds, fall back to synthetic stderr fixture per RESEARCH.md Open Question #3.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
