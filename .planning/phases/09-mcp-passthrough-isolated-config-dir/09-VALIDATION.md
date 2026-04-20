---
phase: 9
slug: mcp-passthrough-isolated-config-dir
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-20
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (TS) + pytest (Python mirror) |
| **Config file** | `ts/vitest.config.ts`, `py/pyproject.toml` |
| **Quick run command** | `pnpm -C ts test -- --run mcp` |
| **Full suite command** | `pnpm -C ts test -- --run && pytest py` |
| **Estimated runtime** | ~60 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm -C ts test -- --run mcp`
- **After every plan wave:** Run `pnpm -C ts test -- --run && pytest py`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| *To be filled by planner* | - | - | - | - | - | - | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `ts/src/mcp/` — new module directory for `writeConfigDir`/`cleanupConfigDir` helpers
- [ ] `spec/fixtures/mcp/stub-server.mjs` — stub MCP stdio server for tests
- [ ] `spec/fixtures/mcp/stub_server.py` — Python mirror stub
- [ ] `ts/test/mcp/` + `py/tests/mcp/` — test directories
- [ ] `@modelcontextprotocol/sdk` (TS) + `mcp` (Python) pinned in package manifests

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| *None expected — all MCP behaviors automatable via stub server* | - | - | - |

*If none: "All phase behaviors have automated verification."*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
