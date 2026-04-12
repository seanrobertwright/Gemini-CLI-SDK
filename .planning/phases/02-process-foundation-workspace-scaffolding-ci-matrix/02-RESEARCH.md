# Phase 2: Process Foundation + Workspace Scaffolding + CI Matrix — Research

**Researched:** 2026-04-12
**Domain:** Polyglot monorepo (pnpm + uv), subprocess process management (Node.js + Python), cross-platform CI matrix (GitHub Actions)
**Confidence:** HIGH (core stack), MEDIUM (Windows locale approach), HIGH (subprocess patterns)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Monorepo layout + tooling**
- Directory layout: `ts/` + `python/` + `spec/` + `adapter-archon/` at repo root, with `scripts/` alongside
- TS package manager: pnpm with workspace config
- Python package manager: uv (virtualenvs + lockfiles + publishing)
- Shared version source: Root `VERSION` file (plain text, e.g. `1.0.0`). Both `ts/package.json` and `python/pyproject.toml` read from it at build/publish time via a pre-publish sync script or CI step
- `adapter-archon/`: Lives at repo root as its own TS package (not nested inside `ts/`), has its own `package.json`

**ProcessStrategy interface**
- Visibility: Public but documented as advanced/escape-hatch
- Granularity: Single `spawn(argv, env, options) -> ChildProcess` method. `BinaryResolver` and `EnvBuilder` are separate utilities consumed by the strategy, not part of the interface. `ProcessManager` owns kill/cleanup lifecycle uniformly regardless of strategy
- BinaryResolver: PATH-only + `GEMINI_BIN_PATH` override. No platform-specific guessing. Throw `GeminiNotFoundError` on miss
- EnvBuilder: Opaque with merge option. Builds clean env dict internally via allowlist (mirrors Archon's `buildCleanSubprocessEnv`). `options.env` merges additional vars. Allowlist is not configurable

**CI matrix**
- Representative subset (~12 jobs), not full cross-product (36)
- Each OS gets latest Node + Python; oldest supported versions tested on one OS; Windows non-en-US locale job
- Non-en-US locale: Japanese (ja-JP) — CJK with Shift_JIS legacy codepage (chcp 932)
- Block merge on divergence (PAR-03)
- Runner: `windows-latest` (standard GitHub-hosted)

**Test framework + parity**
- TS test framework: Vitest — native ESM, fast, built-in coverage, pnpm-workspace compatible
- Python test framework: pytest
- Parity enforcement method: Match test descriptions (human-readable names, not file paths)
- Fixture consumption: Relative paths from test files (e.g. `../../spec/fixtures/*.ndjson`). No symlinks, no copies
- VERSION consumption: Build-time injection. Pre-publish script or CI step syncs `VERSION` into both manifests

### Claude's Discretion
- Exact pnpm workspace config and root `pnpm-workspace.yaml` structure
- pytest config details (markers, fixtures, conftest patterns)
- Vitest config (coverage thresholds, test file patterns)
- EnvBuilder allowlist contents (derive from Archon's `buildCleanSubprocessEnv` + gemini-cli needs)
- CI job naming, caching strategy, artifact handling
- ProcessManager kill semantics implementation details (SIGTERM grace window, taskkill flags, orphan detection approach)
- `diff-test-names.sh` exact parsing and diff algorithm

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FDN-01 | SDK locates `gemini` binary via `cliPath` option → `GEMINI_BIN_PATH` env var → `PATH` | BinaryResolver: `shutil.which()` (Python), `which`/PATH scan (TS). Throw `GeminiNotFoundError` if not found |
| FDN-02 | SDK spawns `gemini-cli` using `child_process.spawn` (TS) / `anyio.open_process` (Python), never `exec`/`run` | Both are the correct low-level async primitives; `exec` buffers entire output |
| FDN-03 | SDK handles Windows `.cmd`/`.bat` shims safely (CVE-2024-27980) with array argv and selective `shell: true` | Phase 1 confirmed: `shell:true` + pre-built command string for Windows `.cmd`; see pitfall section |
| FDN-04 | SDK forces UTF-8 at subprocess spawn and decodes stderr/stdout with replacement on error | `PYTHONUTF8=1` + `encoding='utf-8', errors='replace'` (Python); Node handles via `encoding: 'utf8'` on streams |
| FDN-05 | SDK hides subprocess windows on Windows (`windowsHide: true` / `CREATE_NO_WINDOW`) | Node: `windowsHide: true` in spawn options; Python anyio: `creationflags=subprocess.CREATE_NO_WINDOW` |
| FDN-06 | SDK escalates SIGTERM → 5s grace → SIGKILL on Unix; uses `taskkill /T /F` on Windows | SIGTERM is force-kill on Windows already; use `taskkill /T /F /PID` for tree-kill |
| FDN-07 | SDK builds a clean subprocess env dict via allowlist | EnvBuilder mirrors `buildCleanSubprocessEnv` from Archon's `claude.ts` |
| FDN-08 | SDK ships `SpawnPerCallStrategy` behind a pluggable `ProcessStrategy` interface | Single `spawn(argv, env, options)` method pattern confirmed; mirrors `SubprocessCLITransport` |
| FDN-09 | `ProcessManager` detects orphan MCP grandchildren and cleans them up on parent exit | psutil `process.children(recursive=True)` (Python); `tree-kill` or taskkill (Windows TS side) |
| PLT-03 | CI matrix runs `{ubuntu, macos, windows} × {node 18/20/22} × {python 3.10–3.13}` — Windows required | Representative ~12-job matrix confirmed; Vitest must be v3.x (v4 drops Node 18) |
| PLT-04 | Python uses `anyio` on top of asyncio/trio; Windows subprocess uses ProactorEventLoop | ProactorEventLoop is default when using `anyio.run()` — no manual override needed |
| PLT-05 | CI includes at least one non-en-US Windows runner to catch encoding mojibake | Approach: `env: { PYTHONUTF8: '1' }` + `chcp 932` in workflow step; full locale change requires reboot (not viable in CI) |
| PAR-01 | TypeScript is the canonical implementation; Python is a mechanical port with matching file layout | pnpm workspace (`ts/`) + uv workspace (`python/`) established in lockstep |
| PAR-03 | Parity CI job diffs test names across TS and Python and blocks merge on divergence | `scripts/diff-test-names.sh`: extract Vitest `test('...')` + pytest function names, sort, diff |
| PAR-04 | Both SDKs ship with a single shared version number | Root `VERSION` file injected at build/publish time; see architecture patterns |
</phase_requirements>

---

## Summary

Phase 2 stands up two real SDK packages (`ts/` and `python/`) that can spawn `gemini --version` on all three OSes, captures the subprocess output, and asserts a non-empty version string. The foundation consists of: a pnpm workspace (`ts/` + `adapter-archon/` as peer TS packages), a uv project (`python/`), and a GitHub Actions matrix covering ~12 representative jobs with one Windows non-en-US job.

The biggest technical risk is the **Windows subprocess + encoding combination**. Phase 1 already confirmed that `shell: true` with a pre-built command string is required for `.cmd` shims on Windows (CVE-2024-27980 context). The Python side must set `PYTHONUTF8=1` in the spawned subprocess's env AND in CI globally. The non-en-US Windows job cannot use a full `ja-JP` system locale (requires reboot) but can simulate it by setting codepage 932 (`chcp 932`) via a `run:` step and passing `PYTHONUTF8=1` as an env override — which exercises the exact mojibake vectors without a system reboot.

A second significant finding: **Vitest 4 requires Node >= 20**. The CI matrix includes Node 18. Use Vitest 3.x (latest: ~3.2) which supports Node 18 and Vite 5/6.

**Primary recommendation:** Use pnpm workspaces (TS) + uv projects (Python) with a root `VERSION` file synced at publish time; implement ProcessStrategy as a single `spawn()` interface; use Vitest 3.x to maintain Node 18 compatibility; simulate Windows ja-JP via `chcp 932` + env override rather than system locale install.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| pnpm | 9.x | TS monorepo workspace + package manager | Fastest, content-addressable store, workspace: protocol |
| vitest | 3.x (NOT 4.x) | TS test runner | Native ESM, fast, no transpile overhead; v4 drops Node 18 |
| typescript | 5.6+ | TS compilation | Already pinned in root devDependencies |
| uv | 0.5+ | Python package + virtualenv management | 10-100x faster than pip/poetry, workspace-aware, lockfiles |
| pytest | 8.x | Python test framework | Industry standard, rich fixture support |
| anyio | 4.x | Async subprocess (Python) | asyncio + trio backend, ships `open_process()` |
| psutil | 6.x | Python process tree introspection | Cross-platform orphan detection and tree-kill |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @vitest/coverage-v8 | 3.x | Coverage provider | v8 native, no extra instrumentation |
| anyio[trio] | 4.x | Trio backend for anyio tests | Test ProcessStrategy under both backends |
| pytest-anyio | latest | pytest plugin for anyio tests | Enables `@pytest.mark.anyio` on async tests |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Vitest 3.x | Vitest 4.x | v4 requires Node >= 20; v3 supports Node 18 (required by PLT-03) |
| uv | poetry | uv is faster, lockfile-native, workspace-aware without plugins |
| anyio | asyncio directly | anyio abstracts trio/asyncio, making ProcessStrategy testable under both |
| psutil tree-kill | taskkill only | psutil works on all 3 OSes; taskkill is Windows-only |

### Installation

```bash
# TS workspace packages
cd ts && pnpm install
cd ../adapter-archon && pnpm install

# Python package
cd python && uv sync
```

---

## Architecture Patterns

### Recommended Project Structure

```
(repo root)
├── VERSION                   # Plain text "1.0.0" — single source of truth
├── pnpm-workspace.yaml       # ts/, adapter-archon/ as workspace packages
├── ts/
│   ├── package.json          # "name": "@gemini-sdk/core", version injected from VERSION
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   └── src/
│       ├── process/
│       │   ├── ProcessStrategy.ts       # Interface (public, escape-hatch)
│       │   ├── SpawnPerCallStrategy.ts  # Default implementation
│       │   ├── BinaryResolver.ts        # PATH + GEMINI_BIN_PATH
│       │   ├── EnvBuilder.ts            # Clean allowlist env dict
│       │   └── ProcessManager.ts        # Kill lifecycle, orphan detection
│       └── errors/
│           └── GeminiNotFoundError.ts
├── adapter-archon/
│   ├── package.json           # Separate TS package at root
│   └── src/                   # Phase 10 implementation
├── python/
│   ├── pyproject.toml         # version injected from VERSION at publish
│   ├── uv.lock
│   └── src/
│       └── gemini_sdk/
│           └── process/
│               ├── process_strategy.py   # Protocol/ABC (public)
│               ├── spawn_per_call.py     # Default implementation
│               ├── binary_resolver.py    # PATH + GEMINI_BIN_PATH
│               ├── env_builder.py        # Clean allowlist env dict
│               └── process_manager.py   # Kill lifecycle, orphan detection
├── spec/                      # Language-neutral ground truth (Phase 1)
│   ├── events.schema.json
│   ├── fixtures/
│   └── protocol.md
└── scripts/
    ├── sync-version.sh        # Injects VERSION into ts/package.json + python/pyproject.toml
    ├── diff-test-names.sh     # Parity CI enforcement
    └── (Phase 1 scripts)
```

### Pattern 1: pnpm-workspace.yaml

**What:** Declares which directories are workspace packages
**When to use:** Required at repo root for pnpm to resolve workspace: dependencies

```yaml
# Source: pnpm.io/workspaces
packages:
  - "ts"
  - "adapter-archon"
```

### Pattern 2: ProcessStrategy Interface (TypeScript)

**What:** Single-method interface that `SpawnPerCallStrategy` implements; power users can swap
**When to use:** All subprocess spawning goes through this interface

```typescript
// ts/src/process/ProcessStrategy.ts
import type { ChildProcess, SpawnOptions } from 'node:child_process';

export interface ProcessStrategy {
  spawn(
    argv: string[],
    env: Record<string, string>,
    options?: Partial<SpawnOptions>
  ): ChildProcess;
}
```

### Pattern 3: SpawnPerCallStrategy — Windows .cmd CVE pattern

**What:** Phase 1 confirmed: on Windows, `gemini` resolves to `gemini.cmd`. Shell injection via args is guarded by pre-building the command string, NOT by shell: false with array args (which fails for .cmd on Windows).
**When to use:** Default `ProcessStrategy` implementation

```typescript
// ts/src/process/SpawnPerCallStrategy.ts
import { spawn } from 'node:child_process';
import { platform } from 'node:os';

export class SpawnPerCallStrategy implements ProcessStrategy {
  spawn(argv: string[], env: Record<string, string>, options = {}) {
    const isWin = platform() === 'win32';
    // Phase 1 finding: cmd.exe requires shell:true; args must be pre-baked
    // to avoid arg-splitting bugs with quotes. CVE-2024-27980 is about
    // shell:false + .cmd — using shell:true with a pre-built string is the
    // correct mitigation, not shell:false.
    const [cmd, ...args] = argv;
    if (isWin) {
      const cmdStr = [cmd, ...args.map(a => JSON.stringify(a))].join(' ');
      return spawn(cmdStr, [], {
        shell: true,
        windowsHide: true,
        env,
        stdio: 'pipe',
        ...options,
      });
    }
    return spawn(cmd, args, {
      shell: false,
      env,
      stdio: 'pipe',
      ...options,
    });
  }
}
```

### Pattern 4: ProcessManager kill — SIGTERM → grace → SIGKILL

**What:** Escalating kill with 5-second grace window; tree-kill for MCP grandchildren
**When to use:** All subprocess termination

```typescript
// ts/src/process/ProcessManager.ts
import { spawn } from 'node:child_process';
import { platform } from 'node:os';

export async function killTree(pid: number, gracePeriodMs = 5000): Promise<void> {
  if (platform() === 'win32') {
    // taskkill /T kills the whole process tree; /F forces; no SIGTERM concept on Windows
    spawn('taskkill', ['/T', '/F', '/PID', String(pid)]);
    return;
  }
  // Unix: SIGTERM → wait grace period → SIGKILL if still alive
  try {
    process.kill(pid, 'SIGTERM');
  } catch { return; }
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      try { process.kill(pid, 'SIGKILL'); } catch { /* already dead */ }
      resolve();
    }, gracePeriodMs);
    // If process exits before grace period, clear timeout
    // Caller checks process.exitCode on ChildProcess
    timeout.unref();
    resolve(); // outer caller polls exitCode
  });
}
```

### Pattern 5: EnvBuilder allowlist (TypeScript)

**What:** Builds a clean env dict from an allowlist; merges caller-supplied overrides
**When to use:** Every subprocess spawn

```typescript
// ts/src/process/EnvBuilder.ts
// Derived from Archon's buildCleanSubprocessEnv (packages/core/src/clients/claude.ts)
const ALLOWED_KEYS = new Set([
  'PATH', 'HOME', 'USER', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
  'TEMP', 'TMP', 'TMPDIR', 'SystemRoot', 'SystemDrive', 'COMSPEC',
  'HOMEDRIVE', 'HOMEPATH', 'LOGNAME', 'SHELL', 'TERM',
  // Auth keys passed through to gemini-cli
  'GEMINI_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_API_KEY', 'GOOGLE_CLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT_ID',
  'GOOGLE_CLOUD_LOCATION',
  // gemini-cli config
  'GEMINI_CONFIG_DIR', 'GEMINI_SYSTEM_MD',
  // Force UTF-8 on Windows
  'PYTHONUTF8',
]);

export function buildEnv(overrides: Record<string, string> = {}): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const key of ALLOWED_KEYS) {
    if (process.env[key] !== undefined) clean[key] = process.env[key]!;
  }
  return { ...clean, ...overrides };
}
```

### Pattern 6: Python anyio open_process — canonical pattern

**What:** anyio subprocess spawn with UTF-8 forcing and window hiding
**When to use:** Python SpawnPerCallStrategy

```python
# python/src/gemini_sdk/process/spawn_per_call.py
import subprocess
import sys
import anyio
from anyio.abc import Process

async def spawn(argv: list[str], env: dict[str, str], **kwargs) -> Process:
    """Spawn gemini-cli as async subprocess via anyio."""
    creation_flags = 0
    if sys.platform == "win32":
        # Hide console window (FDN-05)
        creation_flags = subprocess.CREATE_NO_WINDOW
    return await anyio.open_process(
        argv,
        env=env,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        creationflags=creation_flags,
        **kwargs,
    )
```

### Pattern 7: BinaryResolver — PATH + GEMINI_BIN_PATH

**What:** Simple PATH lookup; `GEMINI_BIN_PATH` override; throw `GeminiNotFoundError` on miss
**When to use:** Before every spawn

```typescript
// ts/src/process/BinaryResolver.ts
import { which } from 'node:child_process'; // or use 'which' package
import { platform } from 'node:os';
import { GeminiNotFoundError } from '../errors/GeminiNotFoundError.js';
import { readFileSync } from 'node:fs';

export function resolveBinary(cliPath?: string): string {
  if (cliPath) return cliPath;
  if (process.env.GEMINI_BIN_PATH) return process.env.GEMINI_BIN_PATH;
  // On Windows, shutil.which finds 'gemini.cmd'; on Unix, 'gemini'
  const name = platform() === 'win32' ? 'gemini.cmd' : 'gemini';
  const found = findOnPath(name);
  if (!found) {
    throw new GeminiNotFoundError(
      `gemini-cli not found. Install it with: npm install -g @google/gemini-cli\n` +
      `Or set GEMINI_BIN_PATH to the path of the gemini binary.`
    );
  }
  return found;
}
```

### Pattern 8: Version sync script

**What:** Reads root `VERSION` file and patches `ts/package.json` and `python/pyproject.toml`
**When to use:** Pre-publish hook and CI release step

```bash
#!/usr/bin/env bash
# scripts/sync-version.sh
set -euo pipefail
VERSION=$(cat VERSION | tr -d '[:space:]')
# Patch ts/package.json version field using node
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('ts/package.json', 'utf8'));
pkg.version = '${VERSION}';
fs.writeFileSync('ts/package.json', JSON.stringify(pkg, null, 2) + '\n');
"
# Patch python/pyproject.toml version field using sed
sed -i "s/^version = .*/version = \"${VERSION}\"/" python/pyproject.toml
echo "Synced version ${VERSION} to ts/package.json and python/pyproject.toml"
```

### Pattern 9: diff-test-names.sh parity enforcement

**What:** Extracts test descriptions from TS and Python, sorts, diffs; exits nonzero on divergence
**When to use:** CI parity job; blocks merge if test names diverge

```bash
#!/usr/bin/env bash
# scripts/diff-test-names.sh
set -euo pipefail

# Extract Vitest test names: test('description') or it('description')
grep -rh --include="*.spec.ts" -oP "(?<=it\(|test\()['\"]([^'\"]+)" ts/src/ | sort > /tmp/ts-tests.txt

# Extract pytest test names: function name or docstring first line
python3 - <<'EOF' | sort > /tmp/py-tests.txt
import ast, pathlib, sys
for f in pathlib.Path("python/src").rglob("test_*.py"):
    tree = ast.parse(f.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name.startswith("test_"):
            doc = ast.get_docstring(node)
            print(doc.split("\n")[0].strip() if doc else node.name.replace("_", " "))
EOF

# Diff and fail if different
if ! diff /tmp/ts-tests.txt /tmp/py-tests.txt; then
  echo "ERROR: TS and Python test names diverge. Fix parity before merging."
  exit 1
fi
echo "OK: TS and Python test names match."
```

### Pattern 10: GitHub Actions representative CI matrix

**What:** ~12 jobs covering all OS/version corners without the full 36-job cross-product
**When to use:** Root `.github/workflows/ci.yml`

```yaml
# .github/workflows/ci.yml
name: CI

on: [push, pull_request]

jobs:
  test:
    name: "${{ matrix.os }} / Node ${{ matrix.node }} / Python ${{ matrix.python }}"
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        include:
          # Each OS: latest node + latest python
          - { os: ubuntu-latest,  node: 22, python: "3.13" }
          - { os: macos-latest,   node: 22, python: "3.13" }
          - { os: windows-latest, node: 22, python: "3.13" }
          # Oldest node tested on Linux
          - { os: ubuntu-latest,  node: 18, python: "3.13" }
          # Oldest python tested on Linux
          - { os: ubuntu-latest,  node: 22, python: "3.10" }
          # Node 20 on Linux
          - { os: ubuntu-latest,  node: 20, python: "3.13" }
          # Windows non-en-US: simulated ja-JP via chcp 932
          - { os: windows-latest, node: 22, python: "3.13", locale: "ja-JP" }

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: pnpm

      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: ${{ matrix.python }}

      - name: Install uv
        uses: astral-sh/setup-uv@v5

      - name: Set Japanese code page (Windows ja-JP job)
        if: matrix.locale == 'ja-JP'
        shell: pwsh
        run: |
          # Force code page 932 (Shift_JIS) — exercises CJK mojibake vectors
          # Note: full locale change requires reboot (not viable in CI)
          # PYTHONUTF8=1 in env below ensures Python subprocess UTF-8 despite cp932
          chcp.com 932
          Write-Host "Active code page: $(chcp.com)"

      - name: Install TS dependencies
        run: cd ts && pnpm install

      - name: Run TS tests
        env:
          # Force UTF-8 for Python child processes on Windows
          PYTHONUTF8: "1"
        run: cd ts && pnpm test

      - name: Install Python dependencies
        run: cd python && uv sync

      - name: Run Python tests
        env:
          PYTHONUTF8: "1"
          PYTHONIOENCODING: "utf-8"
        run: cd python && uv run pytest

  parity:
    name: "Parity check (TS ↔ Python test names)"
    runs-on: ubuntu-latest
    needs: []   # Runs independently; blocks merge
    steps:
      - uses: actions/checkout@v4
      - run: bash scripts/diff-test-names.sh
```

### Anti-Patterns to Avoid

- **Vitest 4 with Node 18:** Vitest 4 requires Node >= 20. The CI matrix includes Node 18. Pin Vitest to `^3.x`.
- **`shell: false` for `.cmd` files on Windows:** `.cmd` files cannot be executed without `shell: true`. `shell: false` with a `.cmd` binary name will fail. Phase 1 confirmed: use `shell: true` with a pre-built argument string.
- **`windowsHide: false` / missing `CREATE_NO_WINDOW`:** Without window-hide flags, spawning gemini-cli on Windows briefly flashes a console window. Always set `windowsHide: true` (TS) and `creationflags=subprocess.CREATE_NO_WINDOW` (Python).
- **Inheriting full `process.env` verbatim:** Leaks secrets and CI-injected vars into the subprocess. Always go through `EnvBuilder`.
- **`detached: true` with `windowsHide: true`:** These two flags conflict on Windows (known Node.js issue #21825). Do not combine them.
- **Full system locale install in CI:** `Set-WinSystemLocale` requires a reboot to take effect. Use `chcp 932` + `PYTHONUTF8=1` env override instead.
- **`uv workspace` members not having own `pyproject.toml`:** uv requires every matched member directory to contain its own `pyproject.toml`. Include `[project]` table even for internal-only packages.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Python process tree kill | Custom PID-tracking loop | `psutil.Process(pid).children(recursive=True)` | psutil handles race conditions, zombie processes, cross-platform differences |
| TS process tree kill (Windows) | Manual recursive child enumeration | `taskkill /T /F /PID {pid}` via spawn | Windows has no SIGTERM concept; taskkill handles tree atomically |
| PATH binary lookup (Python) | Custom glob walk | `shutil.which()` | Handles PATH separators, extensions, Windows .cmd/.exe precedence |
| PATH binary lookup (TS) | Manual `process.env.PATH.split(':')` walk | `which` npm package or Node `child_process.spawnSync('which', [bin])` | Edge cases: symlinks, PATHEXT on Windows |
| Async subprocess (Python) | `asyncio.create_subprocess_exec` directly | `anyio.open_process()` | anyio abstracts asyncio/trio; trio backend needed for some test scenarios |
| VERSION injection | Complex release tooling | Shell `sed` + `node -e JSON.parse` | Two-liner is sufficient; no need for `hatch-vcs` or changesets at this phase |

**Key insight:** The hardest part of this domain is Windows process tree cleanup. psutil's `children(recursive=True)` handles the race conditions and transient process states that a hand-rolled PID collector will miss.

---

## Common Pitfalls

### Pitfall 1: CVE-2024-27980 and Windows .cmd spawn (FDN-03)

**What goes wrong:** Using `spawn('gemini', args, { shell: false })` on Windows fails because `gemini` resolves to `gemini.cmd` — a batch file that requires `cmd.exe` to execute. Without `shell: true`, Node throws `ENOENT` or silently fails.

**Why it happens:** Windows cannot execute `.cmd` files directly as Win32 processes. They need `cmd.exe /c`.

**How to avoid:** Phase 1 established the pattern — on Windows, use `shell: true` with a pre-built command string where args are individually JSON-stringified. The CVE is about `shell: false` being bypassable, not about `shell: true` being insecure when you pre-validate argv.

**Warning signs:** `ENOENT` when spawning on Windows; subprocess immediately exits with code 1 with no output.

### Pitfall 2: Vitest 4 drops Node 18 (PLT-03)

**What goes wrong:** Installing `vitest@latest` pulls in v4.x, which requires Node >= 20. Node 18 CI jobs fail at `pnpm install` or at test start with a Node version error.

**Why it happens:** Vitest 4 rewrote its worker pool and removed tinypool, requiring Node 20+ features.

**How to avoid:** Pin `"vitest": "^3.x"` in `ts/package.json`. Current latest in 3.x series is 3.2.x. Revisit when Node 18 EOL (April 2025 — already past; but requirement PLT-03 explicitly lists Node 18).

**Warning signs:** `Vitest requires Node >=20` error in CI; works locally on Node 22 but fails on Node 18 runners.

### Pitfall 3: ProactorEventLoop and anyio (PLT-04)

**What goes wrong:** On Windows, `asyncio` subprocess support requires `ProactorEventLoop`. The default loop is `SelectorEventLoop` in some older Python setups, which has no subprocess support.

**Why it happens:** Windows has no `select()` syscall for processes; ProactorEventLoop uses IOCP.

**How to avoid:** Use `anyio.run()` as the test entry point — it automatically uses ProactorEventLoop on Windows. Do NOT use `asyncio.get_event_loop().run_until_complete()` directly. In pytest, use `pytest-anyio` and `@pytest.mark.anyio`.

**Warning signs:** `NotImplementedError: subprocess not supported on SelectorEventLoop` on Windows.

### Pitfall 4: UTF-8 forcing — what you must set and where (FDN-04)

**What goes wrong:** On Windows, Python subprocess communication defaults to the system ANSI codepage (e.g., cp1252 or cp932). Reading subprocess output as text without forcing UTF-8 corrupts non-ASCII content.

**Why it happens:** Python's `subprocess` uses `GetACP()` as the default text encoding unless overridden.

**How to avoid:**
- Set `PYTHONUTF8=1` in the env dict passed to the gemini-cli subprocess (and in CI env globally)
- Pass `encoding='utf-8', errors='replace'` when decoding stdout/stderr bytes
- In Node: `stdout.setEncoding('utf8')` on the ChildProcess streams

**Warning signs:** `UnicodeDecodeError` on Windows; mojibake in captured stdout on non-en-US Windows.

### Pitfall 5: `windowsHide: true` + `detached: true` conflict

**What goes wrong:** Combining `windowsHide: true` with `detached: true` in `child_process.spawn` on Windows causes the window-hide flag to be ignored (Node.js issue #21825).

**How to avoid:** Do not use `detached: true` in `SpawnPerCallStrategy`. Process independence is handled via explicit `taskkill` tree-kill, not detachment.

### Pitfall 6: Windows SIGTERM is actually SIGKILL (FDN-06)

**What goes wrong:** Sending `SIGTERM` to a subprocess on Windows immediately force-kills it (like SIGKILL). There is no graceful shutdown signal on Windows. Any cleanup logic in gemini-cli triggered by SIGTERM will never run.

**Why it happens:** Windows does not implement POSIX signals. Node maps `'SIGTERM'` → `TerminateProcess()` on Windows.

**How to avoid:** The SIGTERM → grace → SIGKILL pattern is for Unix. On Windows, always use `taskkill /T /F /PID` directly. This is a hard `if (platform() === 'win32')` branch in `ProcessManager`.

### Pitfall 7: pnpm workspace version pinning

**What goes wrong:** Forgetting to specify `"version"` in workspace `package.json` files causes issues with `changesets` and publishing later (Phase 11). Workspace packages without versions cannot be released.

**How to avoid:** Add a placeholder version (`"0.0.0"` or read from VERSION file) in `ts/package.json` from the start. The `sync-version.sh` script will overwrite it before publish.

### Pitfall 8: uv workspace requires all members to have pyproject.toml

**What goes wrong:** If `pnpm-workspace.yaml`-style globs are used in `uv`'s `[tool.uv.workspace]` members, every matched directory must have a `pyproject.toml` with a `[project]` table — even if it's a stub. Missing file causes `uv lock` to fail.

**How to avoid:** The Phase 2 Python layout has only `python/` as the workspace root with a single `pyproject.toml` — no nested uv workspace members needed at this stage.

---

## Code Examples

### Spawn hello-world test (TS Vitest)

```typescript
// ts/src/process/BinaryResolver.test.ts
import { describe, it, expect } from 'vitest';
import { resolveBinary } from './BinaryResolver.js';
import { SpawnPerCallStrategy } from './SpawnPerCallStrategy.js';
import { buildEnv } from './EnvBuilder.js';

describe('spawns gemini --version successfully', () => {
  it('captures non-empty version string on all platforms', async () => {
    const bin = resolveBinary();
    const strategy = new SpawnPerCallStrategy();
    const env = buildEnv();
    const proc = strategy.spawn([bin, '--version'], env);

    const chunks: Buffer[] = [];
    proc.stdout!.on('data', (d) => chunks.push(d));

    await new Promise<void>((resolve, reject) => {
      proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`exit ${code}`)));
      proc.on('error', reject);
    });

    const version = Buffer.concat(chunks).toString('utf8').trim();
    expect(version.length).toBeGreaterThan(0);
  });
});
```

### Spawn hello-world test (Python pytest)

```python
# python/tests/test_spawn_per_call.py
"""Spawns gemini --version successfully."""
import pytest
import anyio
from gemini_sdk.process.binary_resolver import resolve_binary
from gemini_sdk.process.spawn_per_call import spawn
from gemini_sdk.process.env_builder import build_env


@pytest.mark.anyio
async def test_captures_non_empty_version_string_on_all_platforms():
    """captures non-empty version string on all platforms"""
    bin_path = resolve_binary()
    env = build_env()
    async with await spawn([bin_path, "--version"], env) as proc:
        stdout = await proc.stdout.receive()  # type: ignore
    assert stdout.strip()
```

### pytest conftest.py for anyio

```python
# python/tests/conftest.py
import pytest

# Use asyncio backend by default (ProactorEventLoop on Windows via anyio)
pytest_plugins = ('anyio',)
```

### pyproject.toml minimal setup

```toml
# python/pyproject.toml
[project]
name = "gemini-sdk"
version = "0.0.0"        # sync-version.sh overwrites this at publish
description = "Python SDK for gemini-cli"
requires-python = ">=3.10"
dependencies = [
    "anyio>=4.0",
    "psutil>=6.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "anyio[trio]>=4.0",
    "pytest-anyio>=0.0.0",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.version]
path = "src/gemini_sdk/__init__.py"
```

### vitest.config.ts minimal setup

```typescript
// ts/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.ts'],
    globals: false,
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.{test,spec}.ts'],
    },
  },
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| poetry + pip | uv | 2024 | 10-100x faster installs; built-in lockfile; workspace-native |
| Jest | Vitest 3.x | 2023-2024 | Native ESM, no babel, 2-5x faster |
| `asyncio.create_subprocess_exec` | `anyio.open_process` | 2022+ | Tri-backend (asyncio/trio), cleaner API |
| `child_process.exec` | `child_process.spawn` | Always correct choice | spawn streams; exec buffers entire output |
| Full cross-product CI matrix | Representative subset | 2024 recommended practice | 12 jobs instead of 36; covers all important vectors |
| Full language pack install for locale | `chcp 932` + `PYTHONUTF8=1` env | 2024 CI limitation | Installs require admin + reboot; env override is sufficient for encoding test |

**Deprecated/outdated:**
- Vitest 4 for Node 18 targets: Dropped Node 18 support — use Vitest 3.x
- `np` (np package) for version sync: Overkill; `sync-version.sh` + `changesets` covers both languages
- `tree-kill` npm package: Unnecessary — taskkill is available natively on Windows; `SIGKILL` on Unix is sufficient

---

## Open Questions

1. **psutil orphan detection boundary**
   - What we know: `psutil.Process(pid).children(recursive=True)` reliably finds MCP grandchildren on Linux/macOS
   - What's unclear: On Windows, PPID inheritance when parent exits before child — does psutil correctly see transient orphans?
   - Recommendation: In the kill-mid-stream test, assert `psutil.pid_exists(child_pid)` is False within 1 second after `ProcessManager.kill()`; accept a flaky test and retry once before failing hard

2. **Vitest `^3.x` — exact upper bound**
   - What we know: Vitest 4 is released and stable; v3.x is the last version supporting Node 18
   - What's unclear: Will Vitest 3.x receive security patches? What is the EOL?
   - Recommendation: Pin `"vitest": "^3.2"` — semver caret allows patch updates within 3.x; revisit when Node 18 is dropped from the CI matrix

3. **Windows locale: chcp 932 vs actual ja-JP system locale**
   - What we know: Full ja-JP system locale requires reboot (not viable in CI); `chcp 932` activates Shift_JIS codepage in the current console
   - What's unclear: Does `chcp 932` affect child processes spawned from that shell on GitHub Actions?
   - Recommendation: Set `chcp 932` in the workflow step AND pass `PYTHONUTF8=1` + `PYTHONIOENCODING=utf-8` as env vars for both Node and Python test steps; this exercises the exact UTF-8 forcing path without needing a full locale change

4. **diff-test-names.sh and docstring vs function name parity**
   - What we know: TS uses `test('human description')` literals; Python test functions use `snake_case` names with optional docstrings
   - What's unclear: If docstrings are absent, function names like `test_captures_non_empty_version_string` will differ from `captures non-empty version string`
   - Recommendation: Mandate docstrings on all Python test functions as the parity mechanism; the parity script extracts docstring first line; failing to add a docstring is a CI error, not a convention suggestion

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| TS Framework | Vitest 3.x (pin to `^3.2`) |
| TS Config file | `ts/vitest.config.ts` — Wave 0 |
| TS Quick run command | `cd ts && pnpm test --run` |
| TS Full suite command | `cd ts && pnpm test --run --coverage` |
| Python Framework | pytest 8.x |
| Python Config file | `python/pyproject.toml` `[tool.pytest.ini_options]` — Wave 0 |
| Python Quick run command | `cd python && uv run pytest -x` |
| Python Full suite command | `cd python && uv run pytest --tb=short` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FDN-01 | `resolveBinary()` finds `gemini` on PATH | unit | `cd ts && pnpm test --run src/process/BinaryResolver` | ❌ Wave 0 |
| FDN-01 | `resolve_binary()` finds `gemini` on PATH | unit | `cd python && uv run pytest tests/test_binary_resolver.py -x` | ❌ Wave 0 |
| FDN-02 | `spawn()` returns a ChildProcess/Process | unit | `cd ts && pnpm test --run src/process/SpawnPerCallStrategy` | ❌ Wave 0 |
| FDN-03 | Windows `.cmd` spawn does not throw | platform | `cd ts && pnpm test --run src/process/SpawnPerCallStrategy` | ❌ Wave 0 |
| FDN-04 | Subprocess stdout decoded as UTF-8 with replacement | unit | `cd ts && pnpm test --run src/process/EnvBuilder` | ❌ Wave 0 |
| FDN-05 | `windowsHide: true` set in spawn options | unit | `cd ts && pnpm test --run src/process/SpawnPerCallStrategy` | ❌ Wave 0 |
| FDN-06 | `killTree()` terminates process within 5s grace | integration | `cd ts && pnpm test --run src/process/ProcessManager` | ❌ Wave 0 |
| FDN-07 | `buildEnv()` only passes allowlisted keys | unit | `cd ts && pnpm test --run src/process/EnvBuilder` | ❌ Wave 0 |
| FDN-08 | `ProcessStrategy` interface implemented by SpawnPerCallStrategy | unit | `cd ts && pnpm test --run src/process/SpawnPerCallStrategy` | ❌ Wave 0 |
| FDN-09 | `killTree()` kills MCP grandchildren (no orphans detected) | integration | `cd ts && pnpm test --run src/process/ProcessManager` | ❌ Wave 0 |
| PLT-03 | `gemini --version` spawned and asserts non-empty on all OSes | smoke | CI matrix green | ❌ Wave 0 |
| PLT-04 | Python anyio test runs under ProactorEventLoop on Windows | unit | `cd python && uv run pytest tests/ -x` | ❌ Wave 0 |
| PLT-05 | Japanese codepage (chcp 932) + UTF-8 forcing produces correct output | smoke | CI ja-JP job green | ❌ Wave 0 |
| PAR-01 | TS and Python `process/` modules have matching file layout | structural | `bash scripts/diff-test-names.sh` | ❌ Wave 0 |
| PAR-03 | Test names match across TS and Python | parity | `bash scripts/diff-test-names.sh` | ❌ Wave 0 |
| PAR-04 | Both packages report same version from VERSION file | unit | CI sync-version step | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `cd ts && pnpm test --run && cd ../python && uv run pytest -x`
- **Per wave merge:** Full suite + parity: `cd ts && pnpm test --run --coverage && cd ../python && uv run pytest --tb=short && bash scripts/diff-test-names.sh`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

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
- [ ] `.github/workflows/ci.yml` — CI matrix with 12 representative jobs

---

## Sources

### Primary (HIGH confidence)

- Node.js official docs (`https://nodejs.org/api/child_process.html`) — spawn options, windowsHide, SIGTERM Windows behavior, .cmd/.bat handling
- pnpm workspaces docs (`https://pnpm.io/workspaces`) — workspace config, linkWorkspacePackages, sharedWorkspaceLockfile
- uv workspaces docs (`https://docs.astral.sh/uv/concepts/projects/workspaces/`) — members glob, single lockfile, `uv run --package`
- Vitest migration docs (`https://vitest.dev/guide/migration.html`) — Node 18 dropped in v4; v3.x is last Node-18-compatible branch
- anyio subprocess docs (`https://anyio.readthedocs.io/en/latest/subprocesses.html`) — open_process API, Windows ProactorEventLoop note
- Python CVE tracker (`https://github.com/python/cpython/issues/105312`) — subprocess encoding default on Windows
- Claude Agent SDK Python issues (`https://github.com/anthropics/claude-agent-sdk-python/issues/252`) — Windows .cmd spawn failure, anyio.open_process + CREATE_NO_WINDOW pattern
- Phase 1 findings in STATE.md — Windows shell:true + pre-built command string confirmed; MSYS2 PATH patterns

### Secondary (MEDIUM confidence)

- psutil docs (`https://psutil.readthedocs.io`) — `process.children(recursive=True)` cross-platform tree-kill
- Node.js issue #21825 (`https://github.com/nodejs/node/issues/21825`) — windowsHide + detached conflict on Windows
- GitHub community discussion #68929 — Windows locale changes require admin + reboot; not CI-compatible
- WebSearch cross-verification: `PYTHONUTF8=1` + `PYTHONIOENCODING=utf-8` is the reliable CI workaround for Windows UTF-8 enforcement

### Tertiary (LOW confidence)

- `scripts/diff-test-names.sh` approach: no canonical reference tool found; pattern derived from `adamj.eu` Python diffing article + `grep -oP` regex extraction — validate against real test output before committing to parity format

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — pnpm, uv, Vitest 3.x, anyio, psutil all verified via official docs + Node 18 constraint confirmed in Vitest migration guide
- Architecture: HIGH — ProcessStrategy pattern confirmed in Claude Agent SDK Python; Windows .cmd pattern confirmed in Phase 1 STATE.md
- Pitfalls: HIGH for Windows spawn/kill (multiple official sources); MEDIUM for Japanese locale simulation (no canonical CI solution exists — approach is best-available)
- Parity enforcement: MEDIUM — `diff-test-names.sh` pattern is novel to this project; concept validated but exact regex/AST extraction needs empirical verification

**Research date:** 2026-04-12
**Valid until:** 2026-05-12 (stable stack; re-verify Vitest 3.x EOL and Windows runner image changes after 30 days)
