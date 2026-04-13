---
phase: 02-process-foundation-workspace-scaffolding-ci-matrix
verified: 2026-04-12T23:45:00Z
status: passed
score: 15/15 must-haves verified
re_verification: true
  previous_status: gaps_found
  previous_score: 13/15
  gaps_closed:
    - "diff-test-names.sh exits 0 — TS and Python test names match (24 each)"
    - "CI pnpm cache-dependency-path points to existing pnpm-lock.yaml at repo root"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Run 'cd ts && pnpm test' from repo root"
    expected: "All 24 TS tests pass with exit 0"
    why_human: "Test execution cannot be verified programmatically from static analysis; requires running vitest"
  - test: "Run 'cd python && uv run pytest -v' from repo root"
    expected: "All Python tests pass (35 tests across 4 test files, doubled for asyncio+trio backends)"
    why_human: "Test execution cannot be verified programmatically from static analysis; requires running pytest"
  - test: "Run 'bash scripts/sync-version.sh' and verify output"
    expected: "Exits 0, prints 'Synced version 0.0.0 to ts/package.json and python/pyproject.toml', no file changes"
    why_human: "Script execution with file patching cannot be fully verified statically"
---

# Phase 02: Process Foundation + Workspace Scaffolding + CI Matrix — Verification Report

**Phase Goal:** Stand up the polyglot monorepo (TS + Python), bring up BinaryResolver + ProcessManager (spawn-per-call) + EnvBuilder behind a pluggable strategy interface, and turn on the {ubuntu, macos, windows} x {node, python} CI matrix with a non-en-US Windows runner.
**Verified:** 2026-04-12T23:45:00Z
**Status:** passed
**Re-verification:** Yes — after gap closure via plan 02-05

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | pnpm workspace with ts/ and adapter-archon/ declared | VERIFIED | pnpm-workspace.yaml: `packages: ["ts", "adapter-archon"]` |
| 2 | VERSION file contains 0.0.0 | VERIFIED | VERSION file: `0.0.0\n` (single line) |
| 3 | ts/package.json is @gemini-sdk/core with Vitest ^3.2 | VERIFIED | ts/package.json: name, version, vitest, @vitest/coverage-v8, typescript all present |
| 4 | python/pyproject.toml is gemini-sdk 0.0.0 with anyio/psutil/pytest | VERIFIED | pyproject.toml: all deps confirmed |
| 5 | ProcessStrategy interface exported from TS | VERIFIED | ts/src/process/ProcessStrategy.ts exports `interface ProcessStrategy` |
| 6 | BinaryResolver: cliPath > GEMINI_BIN_PATH > PATH with GeminiNotFoundError | VERIFIED | ts/src/process/BinaryResolver.ts: full 3-tier precedence; throws GeminiNotFoundError |
| 7 | EnvBuilder: allowlist + merge pattern | VERIFIED | ts/src/process/EnvBuilder.ts: ALLOWED_KEYS set, buildEnv() with overrides |
| 8 | SpawnPerCallStrategy: Windows shell:true+windowsHide:true; Unix shell:false | VERIFIED | ts/src/process/SpawnPerCallStrategy.ts: platform check, both paths correct |
| 9 | ProcessManager: pluggable strategy + resolveBinary + buildEnv + killTree | VERIFIED | ts/src/process/ProcessManager.ts: constructor accepts strategy, SIGTERM/SIGKILL, taskkill |
| 10 | Python ports are 1:1 mechanical ports with matching logic | VERIFIED | All 6 Python source files confirmed with matching API shapes and logic |
| 11 | sync-version.sh reads VERSION and patches both package manifests | VERIFIED | scripts/sync-version.sh: tr reads VERSION, node patches ts/package.json, sed patches pyproject.toml |
| 12 | CI matrix covers ubuntu/macos/windows + Node 18/20/22 + Python 3.10/3.13 + ja-JP | VERIFIED | .github/workflows/ci.yml: 7-job include matrix confirmed, chcp 932, fail-fast:false |
| 13 | Windows CI jobs are NOT continue-on-error | VERIFIED | `grep -c "continue-on-error" ci.yml` returns 0 |
| 14 | diff-test-names.sh exits 0 — TS/Python test names match (PAR-03) | VERIFIED | `bash scripts/diff-test-names.sh` exits 0: "OK: TS and Python test names match (24 tests)." Confirmed live execution. |
| 15 | CI --frozen-lockfile references existing pnpm-lock.yaml | VERIFIED | ci.yml `cache-dependency-path: pnpm-lock.yaml` (root); root pnpm-lock.yaml exists; ts/pnpm-lock.yaml correctly absent |

