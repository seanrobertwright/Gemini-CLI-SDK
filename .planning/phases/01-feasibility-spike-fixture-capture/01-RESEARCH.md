# Phase 1: Feasibility Spike + Fixture Capture - Research

**Researched:** 2026-04-11
**Domain:** Empirical validation of `gemini-cli` stream-json wire format, session resume, config isolation, and Windows fixture capture pipeline
**Confidence:** HIGH on upstream issue status and tooling versions (Context7 + live GitHub); MEDIUM on exact stream-json field-level schema (docs are intentionally incomplete — this is WHY Phase 1 exists); HIGH on capture/redaction/JSON-Schema strategy

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Version pinning strategy:**
- **Pin target:** Latest stable `gemini-cli` at the time Phase 1 runs. Full version string (e.g. `0.39.2`) committed to `.gemini-cli-compat` at repo root.
- **Bump policy:** On-demand only. Pin gets bumped when a blocking upstream bug is fixed or a needed feature lands — NOT on every upstream release. Stability > freshness, especially given gemini-cli's weekly cadence and 2.4k open issues.
- **Minimum-supported version floor:** Separate from the CI pin. The SDK publishes a runtime floor (documented and enforced by a version probe) that is typically broader than the CI-pinned version. The CI pin is a subset of the floor — anything from the floor upward should work, but the pin is what CI guarantees.
- **Single-version fixture capture:** Phase 1 captures fixtures against ONE pinned version only. No second-version compat-matrix testing in this phase — that's Phase 11's job. Keeps Phase 1 focused.

