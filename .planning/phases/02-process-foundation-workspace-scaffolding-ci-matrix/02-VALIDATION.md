---
phase: 2
slug: process-foundation-workspace-scaffolding-ci-matrix
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-12
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework (TS)** | Vitest 3.x (pin to `^3.2`) |
| **Framework (Python)** | pytest 8.x |
| **TS Config file** | `ts/vitest.config.ts` — Wave 0 |
| **Python Config file** | `python/pyproject.toml` `[tool.pytest.ini_options]` — Wave 0 |
| **TS Quick run command** | `cd ts && pnpm test --run` |
| **TS Full suite command** | `cd ts && pnpm test --run --coverage` |
| **Python Quick run command** | `cd python && uv run pytest -x` |
| **Python Full suite command** | `cd python && uv run pytest --tb=short` |
| **Estimated runtime** | ~30 seconds (both suites) |

---

## Sampling Rate

- **After every task commit:** `cd ts && pnpm test --run && cd ../python && uv run pytest -x`
- **After every plan wave:** Full suite + parity: `cd ts && pnpm test --run --coverage && cd ../python && uv run pytest --tb=short && bash scripts/diff-test-names.sh`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Req ID | Behavior | Test Type | Automated Command | File Exists |
|--------|----------|-----------|-------------------|-------------|
| FDN-01 | `resolveBinary()` finds `gemini` on PATH | unit | `cd ts && pnpm test --run src/process/BinaryResolver` | ❌ W0 |
| FDN-01 | `resolve_binary()` finds `gemini` on PATH | unit | `cd python && uv run pytest tests/test_binary_resolver.py -x` | ❌ W0 |
| FDN-02 | `spawn()` returns a ChildProcess/Process | unit | `cd ts && pnpm test --run src/process/SpawnPerCallStrategy` | ❌ W0 |
| FDN-03 | Windows `.cmd` spawn does not throw | platform | `cd ts && pnpm test --run src/process/SpawnPerCallStrategy` | ❌ W0 |
| FDN-04 | Subprocess stdout decoded as UTF-8 with replacement | unit | `cd ts && pnpm test --run src/process/EnvBuilder` | ❌ W0 |
| FDN-05 | `windowsHide: true` set in spawn options | unit | `cd ts && pnpm test --run src/process/SpawnPerCallStrategy` | ❌ W0 |
| FDN-06 | `killTree()` terminates process within 5s grace | integration | `cd ts && pnpm test --run src/process/ProcessManager` | ❌ W0 |
| FDN-07 | `buildEnv()` only passes allowlisted keys | unit | `cd ts && pnpm test --run src/process/EnvBuilder` | ❌ W0 |
| FDN-08 | `ProcessStrategy` interface implemented by SpawnPerCallStrategy | unit | `cd ts && pnpm test --run src/process/SpawnPerCallStrategy` | ❌ W0 |
| FDN-09 | `killTree()` kills MCP grandchildren (no orphans detected) | integration | `cd ts && pnpm test --run src/process/ProcessManager` | ❌ W0 |
| PLT-03 | `gemini --version` spawned and asserts non-empty on all OSes | smoke | CI matrix green | ❌ W0 |
| PLT-04 | Python anyio test runs under ProactorEventLoop on Windows | unit | `cd python && uv run pytest tests/ -x` | ❌ W0 |
| PLT-05 | Japanese codepage (chcp 932) + UTF-8 forcing produces correct output | smoke | CI ja-JP job green | ❌ W0 |
| PAR-01 | TS and Python `process/` modules have matching file layout | structural | `bash scripts/diff-test-names.sh` | ❌ W0 |
| PAR-03 | Test names match across TS and Python | parity | `bash scripts/diff-test-names.sh` | ❌ W0 |
| PAR-04 | Both packages report same version from VERSION file | unit | CI sync-version step | ❌ W0 |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `ts/vitest.config.ts` — Vitest config with node environment
- [ ] `ts/package.json` — with `"vitest": "^3.2"` devDependency and test script
- [ ] `ts/tsconfig.json` — ESM-mode TypeScript config
- [ ] `ts/src/process/BinaryResolver.test.ts` — covers FDN-01
- [ ] `ts/src/process/SpawnPerCallStrategy.test.ts` — covers FDN-02, FDN-03, FDN-05, FDN-08
- [ ] `ts/src/process/EnvBuilder.test.ts` — covers FDN-04, FDN-07
- [ ] `ts/src/process/ProcessManager.test.ts` — covers FDN-06, FDN-09
- [ ] `python/pyproject.toml` — with pytest, anyio, psutil deps and `[tool.pytest.ini_options]`
- [ ] `python/tests/conftest.py` — anyio pytest plugin registration
- [ ] `python/tests/test_binary_resolver.py` — covers FDN-01
- [ ] `python/tests/test_spawn_per_call.py` — covers FDN-02, FDN-03, FDN-05, FDN-08
- [ ] `python/tests/test_env_builder.py` — covers FDN-04, FDN-07
- [ ] `python/tests/test_process_manager.py` — covers FDN-06, FDN-09
- [ ] `pnpm-workspace.yaml` — workspace root config
- [ ] `scripts/sync-version.sh` — VERSION → package.json + pyproject.toml
- [ ] `scripts/diff-test-names.sh` — parity enforcement
- [ ] `VERSION` — plain-text root version file
- [ ] `.github/workflows/ci.yml` — CI matrix with representative jobs

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| CI matrix green on all 3 OSes | PLT-03 | Requires GitHub Actions runners | Push branch, verify all matrix jobs pass |
| Windows non-en-US locale test | PLT-05 | Requires Windows CI runner with chcp 932 | Verify ja-JP CI job passes without mojibake |
| Kill-mid-stream orphan detection | FDN-09 | Requires process tree inspection on each OS | Run kill test, verify no orphan PIDs remain via `ps` / `psutil` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