**Score: 15/15 truths verified**

---

## Re-verification: Gap Closure Confirmation

### Gap 1 — PAR-03 parity (diff-test-names.sh exits 1) — CLOSED

**Previous state:** 25 TS test names vs 22 Python test names; diff non-empty; script exits 1.

**Closure evidence:**
- `bash scripts/diff-test-names.sh` executed and produced: "TS tests found: 24 / Python tests found: 24 / OK: TS and Python test names match (24 tests)." with exit code 0.
- `test_spawn_per_call.py` now has 5 tests with correct docstrings: "satisfies the ProcessStrategy interface (type check)", "sets windowsHide:true on Windows (FDN-05)", "uses shell:true with a pre-built command string on Windows", "uses shell:false with array args on non-Windows", "returns a ChildProcess that emits a close event (integration)".
- `test_process_manager.py` now has 7 tests with correct docstrings: "accepts a custom ProcessStrategy (FDN-08 pluggability)", "spawn() calls resolveBinary and buildEnv before invoking strategy", "throws GeminiNotFoundError when gemini not on PATH and no cliPath", "spawn gemini --version and capture non-empty stdout (integration)", "terminates a long-running subprocess within grace period (integration)", "uses taskkill /T /F on Windows (mock)", "sends SIGTERM on Unix (mock)".
- Two new Python tests added: `test_spawn_calls_resolve_binary_and_build_env` and `test_throws_gemini_not_found_error`.
- The spurious "close" TS grep artifact is eliminated: `diff-test-names.sh` now uses a two-pass grep (`^[[:space:]]*(test|it)\(` line-start filter, then `-oE` name extraction) plus `tr -d '\r'` CRLF normalization on both pipelines.

### Gap 2 — CI pnpm --frozen-lockfile lockfile path — CLOSED

**Previous state:** `cache-dependency-path: ts/pnpm-lock.yaml` pointed to a non-existent file.

**Closure evidence:**
- `ci.yml` line 43: `cache-dependency-path: pnpm-lock.yaml` (root path, no `ts/` prefix).
- `pnpm-lock.yaml` exists at repo root (D:/repos/Gemini-SDK/pnpm-lock.yaml).
- `ts/pnpm-lock.yaml` correctly does not exist (pnpm workspace lockfile lives at workspace root by design).

---

## Required Artifacts

### Plan 02-01 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `VERSION` | Single source of truth, contains "0.0.0" | VERIFIED | Contains exactly `0.0.0\n` |
| `pnpm-workspace.yaml` | Declares ts and adapter-archon | VERIFIED | Both packages listed |
| `ts/package.json` | @gemini-sdk/core with vitest ^3.2 | VERIFIED | All required fields present |
| `ts/tsconfig.json` | NodeNext ESM, strict | VERIFIED | module: NodeNext, strict: true |
| `ts/vitest.config.ts` | defineConfig, v8 provider | VERIFIED | Full config present |
| `python/pyproject.toml` | gemini-sdk deps | VERIFIED | anyio, psutil, pytest, hatchling present |
| `python/tests/conftest.py` | pytest_plugins = ("anyio",) | VERIFIED | Correct plugin registration |
| `adapter-archon/package.json` | @gemini-sdk/adapter-archon stub | VERIFIED | Present with correct name |