**Fixture capture environment:**
- **Auth source:** Project author's personal `GEMINI_API_KEY` (local only). The key never touches CI, never touches the repo, never touches committed artifacts. Passed into `gemini-cli` via environment variable at capture time.
- **Capture host:** Local Windows machine (project author's primary dev box). This is deliberate: Phase 1 capture under Windows exposes encoding issues (CRLF, non-en-US locales, Unicode normalization) at the earliest possible moment, matching the project's Windows-first posture.
- **Secrets sanitization:** `scripts/capture-fixtures.sh` (and its platform-native equivalent for Windows — probably `.ps1` or `.cmd` wrapper) pipes gemini-cli output through a **redactor** before writing to disk. Redactor patterns match: API key prefixes, Google Cloud project IDs, OAuth token formats, session tokens, absolute file paths from the capture host. **Plus** manual human review of each fixture diff before commit. Belt-and-braces.
- **Re-capture mechanism:** Single reproducible command — `scripts/capture-fixtures.sh` (or platform equivalent) replays every scenario and regenerates `spec/fixtures/*.ndjson` + `*.expected.json` pairs in one shot. Version bumps + fresh captures = one command, not manual per-scenario work.

**Feasibility failure response:** The three smoke tests resolve toward "Complete with documented fallback verdict" rather than blocking on upstream. Phase 1 always ships something actionable:
- **If `--resume` + `-p` FAILS (#14180 confirmed broken):** config flag `transcript_prepend_fallback: true` set for Phase 7; Phase 7 lands the transcript-prepend fallback as its default path.
- **If `GEMINI_CONFIG_DIR` override FAILS:** Phase 9 falls back to `gemini mcp add --scope project` into a temp `cwd` for MCP passthrough.
- **If `stream-json` is block-buffered:** Phase 4 exposes `forcePty: true` as a `query()` option routing stdout through `node-pty` / `pty` equivalent.
- **If ALL THREE fail catastrophically:** Phase 1 returns `## ROADMAP BLOCKED` with a re-scoping conversation required.

**Fixture scope:** 11 fixtures total — 6 required (`simple-text`, `tool-use-builtin`, `resume-session`, `error-rate-limit`, `error-auth`, `event-unknown`) + 5 added (`thinking`, `multimodal-image`, `multimodal-pdf`, `large-output`, `abort-midstream`). Each `.ndjson` has a sibling `.expected.json`. Image and PDF source assets live under `spec/fixtures/_assets/`.

### Claude's Discretion

- Exact filenames under `spec/fixtures/` (follow the convention above but feel free to disambiguate)
- Exact prompt text for each scenario (document in `spec/capture.md` so re-capture is deterministic)
- The specific redactor regex patterns (derive from known key/token/ID formats; err on side of over-redaction)
- Directory structure under `spec/` beyond what's already implied (e.g. whether `spec/protocol.md` has subsections for each event type, how `spec/errors.md` organizes the pattern table)
- Whether `.gemini-cli-compat` is a plain-text file, YAML, or JSON (plain version string is simplest; pick it unless there's a strong reason otherwise)
- `spec/events.schema.json` internal structure (discriminated-union JSON Schema pattern — discover it empirically from fixtures, don't design it a priori)
- Platform-native fixture capture script format (Windows: `.cmd` or `.ps1` wrapping a shared core; document in `spec/capture.md`)

### Deferred Ideas (OUT OF SCOPE)

- **Compat-matrix testing against multiple gemini-cli versions** — deferred to Phase 11. Phase 1 is single-version only.
- **Runtime version probe implementation** — deferred to Phase 11.
- **CI-driven fixture regeneration** — manually-triggered GitHub Actions workflow is not a v1 concern.
- **Third Vertex AI fixture** (service account JSON path + `GOOGLE_API_KEY` path) — auth-mode fixtures belong in Phase 6.
- **Thinking fixture re-capture against post-2.5 successor model** — due 2026-06-17 or earlier.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| **PRS-08** | Shared JSON Schema at `spec/events.schema.json` generates TS types (via `json-schema-to-typescript`) and Pydantic models (via `datamodel-code-generator`) | Sections below: "JSON Schema Toolchain", "Code Examples — Events Schema", "Validation Architecture". Current versions pinned: `json-schema-to-typescript@15.0.4`, `datamodel-code-generator@0.30.2`. Both support JSON Schema 2020-12 discriminated unions via `oneOf` + `discriminator`. |
| **PRS-09** | Shared fixture corpus at `spec/fixtures/*.ndjson` with sibling `.expected.json` files; TS and Python suites both run it in CI | Sections below: "Fixture Capture Strategy", "11-Fixture Scenario Playbook", "Redaction Pipeline", "Expected Sidecar Format". All 11 fixtures have concrete capture recipes. |
</phase_requirements>

---

## Summary

Phase 1 is a specification-and-empirical-evidence phase. It ships **no runtime code**, only: (a) `spec/events.schema.json` derived from captured NDJSON, (b) 11 real `gemini-cli` traces in `spec/fixtures/*.ndjson` with sibling `.expected.json` sidecars, (c) `spec/protocol.md` + `spec/errors.md` drafts citing fixture filenames, (d) `spec/feasibility.md` with pass/fail verdicts on three load-bearing smoke tests, (e) a pinned version in `.gemini-cli-compat`, and (f) `scripts/capture-fixtures.*` as a single reproducible re-capture entry point.

The research surfaced **three critical upstream corrections** to what CONTEXT.md assumed:

1. **Issue #14180 status is ambiguous and must be empirically re-resolved.** One comment on the issue (Dec 4 2025) claims it was fixed in `v0.20.0-nightly` with strict validation removed, but adapter breakage reports as recent as `v0.34.0+` (paperclip #2907) indicate the positional-vs-`-p` conflict continues to surface in new forms. The pinned version for Phase 1 (expected: `v0.37.1` stable or newer as of this research) MUST be smoke-tested directly against all three modes (positional, stdin, `-p`) × (fresh session, `--resume latest`, `--resume <id>`). **Do not trust the Dec 4 comment without empirical confirmation.**
2. **`GEMINI_CONFIG_DIR` on Windows is tracked as broken (#8248), closed "Not Planned" in Dec 2025.** This is the primary evidence that Phase 1's smoke test #2 may fail, and Phase 9 must have a ready fallback. Linux/macOS behavior is untested by that issue; Phase 1 must test Windows explicitly (the capture host).
3. **`stream-json` event field-level schema is NOT documented.** Upstream docs (`docs/cli/headless.md`, `geminicli.com/docs/cli/headless/`) enumerate the six event type names (`init`, `message`, `tool_use`, `tool_result`, `error`, `result`) and exit codes (0/1/42/53) but provide NO field schemas and NO example NDJSON lines. **The JSON Schema MUST be derived empirically from captured fixtures, not from docs.** This is the primary reason Phase 1 exists.

**Primary recommendation:** Structure Phase 1 as a **five-wave** plan — (W0) validation architecture setup, (W1) pinned-version install + `.gemini-cli-compat`, (W2) feasibility smoke tests (`--resume`+`-p`, `GEMINI_CONFIG_DIR`, stream-json flushing) producing `spec/feasibility.md`, (W3) 11-fixture capture via `scripts/capture-fixtures.*` with redaction, (W4) `spec/events.schema.json` authored from fixtures + codegen smoke test (both `json-schema-to-typescript` and `datamodel-code-generator` produce compilable output). `spec/protocol.md` and `spec/errors.md` drafts are written in parallel with W3/W4 as the fixtures solidify.

---

## Standard Stack

### Core (pin these versions in Phase 1)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `gemini-cli` | **v0.37.1 stable** (or latest stable on capture day) | The subject under empirical study | Latest stable as of 2026-04-09 per github.com/google-gemini/gemini-cli/releases. Pinned in `.gemini-cli-compat`. |
| `json-schema-to-typescript` | **15.0.4** | Generate TS types from `spec/events.schema.json` | Published by `bcherny`, most-used JSON Schema → TS generator in the ecosystem (696+ dependents). Supports `oneOf`/`anyOf` discriminated unions. npmjs.com/package/json-schema-to-typescript |
| `datamodel-code-generator` | **0.30.2** | Generate Pydantic models from `spec/events.schema.json` | Official Pydantic-recommended tool (docs.pydantic.dev/latest/integrations/datamodel_code_generator/). Supports JSON Schema 2020-12 via `--target-python-version` + `--output-model-type pydantic_v2.BaseModel`. Handles `$ref`, `allOf`, `oneOf`, `anyOf`, discriminators. |
| JSON Schema | **draft 2020-12** | Schema dialect for `spec/events.schema.json` | Current JSON Schema spec. Both generators support it. Use `"$schema": "https://json-schema.org/draft/2020-12/schema"`. |

### Supporting (for the capture pipeline)

| Tool | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| `node` | 20.x LTS (18.x minimum) | Runs `gemini-cli` (it IS a Node CLI) | Prerequisite — `gemini-cli` is a Node binary installed via npm |
| `npm`/`npx` | Bundled with Node | Install `gemini-cli` globally, verify version | `npm install -g @google/gemini-cli@<pinned>` |
| Git Bash (MSYS2) | System-installed on Windows dev box | Run `.sh` scripts on Windows consistent with macOS/Linux | Capture script executes in Git Bash for cross-platform parity |
| PowerShell 7 | System-installed | Platform-native alternative wrapper (optional) | If `.sh` via Git Bash proves fragile, `.ps1` wrapper calls the same underlying Node redactor |

### Capture pipeline architecture decision

**CONTEXT.md gives "Claude's Discretion" on script format. Recommendation: Node.js script + thin per-platform wrappers.**

| Approach | Tradeoff | Verdict |
|----------|----------|---------|
| Single `.sh` | Needs Git Bash on Windows; CRLF handling inconsistent | ❌ Fragile on Windows |
| Single `.ps1` | Windows-native but non-portable to macOS/Linux CI | ❌ Loses cross-platform |
| Single `.cmd` | Windows-only, limited scripting | ❌ Loses cross-platform |
| **Node.js script + `.cmd`/`.sh` thin wrappers** | Cross-platform (Node is already prerequisite), UTF-8 native, programmable redaction | ✅ **Recommended** |

**Structure:**
```
scripts/
├── capture-fixtures.mjs     # Node.js — the actual capture logic
├── capture-fixtures.cmd     # Windows wrapper: `@node "%~dp0capture-fixtures.mjs" %*`
└── capture-fixtures.sh      # POSIX wrapper: `#!/usr/bin/env bash\nexec node "$(dirname "$0")/capture-fixtures.mjs" "$@"`
```

Rationale: Node is already a hard prerequisite (user must have `gemini-cli` installed, which means Node must be present). Using Node for the capture script means: (a) UTF-8 is native and doesn't require `chcp 65001` gymnastics, (b) the redactor can be a proper function with tests, (c) the same script runs unchanged on Windows/macOS/Linux, (d) no shell-escaping landmines, (e) Phase 2's CI matrix can re-run capture on any runner without extra tooling.

**Reference precedents** (from research):
- **Claude Agent SDK** wraps Claude Code CLI as subprocess and communicates via NDJSON over stdin/stdout — same architectural shape, same fixture-driven testing approach (code.claude.com/docs/en/agent-sdk/overview)
- **Codex SDK** spawns OpenAI Codex CLI as a child process and communicates over stdin/stdout using JSONL (developers.openai.com/codex/sdk)
- **ACP / session-log-writer pattern** from zed-industries — persists raw NDJSON per session for replay. Directly relevant for fixture capture logic.

### Installation

```bash
# On capture host (Windows dev box)
npm install -g @google/gemini-cli@0.37.1   # pinned version, update this before capture
gemini --version                            # verify: should print "gemini-cli 0.37.1"

# In repo root — Phase 1 has no package.json yet (that's Phase 2),
# so these are one-off invocations via npx for codegen smoke test:
npx json-schema-to-typescript@15.0.4 spec/events.schema.json > /tmp/events.d.ts
uvx datamodel-code-generator@0.30.2 --input spec/events.schema.json \
    --input-file-type jsonschema --output /tmp/events.py \
    --output-model-type pydantic_v2.BaseModel --target-python-version 3.10
```

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `json-schema-to-typescript` | `quicktype` | quicktype is polyglot but less faithful to JSON Schema semantics and weaker discriminated-union support |
| `datamodel-code-generator` | `jsonschema-gentypes` (Python) | Less mature, doesn't emit Pydantic v2, poor ecosystem adoption |
| JSON Schema 2020-12 | OpenAPI 3.1 / JSON Type Definition (JTD) | OpenAPI 3.1 is a superset (compatible) but carries REST-API baggage; JTD is Ajv-specific and loses `oneOf` expressiveness |
| Custom regex redactor | `detect-secrets` / `trufflehog` for scanning | Use these as a **second-pass validator**, not the primary redactor — they're scanners not stream processors. See "Redaction Pipeline" below. |

---

## Architecture Patterns

### Recommended Phase 1 Output Structure

```
Gemini-SDK/
├── .gemini-cli-compat                        # Single line: "0.37.1" (pinned version)
├── scripts/
│   ├── capture-fixtures.mjs                  # Node.js capture + redaction engine
│   ├── capture-fixtures.cmd                  # Windows wrapper
│   └── capture-fixtures.sh                   # POSIX wrapper
├── spec/
│   ├── protocol.md                           # Draft: normative event types, citing fixtures
│   ├── errors.md                             # Draft: stderr-pattern → typed-error table, citing fixtures
│   ├── feasibility.md                        # The three verdicts (normative, not informational)
│   ├── capture.md                            # Exact prompts + env setup for reproducing each fixture
│   ├── events.schema.json                    # JSON Schema 2020-12 discriminated union
│   └── fixtures/
│       ├── _assets/
│       │   ├── sample-image.png              # Small test image (committed)
│       │   └── sample-document.pdf           # Small test PDF (committed)
│       ├── simple-text.ndjson
│       ├── simple-text.expected.json
│       ├── tool-use-builtin.ndjson
│       ├── tool-use-builtin.expected.json
│       ├── resume-session-turn1.ndjson       # Pair: captures initial session_id
│       ├── resume-session-turn1.expected.json
│       ├── resume-session-turn2.ndjson       # Pair: uses --resume <id>
│       ├── resume-session-turn2.expected.json
│       ├── error-rate-limit.ndjson
│       ├── error-rate-limit.expected.json
│       ├── error-rate-limit.stderr.txt       # Captured stderr for Phase 5 error mapper
│       ├── error-auth.ndjson
│       ├── error-auth.expected.json
│       ├── error-auth.stderr.txt
│       ├── event-unknown.ndjson              # SYNTHETIC — documented as such
│       ├── event-unknown.expected.json
│       ├── thinking.ndjson
│       ├── thinking.expected.json
│       ├── multimodal-image.ndjson
│       ├── multimodal-image.expected.json
│       ├── multimodal-pdf.ndjson
│       ├── multimodal-pdf.expected.json
│       ├── large-output.ndjson
│       ├── large-output.expected.json
│       ├── abort-midstream.ndjson
│       └── abort-midstream.expected.json
```

### Pattern 1: Discriminated Union JSON Schema (2020-12)

**What:** Model the 6 known stream-json event types as a `oneOf` with a `type` discriminator. Let unknown types fall through at the runtime-validator layer (Phase 3), NOT at the schema level — the schema describes WHAT we've captured, not what we'll accept.

**Why:** `json-schema-to-typescript` and `datamodel-code-generator` both emit clean discriminated-union types from this shape. TS gets `type Event = InitEvent | MessageEvent | ...`. Python Pydantic gets `Annotated[Union[...], Field(discriminator="type")]`.

**Example** (illustrative — actual fields come from empirical capture):
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://gemini-sdk/spec/events.schema.json",
  "title": "Gemini CLI stream-json Event",
  "description": "Discriminated union of all event types emitted by gemini --output-format stream-json. Field-level schemas derived from spec/fixtures/ captures against pinned version in .gemini-cli-compat.",
  "oneOf": [
    { "$ref": "#/$defs/InitEvent" },
    { "$ref": "#/$defs/MessageEvent" },
    { "$ref": "#/$defs/ToolUseEvent" },
    { "$ref": "#/$defs/ToolResultEvent" },
    { "$ref": "#/$defs/ErrorEvent" },
    { "$ref": "#/$defs/ResultEvent" }
  ],
  "$defs": {
    "InitEvent": {
      "type": "object",
      "required": ["type", "session_id", "model"],
      "properties": {
        "type": { "const": "init" },
        "session_id": { "type": "string" },
        "model": { "type": "string" }
        /* additional fields to be captured from real output */
      },
      "additionalProperties": true
    }
    /* ... MessageEvent, ToolUseEvent, ToolResultEvent, ErrorEvent, ResultEvent ... */
  }
}
```

**Critical design rule:** Set `additionalProperties: true` on every event def. Phase 1 captures what we see; the parser (Phase 3) must tolerate new fields gracefully. The schema is a **floor** of known fields, not a ceiling.

### Pattern 2: Expected Sidecar Format (`.expected.json`)

**What:** For every `fixture.ndjson`, commit a sibling `fixture.expected.json` describing the normalized `MessageChunk` sequence Phase 3's parser should yield.

**Why:** This is the contract between Phase 1 (captured raw events) and Phase 3 (normalized `MessageChunk` union). It's consumed by BOTH the TS and Python test suites as the source-of-truth parity assertion.

**Example shape** (for `simple-text.expected.json`):
```json
{
  "fixture": "simple-text.ndjson",
  "captured_against": "gemini-cli@0.37.1",
  "captured_at": "2026-04-11T00:00:00Z",
  "description": "Single-turn text prompt, no tool use. Baseline happy path.",
  "chunks": [
    { "type": "system", "subtype": "init", "sessionId": "<REDACTED>", "model": "gemini-2.5-pro" },
    { "type": "assistant", "content": "..." },
    { "type": "result", "sessionId": "<REDACTED>", "stopReason": "end_turn", "tokens": { "input": 12, "output": 47 } }
  ],
  "exit_code": 0,
  "stderr_patterns": []
}
```

The `<REDACTED>` placeholder is a literal string. Phase 3's fixture-runner replaces it with a regex match when asserting. This keeps fixtures stable across re-captures.

### Pattern 3: Single-Source Capture Script with Redaction Pipeline

**What:** `scripts/capture-fixtures.mjs` is a Node.js script that (a) spawns `gemini-cli` per scenario, (b) pipes stdout/stderr through a redactor, (c) writes `.ndjson` + `.stderr.txt`, (d) validates against `events.schema.json` via Ajv, (e) is re-runnable with zero manual steps.

**Pseudocode:**
```javascript
// scripts/capture-fixtures.mjs
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

const SCENARIOS = [
  { name: 'simple-text', args: ['-p', 'Say "hello" in one word.', '--output-format', 'stream-json'] },
  { name: 'tool-use-builtin', args: ['-p', 'Read the file test.txt in the current directory and show its contents.', '--output-format', 'stream-json', '--approval-mode', 'yolo'], cwd: './spec/fixtures/_assets/workspace' },
  // ... 9 more
];

const REDACTORS = [
  // Order matters: longest/most-specific patterns first
  { pattern: /AIzaSy[A-Za-z0-9_-]{33}/g, replacement: 'AIzaSy<REDACTED_API_KEY>' },
  { pattern: /AIza[A-Za-z0-9_-]{35}/g, replacement: 'AIza<REDACTED_API_KEY>' },
  { pattern: /ya29\.[0-9A-Za-z_-]{20,}/g, replacement: 'ya29.<REDACTED_OAUTH_TOKEN>' },
  { pattern: /\b[a-z][-a-z0-9]{4,28}[a-z0-9]\b(?=.*project)/gi, replacement: '<REDACTED_GCP_PROJECT>' },
  { pattern: /"session_id"\s*:\s*"[^"]+"/g, replacement: '"session_id":"<REDACTED_SESSION_ID>"' },
  // Windows paths from capture host
  { pattern: /C:\\Users\\[^\\"]+/gi, replacement: 'C:\\Users\\<REDACTED>' },
  { pattern: /\/home\/[^\/"]+/g, replacement: '/home/<REDACTED>' },
  { pattern: /\/Users\/[^\/"]+/g, replacement: '/Users/<REDACTED>' },
];

function redact(line) {
  let out = line;
  for (const r of REDACTORS) out = out.replace(r.pattern, r.replacement);
  return out;
}

async function captureScenario(scenario, pinned_version) {
  const env = { ...process.env, GEMINI_CLI_VERSION_PIN: pinned_version };
  const proc = spawn('gemini', scenario.args, {
    cwd: scenario.cwd || process.cwd(),
    env,
    shell: false,            // NEVER shell: true
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const ndjsonPath = `spec/fixtures/${scenario.name}.ndjson`;
  const stderrPath = `spec/fixtures/${scenario.name}.stderr.txt`;
  // ... drain stdout line-by-line through redact(), write to ndjsonPath
  // ... drain stderr in parallel, redact, write to stderrPath
  // ... await proc exit, record exitCode in expected.json
}
```

**Key properties:**
- UTF-8 native (Node handles encoding without `chcp` dances)
- `shell: false` always (prevents injection per PITFALLS.md Pitfall 6)
- `windowsHide: true` (matches FDN-05 requirement set in Phase 2)
- Parallel stdout/stderr drain (prevents deadlock per PITFALLS.md Pitfall 2)
- Redactor runs BEFORE writing to disk — if the script crashes, no unredacted file exists
- Manual human-review diff is a documented gate before `git add` (belt-and-braces per CONTEXT.md)

### Anti-Patterns to Avoid

- **Speccing schemas from docs alone.** Matches ARCHITECTURE.md Anti-Pattern 5. `docs/cli/headless.md` only enumerates event type NAMES — no field schemas. WebFetch confirmed this.
- **Capturing fixtures manually via shell redirection.** `gemini -p "..." > fixture.ndjson` on Windows produces CRLF-laden, un-redacted, irreproducible files. Use the script.
- **Pinning the schema a priori and forcing captures to fit.** Capture first, schema second.
- **Storing fixtures as anything other than raw NDJSON with sibling `.expected.json`.** This is Archon/Claude-SDK convention — follow it for downstream compatibility.
- **Committing real session IDs, absolute paths, or API keys.** Redactor is MANDATORY, not optional.
- **Writing a sync capture script.** Must use `spawn` + async streams — `execSync` buffers to EOF and will silently truncate `large-output.ndjson` (>200KB per Pitfall 2).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON Schema → TS types | Custom type extractor | `json-schema-to-typescript@15.0.4` | Ecosystem standard, handles `oneOf` discriminated unions, `$ref`, nested `$defs` correctly |
| JSON Schema → Pydantic models | Custom Pydantic emitter | `datamodel-code-generator@0.30.2` | Pydantic-official tool, handles JSON Schema 2020-12, generates clean Pydantic v2 code |
| Runtime JSON Schema validation (during capture) | Hand-rolled validator | `ajv@8` + `ajv-formats` | To validate captured fixtures conform to the schema we're authoring iteratively |
| Secret detection (as a second-pass audit) | Regex-only redactor | `detect-secrets` or `trufflehog` as post-capture scanner | Our regex redactor is the first line; a scanner catches what regex missed before commit |
| NDJSON stream parser in the capture script | Write your own | Node's `readline.createInterface({ input: proc.stdout, crlfDelay: Infinity })` | Built-in, correct CRLF handling, partial-line reassembly |
| Fixture reproducibility | Manual `spec/capture.md` instructions | `scripts/capture-fixtures.mjs` as single entry point | Manual docs drift; a script is executable documentation |
| Cross-platform shell wrappers | Elaborate `.cmd`/`.ps1`/`.sh` with platform detection | Node.js script + 3-line thin wrappers | Node is already a hard prerequisite |

**Key insight:** Phase 1 writes ZERO production SDK code. Every tool above is used either (a) to generate the `spec/events.schema.json` downstream consumers, or (b) to execute the capture pipeline. The SDK itself starts in Phase 2.

---

## Common Pitfalls

### Pitfall 1: Trusting upstream docs for event field schemas

**What goes wrong:** Write `spec/events.schema.json` from `docs/cli/headless.md` alone. It lists the 6 type names but NO field schemas. Parser (Phase 3) gets built against a fantasy schema. Production breaks on first real `gemini-cli` run.
**Why it happens:** Docs say "init event contains session_id and model" — that's ALL they say. No actual NDJSON example is shown on the documentation page (WebFetch confirmed `geminicli.com/docs/cli/headless/` has no code examples, and `github.com/google-gemini/gemini-cli/blob/main/docs/cli/headless.md` similarly has none).
**How to avoid:** Capture 11 real fixtures FIRST. Author the schema by observing fields that actually appear. Set `additionalProperties: true` on every definition so the parser tolerates additions.
**Warning signs:** Schema authored before fixtures are committed. Types in schema that don't appear in any fixture. No citation-to-fixture-filename in `spec/protocol.md`.

### Pitfall 2: Assuming `--resume` + `-p` is still broken (or still fixed)

**What goes wrong:** CONTEXT.md inherits the assumption that `#14180` is a live bug. Research found the issue was closed as COMPLETED on Dec 4 2025, with a comment claiming fix in `v0.20.0-nightly`. BUT a later adapter (paperclip #2907) reports `v0.34.0+` broke the positional-vs-`-p` combination differently. The bug moves around between releases.
**Why it happens:** Fast-moving upstream + multiple overlapping issues (#14180, #8689, #22417, paperclip #2907) means "is this fixed?" is version-specific.
**How to avoid:** Phase 1 MUST run all 9 combinations on the pinned version and record the matrix in `spec/feasibility.md`. Don't trust any comment without empirical confirmation.

| | positional | stdin | `-p "..."` |
|---|---|---|---|
| Fresh session (no `--resume`) | Test | Test | Test |
| `--resume latest` | Test | Test | Test |
| `--resume <id>` | Test | Test | Test |

**Warning signs:** `spec/feasibility.md` has a single "works/doesn't work" verdict instead of a 9-cell matrix. No version number attached to the verdict.

### Pitfall 3: `GEMINI_CONFIG_DIR` non-functional on Windows

**What goes wrong:** SDK writes MCP passthrough config to `%TEMP%/gemini-config-xyz/settings.json`, sets `GEMINI_CONFIG_DIR=%TEMP%/gemini-config-xyz`, spawns `gemini-cli`. The CLI ignores the env var and reads from `~/.gemini/settings.json` instead.
**Why it happens:** Confirmed live bug in #8248, **closed as "Not Planned" on 2025-12-14**. Maintainers will not fix. This breaks Phase 9's MCP passthrough design if we rely on the env var.
**How to avoid:** Phase 1 smoke test #2 MUST (a) test `GEMINI_CONFIG_DIR` redirect on the Windows capture host, (b) test alternative redirect mechanisms: `HOME` env override, `USERPROFILE` env override, `--settings <path>` if any such flag exists, `gemini mcp add --scope project` writing to `./.gemini/settings.json` in an isolated `cwd`. Document which mechanism(s) work in `spec/feasibility.md`.
**Warning signs:** Phase 1 only tests one mechanism and calls it done. No fallback documented for Phase 9.

### Pitfall 4: Stream-json block-buffering hiding in short fixtures

**What goes wrong:** Every short fixture (simple-text, tool-use-builtin) appears to stream per-event. Phase 1 declares stream-json "flushed per-event." Phase 4 ships, real users with long agent runs see their events arrive in 64 KB blocks, UI hangs for seconds.
**Why it happens:** Node's default stdout buffering is 64 KB when stdin is a pipe (not a TTY). A short output fits in one block and APPEARS to stream; the block simply flushes at process exit. Only outputs >64 KB expose the bug. Per PITFALLS.md Pitfall 2 and ARCHITECTURE.md "stdout buffering."
**How to avoid:** `large-output.ndjson` MUST be intentionally long (target: >128 KB of NDJSON, so multiple 64 KB flushes happen mid-stream). The smoke test measures per-event latency via Node `performance.now()` at read time vs. a known gemini-side emit time — or simpler: measures the wall-clock distribution of inter-line arrival times, comparing a short vs. long run. If long runs show bursty arrival patterns matching 64 KB block boundaries, flushing is broken.
**Warning signs:** `large-output` prompt produces <10 KB output. No timing measurement in `spec/feasibility.md`. Verdict based on "events arrived eventually" rather than "events arrived incrementally."

### Pitfall 5: CRLF-normalization of captured fixtures

**What goes wrong:** Windows capture produces `\r\n`-terminated NDJSON. Git's `core.autocrlf=true` on Windows checks in `\n`-terminated files. Checkout on Linux CI produces `\n` files. Tests pass because `\n` parser tolerates both. But `error-auth.stderr.txt` captured on Windows contains CRLF, commits as LF, and the error classifier's pattern match (e.g. `"Error: 401 Unauthorized\r\n"`) fails because the `\r` is gone.
**Why it happens:** Git silently mutates line endings when `core.autocrlf` is on.
**How to avoid:** Add `spec/fixtures/** -text` to `.gitattributes` at repo root as part of Phase 1. This disables line-ending normalization for fixtures. Commit fixtures as captured — CRLF on Windows, LF on Unix — so stderr patterns match byte-for-byte.
**Warning signs:** No `.gitattributes` entry for fixtures. Fixture files look clean in Git but tests show hash mismatch across OSes.

### Pitfall 6: Over-redaction destroying fixture fidelity

**What goes wrong:** Aggressive redactor replaces anything vaguely key-like. Legitimate `session_id` values get replaced mid-JSON, producing invalid JSON. `large-output.ndjson` has half its content replaced because it mentions words that match a project-ID regex.
**Why it happens:** Regex redactors lack JSON-structure awareness.
**How to avoid:** Redact at the JSON-value level, not raw-string level, for structured fields (`session_id`, `model`, user paths). Use raw-regex only for API-key formats. Redact AFTER `JSON.parse` + re-serialize so output is guaranteed valid JSON. Log every redaction so human review can audit.
**Warning signs:** Redactor operates on raw byte streams. No JSON parse/serialize round-trip in the pipeline. No redaction log for human review.

### Pitfall 7: `event-unknown.ndjson` fabricated incorrectly

**What goes wrong:** Synthetic fixture uses an invented `type` value like `"type": "cosmic_ray"` — but also uses fields that match no real event shape. Phase 3 parser test passes trivially because nothing matches, but doesn't actually exercise the "known-type discriminator fails gracefully" code path.
**Why it happens:** Synthetic fixtures are easy to get wrong — they only test what you remember to test.
**How to avoid:** Base `event-unknown.ndjson` on a REAL captured line (e.g. from `simple-text.ndjson`), with ONLY the `type` field mutated to an invented value. That way the fields are realistic, and the test truly asserts "parser yields `{type: 'unknown', raw: <original>}` when type doesn't match the known enum." Document the synthetic provenance explicitly in `spec/capture.md`.
**Warning signs:** Synthetic fixture looks nothing like real output. No comment explaining its construction. PRS-03 test is the only one that touches it.

---

## Code Examples

### Events Schema — full working example

**Source:** Authored from empirical captures during W4. The skeleton below is illustrative; field lists come from real NDJSON.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://gemini-sdk/spec/events.schema.json",
  "title": "Gemini CLI stream-json Event",
  "description": "Union of event types emitted by `gemini --output-format stream-json`. Field schemas derived empirically from spec/fixtures/ against gemini-cli version in .gemini-cli-compat. additionalProperties:true on every def so parsers tolerate new fields.",
  "oneOf": [
    { "$ref": "#/$defs/InitEvent" },
    { "$ref": "#/$defs/MessageEvent" },
    { "$ref": "#/$defs/ToolUseEvent" },
    { "$ref": "#/$defs/ToolResultEvent" },
    { "$ref": "#/$defs/ErrorEvent" },
    { "$ref": "#/$defs/ResultEvent" }
  ],
  "$defs": {
    "InitEvent": {
      "type": "object",
      "required": ["type"],
      "properties": {
        "type": { "const": "init" },
        "session_id": { "type": "string" },
        "model": { "type": "string" }
      },
      "additionalProperties": true
    },
    "MessageEvent": {
      "type": "object",
      "required": ["type"],
      "properties": {
        "type": { "const": "message" },
        "role": { "type": "string", "enum": ["user", "assistant"] },
        "content": { "type": "string" }
      },
      "additionalProperties": true
    },
    "ToolUseEvent": {
      "type": "object",
      "required": ["type"],
      "properties": {
        "type": { "const": "tool_use" }
      },
      "additionalProperties": true
    },
    "ToolResultEvent": {
      "type": "object",
      "required": ["type"],
      "properties": {
        "type": { "const": "tool_result" }
      },
      "additionalProperties": true
    },
    "ErrorEvent": {
      "type": "object",
      "required": ["type"],
      "properties": {
        "type": { "const": "error" }
      },
      "additionalProperties": true
    },
    "ResultEvent": {
      "type": "object",
      "required": ["type"],
      "properties": {
        "type": { "const": "result" }
      },
      "additionalProperties": true
    }
  }
}
```

### Codegen smoke test — TypeScript

```bash
# Run from repo root during W4 of Phase 1
npx json-schema-to-typescript@15.0.4 spec/events.schema.json > /tmp/events.d.ts
cat /tmp/events.d.ts   # Should show: export type Event = InitEvent | MessageEvent | ...
# Acceptance: file compiles under `tsc --noEmit --target es2022 /tmp/events.d.ts`
```

### Codegen smoke test — Python

```bash
# Run from repo root during W4 of Phase 1
uvx --from datamodel-code-generator==0.30.2 datamodel-codegen \
    --input spec/events.schema.json \
    --input-file-type jsonschema \
    --output /tmp/events.py \
    --output-model-type pydantic_v2.BaseModel \
    --target-python-version 3.10 \
    --use-annotated \
    --use-union-operator
# Acceptance: python -c "import /tmp/events.py" succeeds AND generated file has
# `Event = Annotated[Union[InitEvent, MessageEvent, ...], Field(discriminator='type')]`
```

### Capture script invocation

```bash
# On Windows capture host
set GEMINI_API_KEY=<real-key-never-committed>
.\scripts\capture-fixtures.cmd all

# On macOS/Linux CI (future — Phase 11)
export GEMINI_API_KEY=<ci-secret-from-vault>
./scripts/capture-fixtures.sh all

# Capture a single scenario (dev iteration)
.\scripts\capture-fixtures.cmd simple-text
```

### `spec/feasibility.md` structure template

```markdown
# Phase 1 Feasibility Verdicts

**Captured against:** gemini-cli 0.37.1
**Capture host:** Windows 11 Pro, en-US locale
**Capture date:** 2026-04-11

## Verdict 1: `--resume` + `-p` interop (issue #14180)

| | positional | stdin | -p "..." |
|---|---|---|---|
| Fresh session | PASS | PASS | PASS |
| `--resume latest` | FAIL ("must use -p") | FAIL | PASS |
| `--resume <id>` | FAIL | FAIL | PASS |

**Verdict:** PARTIAL. `--resume` + `-p` WORKS; `--resume` + positional/stdin FAILS.
**Phase 7 implication:** `transcript_prepend_fallback: false`. Primary path = `--resume <id> -p "..."`.
**Fixtures evidencing:** resume-session-turn1.ndjson, resume-session-turn2.ndjson

## Verdict 2: GEMINI_CONFIG_DIR isolation (Phase 9 blocker)

[... similar table ...]

## Verdict 3: stream-json per-event flushing

[... timing measurements ...]
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `--prompt "..."` | Positional arg | Phase 1 deprecation in issue #6706 | `-p` is deprecated but still works; positional is recommended outside `--resume` context |
| Legacy `--output-format json` (single blob) | `--output-format stream-json` (NDJSON) | PR #10883 (merged) | The only sane streaming format. `text` is for humans; `json` is legacy batch. |
| `--allowed-tools <list>` | Policy Engine (settings.json `security.tools`) | Ongoing deprecation | `--allowed-tools` still works but will be removed. Phase 8 handles migration. |
| `~/.gemini/settings.json` only | Per-project `./.gemini/settings.json` | Always supported, re-emphasized | Phase 9 fallback for broken `GEMINI_CONFIG_DIR`: write `./.gemini/settings.json` in a temp `cwd`. |

**Deprecated/outdated:**
- **Gemini 2.5 Flash and 2.5 Pro** — deprecate 2026-06-17 (nine weeks from research date). `thinking.ndjson` fixture captured against 2.5 Pro must be re-captured against the successor model before or shortly after EOL.
- **`GEMINI_CONFIG_DIR` on Windows** — tracked as broken in #8248, closed "Not Planned." Treat as non-working on the Windows capture host; validate empirically for Linux/macOS separately.
- **`--yolo` alias** — deprecated alias for `--approval-mode yolo`. Don't use in capture scripts; use the explicit form.

---

## Open Questions

1. **Does `stream-json` have a `tool_use` event with a stable `id` field for pairing with `tool_result`?**
   - What we know: Upstream docs enumerate both event types but don't document field schemas. PRS-07 requires paired tool_use/tool_result in Phase 3.
   - What's unclear: Whether the CLI emits a correlation ID, or whether pairing must be done positionally.
   - Recommendation: Capture `tool-use-builtin.ndjson` carefully; document the actual pairing mechanism in `spec/protocol.md`; if there's no correlation ID, Phase 3 parses positionally and documents the limitation.

2. **Does `GEMINI_SYSTEM_MD` work per-invocation with `--resume`?**
   - What we know: `GEMINI_SYSTEM_MD` is first-class per research. `--resume` loads prior context.
   - What's unclear: If `--resume` "replays" the session, does the original system prompt persist? Can a follow-up turn override it?
   - Recommendation: NOT Phase 1 — this is Phase 4/7 territory. Flag it for those phases.

3. **What stderr format does `gemini-cli` emit for rate limits?**
   - What we know: Exit code 1 for API failures. Live issue #22631 ("keeps thinking because of Too Many Requests") suggests rate limits don't always surface cleanly.
   - What's unclear: Exact stderr text patterns, whether `Retry-After` header is surfaced, whether 429s arrive as stream-json `error` events or only as exit-code failures.
   - Recommendation: `error-rate-limit.ndjson` + `error-rate-limit.stderr.txt` capture captures BOTH stdout and stderr; Phase 5 uses this as the source of truth.

4. **Can a `thinking` event be reliably captured with Gemini 2.5 Pro in headless mode?**
   - What we know: Gemini 2.5 Pro supports extended reasoning. stream-json may or may not expose these events in headless mode.
   - What's unclear: Whether extended thinking requires a specific flag (e.g., `--thinking-budget <N>` or a settings.json key), or whether it's on by default for the Pro model.
   - Recommendation: Phase 1 attempts a capture; if no `thinking`-type events appear, document the gap in `spec/protocol.md` and mark the fixture as "captured but empty of thinking events," not failing the phase. Phase 3 still gets to synthesize a `thinking` variant from structural knowledge.

5. **How does `--include-directories` interact with `@`-reference multimodal?**
   - What we know: `@path/to/file` prefix references inject file content into the prompt. Images and PDFs are supported (AddyOsmani blog).
   - What's unclear: Whether `--include-directories` is required for `@` to resolve, or whether `@` takes explicit paths relative to `cwd`.
   - Recommendation: `multimodal-image.ndjson` and `multimodal-pdf.ndjson` capture scripts use `@spec/fixtures/_assets/sample-image.png` syntax; document what works in `spec/capture.md`.

---

## Fixture Capture Strategy

### Pinned version determination

**Runbook (W1):**
1. Check `https://github.com/google-gemini/gemini-cli/releases` for latest **stable** (non-preview, non-nightly) release.
2. As of 2026-04-11, that is `v0.37.1` (released 2026-04-09, confirmed via WebFetch).
3. `npm install -g @google/gemini-cli@0.37.1`
4. `gemini --version` → verify output matches.
5. Write `0.37.1` (just the version, no prefix) to `.gemini-cli-compat` in repo root.

**If `v0.37.1` has a known blocker that bites Phase 1:** Fall back to the next-oldest stable release with a documented reason in `spec/feasibility.md`. The pin is under our control.

### 11-Fixture Scenario Playbook

Each row below is a concrete capture recipe. Prompt text is illustrative — exact text lives in `spec/capture.md`. All scenarios pass `--output-format stream-json`.

| # | Fixture | Trigger | Expected events | Notes |
|---|---------|---------|----------------|-------|
| 1 | `simple-text.ndjson` | `gemini -p "Say hello in one word."` | init → message(assistant) → result | Baseline. Should be <1 KB. |
| 2 | `tool-use-builtin.ndjson` | `gemini -p "Read test.txt and show contents" --approval-mode yolo` with a prepared `cwd` containing `test.txt` | init → tool_use(read_file) → tool_result → message(assistant) → result | Built-in tool. YOLO mode avoids approval blocking headless. |
| 3 | `resume-session-turn1.ndjson` + `.turn2.ndjson` | Turn 1: `gemini -p "My favorite number is 47. Remember it."` — capture `session_id` from init event. Turn 2: `gemini --resume <id> -p "What number did I say?"` | Turn 1: standard init→message→result. Turn 2: init(same session_id) → message(referencing 47) → result | **Critical**: Requires Phase 1 smoke test #1 to have passed with `-p`. If it failed, turn 2 captures the failure mode instead. |
| 4 | `error-rate-limit.ndjson` + `.stderr.txt` | Set `GEMINI_API_KEY` to a freshly-created key with no quota (create via AI Studio, use immediately before any grace credit applies). Run `gemini -p "trigger quota"`. If grace credit interferes, fall back to rapid-fire 50+ invocations in a loop. | init → error (or exit with non-zero code) + stderr with 429/quota text | Both stdout AND stderr captured. Exit code recorded in `.expected.json`. |
| 5 | `error-auth.ndjson` + `.stderr.txt` | `GEMINI_API_KEY=invalid-key-12345 gemini -p "hello"` | error event + stderr "invalid API key" pattern, non-zero exit | Most reliable error trigger. |
| 6 | `event-unknown.ndjson` | **SYNTHETIC**. Take `simple-text.ndjson`, copy the `init` line, mutate `"type": "init"` → `"type": "cosmic_ray_hit"`. | N/A (the sidecar says parser should yield `{type:'unknown', raw}`) | Document in `spec/capture.md` as synthetic; explain why. |
| 7 | `thinking.ndjson` | `gemini --model gemini-2.5-pro -p "What is 23*17? Think step by step."` | init → (possibly thinking events) → message → result | If thinking events don't appear in stream-json, capture what DOES appear and document the gap. |
| 8 | `multimodal-image.ndjson` | `gemini -p "Describe @spec/fixtures/_assets/sample-image.png in one sentence."` | init → message → result | Image asset must be small (<50KB) and committed. Suggest a 4×4 red-square PNG. |
| 9 | `multimodal-pdf.ndjson` | `gemini -p "Summarize @spec/fixtures/_assets/sample-document.pdf in one sentence."` | init → message → result | PDF asset must be tiny (<10KB). Generate a 1-page PDF with "Hello world" via `printf` + any PDF generator. |
| 10 | `large-output.ndjson` | `gemini -p "List 200 distinct facts about octopuses, one per line, numbered."` | init → many message chunks → result. **Target: >128 KB output** to exceed Node's default 64 KB pipe buffer and expose any block-buffering bug. | Used for smoke test #3 (flushing). Time-stamp each line at capture. |
| 11 | `abort-midstream.ndjson` | Start a long prompt like #10 but SIGTERM the process at ~2 seconds. | Truncated NDJSON (partial final line allowed), non-zero exit | Capture script kills the child after a sleep; writes whatever arrived. |

### Image and PDF asset generation

**Decision:** Commit tiny test assets. Image: 4×4 PNG red square (~70 bytes) generated via a one-line Node script or committed binary. PDF: 1-page "Hello world" PDF (~500 bytes) committed.

**Why not larger/real assets:** Keeps repo lean, avoids binary-diff noise, isolates the "multimodal input works" test from "image content matches expected caption" — the assertion is on event shape, not content fidelity.

### Redaction Pipeline

**Layer 1: Runtime regex redactor** (in `capture-fixtures.mjs`):

| Pattern | Matches | Replacement |
|---------|---------|-------------|
| `AIzaSy[A-Za-z0-9_-]{33}` | Gemini API keys (39-char canonical format) | `AIzaSy<REDACTED_API_KEY>` |
| `AIza[A-Za-z0-9_-]{35}` | Broader Google API keys | `AIza<REDACTED_API_KEY>` |
| `ya29\.[0-9A-Za-z_-]{20,}` | OAuth access tokens | `ya29.<REDACTED_OAUTH_TOKEN>` |
| `"session_id"\s*:\s*"[^"]+"` | JSON session IDs | `"session_id":"<REDACTED_SESSION_ID>"` |
| `C:\\Users\\[^\\\"]+` | Windows user-profile paths | `C:\\Users\\<REDACTED>` |
| `/home/[^/\"]+` | Linux home paths | `/home/<REDACTED>` |
| `/Users/[^/\"]+` | macOS home paths | `/Users/<REDACTED>` |
| `gemini-cli version: [^\s]+` | Version strings in stderr | Preserve version, redact build hash if present |

**Layer 2: Structure-aware JSON redaction**: Parse each NDJSON line, redact known sensitive fields (`session_id`, `user_id`, `account_id`, file paths in tool_result content), re-serialize. Guarantees valid JSON output even if regex misses something.

**Layer 3: Post-capture audit**: Run `trufflehog filesystem --directory spec/fixtures/` as a CI gate (future; Phase 2 adds to CI). For Phase 1, run manually before commit: `npx @trufflesecurity/trufflehog filesystem spec/fixtures/`.

**Layer 4: Human diff review** (per CONTEXT.md belt-and-braces). `git diff --stat spec/fixtures/` before every fixture commit; eyeball the output for anything that looks key-shaped, path-shaped, or ID-shaped.

### Windows-specific gotchas for capture

| Concern | Mitigation |
|---------|------------|
| Code page / OEM encoding | Node handles UTF-8 natively; don't call `chcp`. Set `PYTHONIOENCODING=utf-8` in child env only if script ever invokes Python. |
| CRLF in committed fixtures | `.gitattributes`: `spec/fixtures/** -text` disables normalization. Commit as captured. |
| `%USERPROFILE%` paths leaking | Redactor matches `C:\\Users\\<name>` pattern. |
| `gemini.cmd` vs `gemini.exe` resolution | `spawn('gemini', ...)` with `shell: false` — Node resolves via PATH + PATHEXT. No shell expansion. |
| `windowsHide: true` | Set on every spawn to prevent console flash. |
| Long paths (>260 chars) | Avoid. Keep `spec/fixtures/` near repo root. |
| Non-en-US locale mojibake | Phase 1's Windows host is en-US per CONTEXT.md. Non-en-US risk deferred to Phase 2 CI matrix. |

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | None for SDK code (Phase 1 ships no runtime code). Validation happens via ad-hoc Node + Python commands for schema/fixture correctness. |
| Config file | None yet — Phase 2 creates `ts/vitest.config.ts` and `python/pyproject.toml` |
| Quick run command | `node scripts/validate-fixtures.mjs` (created in Phase 1 W4) |
| Full suite command | `node scripts/validate-fixtures.mjs && npx json-schema-to-typescript@15.0.4 spec/events.schema.json > /dev/null && uvx datamodel-code-generator@0.30.2 --input spec/events.schema.json --input-file-type jsonschema --output /dev/null --output-model-type pydantic_v2.BaseModel` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PRS-08 | `spec/events.schema.json` compiles with `json-schema-to-typescript@15.0.4` to valid TS | smoke | `npx json-schema-to-typescript@15.0.4 spec/events.schema.json > /tmp/events.d.ts && npx -y typescript@5 tsc --noEmit --target es2022 --strict /tmp/events.d.ts` | ❌ W0 creates `scripts/validate-schema-ts.mjs` |
| PRS-08 | `spec/events.schema.json` compiles with `datamodel-code-generator@0.30.2` to valid Pydantic v2 | smoke | `uvx --from datamodel-code-generator==0.30.2 datamodel-codegen --input spec/events.schema.json --input-file-type jsonschema --output /tmp/events.py --output-model-type pydantic_v2.BaseModel --target-python-version 3.10 && python -c "exec(open('/tmp/events.py').read())"` | ❌ W0 creates `scripts/validate-schema-py.sh` |
| PRS-09 | Every `spec/fixtures/*.ndjson` parses as valid NDJSON | unit | `node scripts/validate-fixtures.mjs parse` | ❌ W0 creates `scripts/validate-fixtures.mjs` |
| PRS-09 | Every event in every fixture validates against `spec/events.schema.json` via Ajv | unit | `node scripts/validate-fixtures.mjs schema` | ❌ W0 adds `schema` subcommand |
| PRS-09 | Every `.ndjson` has a sibling `.expected.json` | unit | `node scripts/validate-fixtures.mjs pairs` | ❌ W0 adds `pairs` subcommand |
| PRS-09 | No secrets remain in fixtures (post-redaction audit) | integration | `npx @trufflesecurity/trufflehog filesystem spec/fixtures/ --fail` | ❌ W0 adds as `scripts/audit-fixtures.cmd` |
| PRS-09 | Feasibility smoke tests produce a pass/fail verdict | manual | Run `scripts/capture-fixtures.cmd feasibility` | ❌ W2 creates subcommand |
| PRS-09 | Fixture re-capture is reproducible from scratch | manual | `rm -rf spec/fixtures/*.ndjson && .\\scripts\\capture-fixtures.cmd all` then `git diff --stat spec/fixtures/` should show only expected changes | manual-only |

### Sampling Rate

- **Per task commit:** `node scripts/validate-fixtures.mjs` (< 2 seconds — just JSON parse + schema check)
- **Per wave merge:** Full suite including both codegen smoke tests + trufflehog audit (< 30 seconds)
- **Phase gate:** All automated validation green + human review of every fixture diff before `/gsd:verify-work`

### Wave 0 Gaps

Phase 1 starts with zero test infrastructure. Wave 0 MUST create:

- [ ] `.gitattributes` with `spec/fixtures/** -text` — disables CRLF normalization (Pitfall 5)
- [ ] `scripts/validate-fixtures.mjs` — NDJSON parser + Ajv schema validator with `parse`, `schema`, `pairs` subcommands
- [ ] `scripts/capture-fixtures.mjs` — THE capture engine (can stub in W0; filled in W3)
- [ ] `scripts/capture-fixtures.cmd` + `scripts/capture-fixtures.sh` — thin platform wrappers
- [ ] `scripts/validate-schema-ts.mjs` — invokes `json-schema-to-typescript` and tsc-compiles the output
- [ ] `scripts/validate-schema-py.sh` — invokes `datamodel-code-generator` and importsmoke-tests the output
- [ ] `scripts/audit-fixtures.cmd` — invokes trufflehog over fixtures
- [ ] `spec/` directory with empty placeholders for `protocol.md`, `errors.md`, `feasibility.md`, `capture.md`, `events.schema.json`, `fixtures/_assets/`

**Why so much in W0:** Phase 1 is an empirical-validation phase, and validation requires tooling. The tooling itself is Phase 1's other deliverable. Build the tools in W0, use them in W1-W4.

**No Python runtime tests in Phase 1.** Phase 1 consumes `datamodel-code-generator` via `uvx` only to prove the schema compiles; no Pydantic-consuming test code is written. Phase 3 is where Python runtime tests against fixtures begin.

---

## Sources

### Primary (HIGH confidence)

- **gemini-cli main branch `docs/cli/headless.md`** (https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/headless.md) — 6 event type names, 4 exit codes. Confirmed: NO field schemas, NO example NDJSON. This is the direct evidence that Phase 1 must capture empirically.
- **gemini-cli `docs/cli/cli-reference.md`** (https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/cli-reference.md) — Flag reference: `-p`, `-r "latest"` or `-r <id>`, `--output-format {text,json,stream-json}`, `--include-directories` (comma or repeated), `--approval-mode {default,auto_edit,yolo,plan}`, `--allowed-tools` (deprecated). No GEMINI_* env vars documented here.
- **Issue #14180** (https://github.com/google-gemini/gemini-cli/issues/14180) — Title: "stdin and positional arguments don't work with --resume flag". Status: CLOSED as COMPLETED on Dec 4 2025. Comment claims fix in v0.20.0-nightly with strict validation removed. **Ambiguous**: must empirically re-verify against the Phase 1 pinned version.
- **Issue #8248** (https://github.com/google-gemini/gemini-cli/issues/8248) — Title: "Bug: GEMINI_CONFIG_DIR environment variable is not respected on Windows". Status: CLOSED as "Not Planned" on 2025-12-14. **This is the direct evidence that Phase 1 smoke test #2 will probably fail on Windows; Phase 9 must have a fallback.**
- **Issue #8689** (https://github.com/google-gemini/gemini-cli/issues/8689) — "Positional prompt argument is ignored when other flags are present" — closed via PR #11132 but regression reopened in #10004. Adds evidence that positional-vs-`-p` conflicts shift between releases.
- **PR #10883** (https://github.com/google-gemini/gemini-cli/pull/10883) — "Add support for output-format stream-json flag for headless mode" — merged. This is the PR that introduced stream-json.
- **Releases page** (https://github.com/google-gemini/gemini-cli/releases) — v0.37.1 stable as of 2026-04-09, with v0.38.0-preview.0 and v0.39.0-nightly in flight.
- **`json-schema-to-typescript` npm** (https://www.npmjs.com/package/json-schema-to-typescript) — v15.0.4 latest, `oneOf`/`anyOf` supported for discriminated unions. 696+ dependents.
- **`datamodel-code-generator` PyPI + docs** (https://pypi.org/project/datamodel-code-generator/ and https://docs.pydantic.dev/latest/integrations/datamodel_code_generator/) — v0.30.2 latest (2025-06-12), JSON Schema 2020-12 supported, `--output-model-type pydantic_v2.BaseModel`.
- **JSON Schema Draft 2020-12** (https://json-schema.org/draft/2020-12) — current spec, `$id`, `$defs`, `$ref`, `oneOf`, `additionalProperties` all standard.

### Secondary (MEDIUM confidence, verified against primary)

- **Paperclip issue #2907** (https://github.com/paperclipai/paperclip/issues/2907) — "gemini_local adapter broken on Gemini CLI v0.34.0+ — --prompt flag conflicts with positional argument" — third-party breakage report. Evidence that #14180-class bugs recur across releases.
- **AddyOsmani blog on Gemini CLI tips** (https://addyosmani.com/blog/gemini-cli/) and DeepWiki on addyosmani/gemini-cli-tips (https://deepwiki.com/addyosmani/gemini-cli-tips/4.4-file-and-directory-references) — `@path/to/file` syntax for multimodal includes. Blog is community content; matches behavior documented in upstream blog posts.
- **Claude Agent SDK overview** (https://code.claude.com/docs/en/agent-sdk/overview) — Reference architecture. Wraps Claude Code CLI as subprocess, communicates via NDJSON over stdin/stdout. Directly applicable pattern.
- **Codex SDK** (https://developers.openai.com/codex/sdk, https://www.morphllm.com/codex-sdk) — Reference architecture. Wraps Codex CLI, communicates over stdin/stdout as JSONL. Directly applicable pattern.
- **Secret regex list** (https://github.com/h33tlit/secret-regex-list) — Confirmed `AIzaSy[A-Za-z0-9_-]{33}` and `AIza[A-Za-z0-9_-]{35}` as canonical Google API key regexes.
- **TruffleHog** (https://github.com/trufflesecurity/trufflehog) — Recommended post-capture audit scanner. Recognizes Gemini API keys.

### Tertiary (LOW confidence, flagged for empirical validation in Phase 1)

- **`thinking` event in gemini-cli headless mode** — Not directly documented. Phase 1 W3 attempts capture; if empty, documents the gap and Phase 3 synthesizes the variant.
- **Exact pairing mechanism for `tool_use` ↔ `tool_result`** — Undocumented. Phase 1 captures `tool-use-builtin.ndjson` and documents what actually appears.
- **`GEMINI_CONFIG_DIR` on macOS/Linux** — Issue #8248 is Windows-specific. Linux/macOS may work. Phase 1 tests only Windows (the capture host); Phase 9 must re-verify on the other platforms.
- **`v0.37.1` positional + `--resume` interop** — Everything about this combo is empirically unknown on this exact version. The 9-cell matrix in Verdict 1 fills this gap.
- **Per-event stream-json flushing behavior** — Source inspection of gemini-cli's stdout write path was not performed in research; verdict must come from timing measurements in Phase 1 W2 smoke test #3.

---

## Metadata

**Confidence breakdown:**

- **Standard stack (JSON Schema tooling):** HIGH — both generators verified via npm/PyPI, both officially support JSON Schema 2020-12 + discriminated unions.
- **Capture script architecture:** HIGH — Node-based approach is derivative of Claude Agent SDK / Codex SDK precedent, uses well-understood Node APIs.
- **Fixture scenario playbook (simple cases):** HIGH — `simple-text`, `error-auth`, `event-unknown`, `large-output`, `abort-midstream` are straightforward.
- **Fixture scenario playbook (multimodal, thinking):** MEDIUM — `@` syntax works per community docs; whether `thinking` events appear in headless stream-json is empirically unresolved.
- **`--resume` + `-p` interop verdict:** MEDIUM — issue #14180 is closed but evidence of related live bugs (#8689, paperclip #2907). Must empirically re-verify against pinned version.
- **`GEMINI_CONFIG_DIR` verdict:** HIGH that it's broken on Windows (#8248 is explicit). MEDIUM on whether alternative mechanisms exist.
- **stream-json per-event flushing:** LOW — not documented anywhere; entirely empirical determination.
- **Pitfalls:** HIGH — all seven come from documented live bugs, Node subprocess behavior, or direct PITFALLS.md citations.
- **Validation architecture:** HIGH — simple and deterministic; each test cited maps to a concrete shell command.

**Research date:** 2026-04-11
**Valid until:** 2026-05-11 (30 days for tooling versions; 7 days for upstream release state because gemini-cli ships weekly and v0.38 / v0.39 may stabilize within the window)
