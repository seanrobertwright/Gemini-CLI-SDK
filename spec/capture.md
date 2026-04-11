# Fixture Capture Procedure

**Captured against:** gemini-cli 0.37.1 (see `.gemini-cli-compat`)
**Capture host:** Windows 11 Pro (project author's primary dev box)
**Capture date:** 2026-04-11

---

## Overview

All fixture capture and feasibility testing in this SDK flows through a single entry point:

```
node scripts/capture-fixtures.mjs <subcommand>
```

Fixtures are committed to `spec/fixtures/*.ndjson` and are the authoritative source of truth for both the TypeScript and Python parsers. **Never hand-edit committed fixtures** — always re-capture via the script.

---

## Prerequisites

1. **Node.js 18+**
   ```
   node --version   # must be >= 18.0.0
   ```

2. **gemini-cli installed** at the pinned version recorded in `.gemini-cli-compat`:
   ```
   gemini --version   # must match the version in .gemini-cli-compat
   ```
   On Windows, `gemini.cmd` is the executable; the capture script resolves this automatically via `shell: true`.

3. **Authentication** — one of:
   - `GEMINI_API_KEY` environment variable set to a valid Gemini API key, **or**
   - OAuth credentials present at `~/.gemini/oauth_creds.json` (browser-login via `gemini` in interactive mode)

   The capture script accepts either auth method. Never commit API keys to the repo.

4. **Write access to `spec/`** — the script writes `spec/feasibility.md` and `spec/fixtures/*.ndjson` in-place.

---

## Feasibility Smoke Tests

The three feasibility tests are load-bearing gates. Their verdicts drive implementation choices in downstream phases:

| Test | Verdict key | Downstream consumer |
| --- | --- | --- |
| `--resume` + prompt-mode interop | `resume_verdict` | Phase 7 (session design) |
| `GEMINI_CONFIG_DIR` isolation | `config_dir_verdict` | Phase 9 (MCP passthrough) |
| `stream-json` per-event flushing | `flush_verdict` | Phase 4 (`forcePty` option) |

### Running the feasibility tests

```
node scripts/capture-fixtures.mjs feasibility
```

This runs all three smoke tests sequentially and writes results to `spec/feasibility.md`. Expect **5–15 minutes** wall-clock time depending on model response latency.

**Expected terminal output:**

```
INFO: running feasibility smoke tests (this takes several minutes)
INFO [resume]: starting 9-cell resume × prompt-mode matrix
...
INFO [resume]: verdict=<pass|partial|fail>
INFO [config-dir]: starting GEMINI_CONFIG_DIR isolation test
...
INFO [flush]: starting stream-json per-event flushing test
...
PASS: feasibility smoke tests complete; verdicts written to spec/feasibility.md
  resume_verdict:     <pass|partial|fail>
  config_dir_verdict: <pass|partial|fail>
  flush_verdict:      <pass|partial|fail>
```

### Validating the output

After the run completes, verify the document is structurally valid:

```
node scripts/validate-fixtures.mjs feasibility
```

Must exit 0 with no "pending" INFO lines. If it exits non-zero, the feasibility run produced an incomplete document — check stderr for the specific failure.

### Interpreting the verdicts

See `spec/feasibility.md` for the current recorded verdicts and their downstream implications.

**Verdict definitions:**

- `pass` — Feature works as intended; downstream phase uses it as the primary path.
- `partial` — Feature works but with caveats or inconclusive data; downstream phase applies a conservative default.
- `fail` — Feature is broken; downstream phase uses its documented fallback path.

**Failure response policy** (from `01-CONTEXT.md §Feasibility failure response`):

- `resume_verdict: fail` → Phase 7 lands transcript-prepend as the **default** path; `--resume <id> -p` becomes the fallback behind a config flag.
- `config_dir_verdict: fail` → Phase 9 falls back to `gemini mcp add --scope project` in a temp `cwd` instead of using `GEMINI_CONFIG_DIR`.
- `flush_verdict: fail` → Phase 4 exposes `forcePty: true` as a `query()` option; default remains `false`.
- **All three fail** → Return `## ROADMAP BLOCKED`; re-scoping conversation required before continuing.

---

## All-Scenarios Capture (W3)

Once all fixture scenarios are implemented, re-run everything in one command:

```
node scripts/capture-fixtures.mjs all
```

This replays every registered scenario in `SCENARIOS` and regenerates `spec/fixtures/*.ndjson` plus sibling `*.expected.json` files. The `all` subcommand is fully wired in Wave 3 (plan 01-07 and later).

### Individual scenario capture

To re-capture a single scenario:

```
node scripts/capture-fixtures.mjs <scenario-slug>
```

For example:

```
node scripts/capture-fixtures.mjs simple-text
```

Available slugs are listed in the `SCENARIOS` registry at the top of `scripts/capture-fixtures.mjs`.

---

## Re-Capture on Version Bump

When `.gemini-cli-compat` is bumped to a new `gemini-cli` version:

1. Install the new version: `npm install -g @google/gemini-cli@<new-version>`
2. Verify: `gemini --version`
3. Update `.gemini-cli-compat` with the new version string
4. Re-run feasibility: `node scripts/capture-fixtures.mjs feasibility`
5. Re-run all fixtures: `node scripts/capture-fixtures.mjs all` (once wired in W3)
6. Run the validator: `node scripts/validate-fixtures.mjs all`
7. Review all diffs — especially `spec/feasibility.md` for verdict changes
8. Commit the bumped fixtures and updated `spec/feasibility.md` as a single atomic commit

**Do not** run raw `gemini` invocations outside the capture script when re-capturing — the script applies redaction layers that manual invocations skip.

---

## Redaction Layers

Every fixture written by `scripts/capture-fixtures.mjs` passes through four redaction layers before disk write:

1. **Regex redaction** — Strips known-format secrets: API key prefixes (`AIzaSy...`), Google Cloud project IDs, OAuth token formats, session tokens, and absolute Windows/POSIX paths from the capture host. Implemented in `scripts/_redactor.mjs`.

2. **Structural redaction** — Certain JSON fields are nulled or replaced with placeholder strings regardless of their value (e.g. `session_id` in `init` events is replaced with `<redacted>` in committed fixtures, but preserved in memory during feasibility tests for session chaining).

3. **Trufflehog scan** — CI runs `trufflehog filesystem spec/fixtures/` on every PR to catch any secrets that slipped through layers 1–2.

4. **Human review** — Project author reviews every `spec/fixtures/*.ndjson` diff before merge. Belt-and-braces: automated layers are defense-in-depth, not a substitute for human judgment.

---

## Windows-Specific Notes

The capture script is tested Windows-first. Known differences from POSIX:

- **`gemini` resolves to `gemini.cmd`** on Windows. The capture script uses `shell: true` in `child_process.spawn` so the OS resolves `.cmd` automatically. Do not change this to `shell: false` on Windows without verifying `gemini.cmd` is in `PATH`.

- **Args with quotes** — When using `shell: true`, all arguments are baked into a single command string. The script serializes args as `arg.replace(/"/g, '\\"')` to prevent `cmd.exe` from eating inner quotes. Passing an `args` array to spawn with `shell: true` on Windows causes `cmd.exe` to drop arguments that contain spaces or quotes.

- **Line endings (CRLF)** — `gemini-cli` may emit CRLF in some non-JSON prefix lines (e.g. policy warning banners). The script strips everything before the first `{` character on each line before JSON-parsing. Committed `*.ndjson` files use LF (enforced by `.gitattributes`).

- **`GEMINI_CONFIG_DIR` path separators** — The env var accepts Windows absolute paths (`C:\Users\...\temp-dir`). The capture script uses `path.join()` throughout; never hardcode forward slashes in paths passed to `gemini-cli` on Windows.

- **`HOME` vs `USERPROFILE`** — gemini-cli on Windows reads `USERPROFILE` as the home directory, not `HOME`. The config-dir smoke test overrides both. The `home_override_respected` check in `spec/feasibility.md` reflects whether overriding both was sufficient to redirect config reads.

---

## Fixture Format Reference

Each committed fixture is a pair:

- `spec/fixtures/<slug>.ndjson` — Raw (redacted) NDJSON output from `gemini --output-format stream-json`
- `spec/fixtures/<slug>.expected.json` — Normalized `MessageChunk` event sequence the SDK parser must yield

The `*.expected.json` format is the reference contract for both TypeScript and Python parser test suites (Phase 3, Phase 8). See `spec/events.schema.json` for the JSON Schema definition of the event union.

---

## Validation

Run the full validation suite:

```
node scripts/validate-fixtures.mjs all
```

Or target a specific subcommand:

```
node scripts/validate-fixtures.mjs feasibility
node scripts/validate-fixtures.mjs citations
node scripts/validate-fixtures.mjs schema
```

All must exit 0 before any Phase 1 plan can be marked complete.

---

*See `spec/feasibility.md` for current verdict values.*
*See `scripts/capture-fixtures.mjs` for the exact prompt text used per scenario (`SCENARIOS[<slug>].args`).*

---

## Synthetic fixtures

Not all fixtures are captured from a live `gemini-cli` run. The following fixture(s) are **constructed synthetically** and committed as-is:

### `event-unknown.ndjson`

**Purpose:** Provide a fixture with an invented `type` value that no real `gemini-cli` version will ever emit naturally. Used by Phase 3 PRS-03 to verify the parser's lenient fallback: it must yield `{type: 'unknown', raw: <original object>}` without throwing.

**Construction procedure:**

```bash
node -e '
const fs = require("node:fs");
const src = fs.readFileSync("spec/fixtures/simple-text.ndjson", "utf8");
const firstLine = src.split(/\r?\n/).find(l => l.trim().length > 0);
const obj = JSON.parse(firstLine);
obj.type = "cosmic_ray_hit";
obj._synthetic = true;
obj._derived_from = "simple-text.ndjson line 1";
obj._note = "Mutated from a real captured init event by replacing type with an invented value.";
fs.writeFileSync("spec/fixtures/event-unknown.ndjson", JSON.stringify(obj) + "\n");
console.log("OK: event-unknown.ndjson written");
'
```

**Source line:** The first line of `spec/fixtures/simple-text.ndjson` (an `init` event). Only the `type` field is mutated; all other fields are preserved verbatim from the real capture.

**Invariant:** If `simple-text.ndjson` is re-captured, `event-unknown.ndjson` should be regenerated using the same procedure so the two fixtures remain structurally consistent.

**Never capture synthetically:** All other fixtures in `spec/fixtures/` are captured from real `gemini-cli` runs. Do not manufacture them — always use `node scripts/capture-fixtures.mjs <slug>`.