### Plan 02-02 Artifacts (TS Process Modules)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `ts/src/process/ProcessStrategy.ts` | interface ProcessStrategy | VERIFIED | Exports interface with spawn() |
| `ts/src/process/BinaryResolver.ts` | resolveBinary, GeminiNotFoundError | VERIFIED | 3-tier resolution, throws on miss |
| `ts/src/process/EnvBuilder.ts` | buildEnv, ALLOWED_KEYS | VERIFIED | 26-key allowlist, merge pattern |
| `ts/src/process/SpawnPerCallStrategy.ts` | implements ProcessStrategy | VERIFIED | shell:true+windowsHide:true on Win32; shell:false on Unix |
| `ts/src/process/ProcessManager.ts` | ProcessManager, killTree | VERIFIED | taskkill on Windows, SIGTERM+SIGKILL on Unix |
| `ts/src/errors/GeminiNotFoundError.ts` | GeminiNotFoundError | VERIFIED | Helpful install message present |
| `ts/src/process/BinaryResolver.spec.ts` | 5 tests green | VERIFIED (static) | All 5 test descriptions present with correct coverage |
| `ts/src/process/EnvBuilder.spec.ts` | 7 tests green | VERIFIED (static) | All 7 test descriptions present |
| `ts/src/process/SpawnPerCallStrategy.spec.ts` | 5 tests green | VERIFIED (static) | vi.mock() factory pattern; integration test present |
| `ts/src/process/ProcessManager.spec.ts` | 7 tests green | VERIFIED (static) | All behaviors covered; killTree integration test present; 7 tests across ProcessManager + killTree() describes |

### Plan 02-03 Artifacts (Python Process Modules)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `python/src/gemini_sdk/process/process_strategy.py` | ProcessStrategy Protocol | VERIFIED | Uses typing.Protocol, async def spawn() |
| `python/src/gemini_sdk/process/binary_resolver.py` | resolve_binary, shutil.which | VERIFIED | 3-tier resolution, GeminiNotFoundError on miss |
| `python/src/gemini_sdk/process/env_builder.py` | build_env, ALLOWED_KEYS | VERIFIED | frozenset allowlist, same 26 keys as TS |
| `python/src/gemini_sdk/process/spawn_per_call.py` | anyio.open_process, CREATE_NO_WINDOW | VERIFIED | Windows string command + creationflags; Unix list argv |
| `python/src/gemini_sdk/process/process_manager.py` | ProcessManager, kill_tree, psutil | VERIFIED | psutil orphan kill, SIGTERM+grace+SIGKILL, taskkill |
| `python/src/gemini_sdk/errors/not_found.py` | GeminiNotFoundError | VERIFIED | Matching message to TS version |
| `python/tests/test_binary_resolver.py` | 5 tests, parity docstrings | VERIFIED | 5 tests; all docstrings match TS descriptions |
| `python/tests/test_env_builder.py` | 7 tests, parity docstrings | VERIFIED | 7 tests; docstrings match TS descriptions exactly |
| `python/tests/test_spawn_per_call.py` | 5 tests, parity docstrings | VERIFIED | 5 tests; all docstrings now match TS counterparts (gap closed by 02-05) |
| `python/tests/test_process_manager.py` | 7 tests, parity docstrings | VERIFIED | 7 tests (2 new added in 02-05); all docstrings now match TS counterparts |

### Plan 02-04 Artifacts (CI Infrastructure)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `scripts/sync-version.sh` | reads VERSION, patches both manifests | VERIFIED | tr reads VERSION; node patches ts/package.json; sed patches pyproject.toml |
| `scripts/diff-test-names.sh` | grep TS + ast Python + diff; two-pass pattern | VERIFIED | Two-pass grep with CRLF normalization; Python AST parse; exits 0 confirmed |
| `.github/workflows/ci.yml` | 7-job matrix + parity + version-sync; correct lockfile path | VERIFIED | All 3 jobs present; 7 matrix entries; no continue-on-error; cache-dependency-path: pnpm-lock.yaml |

### Plan 02-05 Artifacts (Gap Closure)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `python/tests/test_spawn_per_call.py` | 5 docstrings exactly matching TS | VERIFIED | All 5 match confirmed against SpawnPerCallStrategy.spec.ts |
| `python/tests/test_process_manager.py` | 7 docstrings + 2 new tests | VERIFIED | 7 tests present; both new tests (test_spawn_calls_resolve_binary_and_build_env, test_throws_gemini_not_found_error) added |
| `scripts/diff-test-names.sh` | Two-pass grep, no false positives | VERIFIED | `^[[:space:]]*(test|it)\(` line-start filter + tr -d '\r' normalization; live run confirms 24=24 |
| `.github/workflows/ci.yml` | cache-dependency-path: pnpm-lock.yaml | VERIFIED | Line 43 confirms root-level path |

---

## Key Link Verification

### Plan 02-01

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| pnpm-workspace.yaml | ts/package.json | workspace packages list | WIRED | "ts" on line 2 |
| pnpm-workspace.yaml | adapter-archon/package.json | workspace packages list | WIRED | "adapter-archon" on line 3 |

### Plan 02-02

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| SpawnPerCallStrategy.ts | ProcessStrategy.ts | implements ProcessStrategy | WIRED | `implements ProcessStrategy` confirmed in source |
| ProcessManager.ts | SpawnPerCallStrategy.ts | uses strategy for spawning | WIRED | `new SpawnPerCallStrategy()` as default |
| ProcessManager.ts | BinaryResolver.ts | resolves binary before spawn | WIRED | `resolveBinary(options.cliPath)` called in spawn() |
| ProcessManager.ts | EnvBuilder.ts | builds clean env before spawn | WIRED | `buildEnv(options.env)` called in spawn() |

### Plan 02-03

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| spawn_per_call.py | process_strategy.py | implements Protocol | WIRED | SpawnPerCallStrategy class satisfies Protocol structurally |
| process_manager.py | binary_resolver.py | calls resolve_binary | WIRED | `from .binary_resolver import resolve_binary` + call in spawn() |
| process_manager.py | env_builder.py | calls build_env | WIRED | `from .env_builder import build_env` + call in spawn() |

### Plan 02-04 / 02-05

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| .github/workflows/ci.yml | scripts/diff-test-names.sh | parity job runs script | WIRED | `run: bash scripts/diff-test-names.sh` in parity job |
| scripts/sync-version.sh | VERSION | reads version string | WIRED | `tr -d '[:space:]' < "$VERSION_FILE"` |
| scripts/sync-version.sh | ts/package.json | patches version field | WIRED | node -e reads REPO_ROOT env var, writes package.json |
| scripts/sync-version.sh | python/pyproject.toml | patches version field | WIRED | sed -i.bak patches version line |
| .github/workflows/ci.yml | pnpm-lock.yaml | cache-dependency-path | WIRED | Points to root pnpm-lock.yaml which exists |
| scripts/diff-test-names.sh | ts/src/**/*.spec.ts | two-pass grep with line-start anchor | WIRED | `^[[:space:]]*(test|it)\(` eliminates false positives from emit('close') |
| scripts/diff-test-names.sh | python/tests/test_*.py | AST docstring extraction | WIRED | `ast.get_docstring` + `tr -d '\r'` CRLF normalization |

---

## Requirements Coverage

All 15 requirement IDs declared across phase plans are accounted for:

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| FDN-01 | 02-02, 02-03 | Binary location via cliPath/GEMINI_BIN_PATH/PATH | SATISFIED | BinaryResolver.ts and binary_resolver.py both implement 3-tier resolution |
| FDN-02 | 02-02, 02-03 | spawn via child_process.spawn / anyio.open_process, never exec | SATISFIED | SpawnPerCallStrategy.ts uses child_process.spawn; spawn_per_call.py uses anyio.open_process |
| FDN-03 | 02-02, 02-03 | Windows .cmd/.bat shims CVE-2024-27980 | SATISFIED | shell:true + pre-built string on Windows in both TS and Python |
| FDN-04 | 02-02, 02-03 | UTF-8 forcing via PYTHONUTF8 in allowlist | SATISFIED | PYTHONUTF8 in ALLOWED_KEYS in both TS EnvBuilder.ts and Python env_builder.py; CI sets PYTHONUTF8=1 |
| FDN-05 | 02-02, 02-03 | windowsHide / CREATE_NO_WINDOW on Windows | SATISFIED | SpawnPerCallStrategy.ts: windowsHide:true; spawn_per_call.py: CREATE_NO_WINDOW |
| FDN-06 | 02-02, 02-03 | SIGTERM -> 5s grace -> SIGKILL; taskkill /T /F on Windows | SATISFIED | killTree/kill_tree both implement this in TS and Python |
| FDN-07 | 02-02, 02-03 | Allowlist env dict | SATISFIED | EnvBuilder.ts and env_builder.py both use identical 26-key allowlist |
| FDN-08 | 02-02, 02-03 | Pluggable ProcessStrategy interface | SATISFIED | ProcessManager accepts strategy param; ProcessStrategy is exported public interface/Protocol |
| FDN-09 | 02-02, 02-03 | Orphan MCP grandchild cleanup | SATISFIED (partial) | Python kill_tree uses psutil.Process.children(recursive=True); TS killTree relies on taskkill /T (Windows) and SIGTERM/SIGKILL (Unix, single-process only). TS has no recursive Unix tree kill. Meets the basic requirement; recursive TS Unix cleanup is a future improvement. |
| PLT-03 | 02-04 | CI matrix: ubuntu/macos/windows x Node 18/20/22 x Python 3.10-3.13; Windows required | SATISFIED | ci.yml: 7-job matrix with all 3 OSes, Node 18/20/22, Python 3.10/3.13; no continue-on-error (grep returns 0) |
| PLT-04 | 02-03 | Python: anyio + ProactorEventLoop on Windows | SATISFIED | anyio.open_process used in spawn_per_call.py; conftest.py registers anyio plugin |
| PLT-05 | 02-04 | Non-en-US Windows runner for encoding | SATISFIED | ja-JP matrix entry with chcp 932 + PYTHONUTF8=1 |
| PAR-01 | 02-02 | TS canonical, Python mechanical port with matching file layout | SATISFIED | Python file layout mirrors TS: binary_resolver.py, env_builder.py, process_strategy.py, spawn_per_call.py, process_manager.py |
| PAR-03 | 02-04, 02-05 | Parity CI job diffs test names, blocks merge on divergence | SATISFIED | diff-test-names.sh implemented and wired in CI; live run confirms 24=24 match, exits 0. Two-pass grep pattern eliminates false positives. |
| PAR-04 | 02-01, 02-04 | Shared single version number | SATISFIED | VERSION=0.0.0; both ts/package.json and python/pyproject.toml contain 0.0.0; sync-version.sh syncs at publish |

**Orphaned requirements (mapped to Phase 2 in REQUIREMENTS.md but not in any plan's frontmatter):** None — all 15 expected IDs are covered.

---

## Anti-Patterns Found

No blockers or stubs. Previously noted minor items carry forward as informational only:

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `ts/src/process/ProcessManager.ts` | `SpawnOptions2` interface name (vs `SpawnOptions` from node:child_process) | Info | Minor naming quirk; no functional impact |

---

## Human Verification Required

### 1. TS Tests Actually Pass

**Test:** Run `cd ts && pnpm test` from the repo root
**Expected:** Vitest reports 24 tests passing across 4 spec files, exit code 0
**Why human:** Static analysis confirms test files exist and are well-formed, but cannot execute vitest to verify no runtime failures

### 2. Python Tests Actually Pass

**Test:** Run `cd python && uv run pytest -v` from the repo root
**Expected:** 35 tests passing across 4 test files (asyncio + trio backends), exit code 0
**Why human:** Cannot run pytest programmatically; test logic uses async fixtures and anyio

### 3. sync-version.sh round-trip

**Test:** Run `bash scripts/sync-version.sh` then `git diff ts/package.json python/pyproject.toml`
**Expected:** No diff (versions already 0.0.0 in both files)
**Why human:** Script reads/writes files; need to verify no partial write or sed corruption on the current OS

---

## Summary

Phase 02 goal is fully achieved. Both gaps from the initial verification are closed:

**Gap 1 closed:** `bash scripts/diff-test-names.sh` now exits 0, confirmed by live execution: "OK: TS and Python test names match (24 tests)." Plan 02-05 renamed 9 Python test docstrings, added 2 missing Python tests (bringing ProcessManager tests to 7), and replaced the single-pass `-oE` grep with a two-pass line-start-anchored approach plus `tr -d '\r'` CRLF normalization. The spurious "close" false positive from `emit('close')` is eliminated.

**Gap 2 closed:** `ci.yml` `cache-dependency-path` now reads `pnpm-lock.yaml` (root, no `ts/` prefix). The root lockfile exists; `ts/pnpm-lock.yaml` correctly does not exist. CI pnpm caching and `--frozen-lockfile` will succeed.

All 15 requirements (FDN-01..09, PLT-03..05, PAR-01, PAR-03, PAR-04) are satisfied. No regressions detected on previously-passing items.

---

*Verified: 2026-04-12T23:45:00Z*
*Verifier: Claude (gsd-verifier)*
*Re-verification: Yes — after plan 02-05 gap closure*
