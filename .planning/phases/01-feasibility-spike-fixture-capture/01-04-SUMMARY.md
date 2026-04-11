---
phase: 01-feasibility-spike-fixture-capture
plan: 04
subsystem: fixture-capture
tags: [gemini-cli, fixture, capture, spawn, redaction, windows]
depends_on:
  - 01-01
  - 01-02
  - 01-03
provides:
  - .gemini-cli-compat with pinned 0.37.1
  - package-lock.json with devDependencies locked
  - scripts/capture-fixtures.mjs with unstubbed simple-text handler
  - spec/fixtures/simple-text.ndjson (4 events, 775 bytes)
  - spec/fixtures/simple-text.expected.json sidecar
affects:
  - W2 smoke tests (depend on gemini-cli being present and pinned)
  - plan 01-05 (depends on capture pipeline working end-to-end)
tech_stack:
  added:
    - gemini-cli@0.37.1 (global npm, OAuth auth)
    - node:child_process spawn (Windows .cmd + shell:true pattern)
    - readline.createInterface (stdout line-by-line streaming)
  patterns:
    - Windows spawn via gemini.cmd with shell:true and single command string (not args array)
    - OAuth auth preferred over GEMINI_API_KEY on this capture host
    - stdout prefix stripping (gemini-cli prepends policy warnings to JSON lines)
    - Two-layer redaction: structural JSON walk + 8-pattern regex
key_files:
  created:
    - .gitignore
    - package-lock.json
    - spec/fixtures/simple-text.ndjson
    - spec/fixtures/simple-text.expected.json
    - spec/fixtures/simple-text.stderr.txt
  modified:
    - .gemini-cli-compat (was empty seed, now contains 0.37.1)
    - scripts/capture-fixtures.mjs (unstubbed simple-text, added runScenario + deriveChunks)
decisions:
  - Windows spawn requires shell:true with gemini.cmd; args must be baked into command string not passed as array (cmd.exe concatenates improperly when args contain quotes)
  - OAuth (oauth_creds.json) accepted as alternative to GEMINI_API_KEY; capture host uses OAuth not API key
  - gemini-cli 0.37.1 on this host uses OAuth; GEMINI_API_KEY env var is not set but captures succeed
  - stdout prefix stripping needed: gemini-cli 0.37.1 prepends non-JSON policy warnings to JSON event lines on stdout (not stderr)
  - stderr.txt written when stderr has content (even for non-captureStderr scenarios) as diagnostic artifact
  - trufflehog audit-fixtures.sh has docker path bug on Git Bash (pre-existing; deferred)
  - GCP project redactor regex over-redacts common English words (pre-existing; deferred to redactor refinement plan)
metrics:
  duration_minutes: 35
  completed_date: "2026-04-11"
  tasks_completed: 3
  files_changed: 7
---

# Phase 1 Plan 4: gemini-cli Install + simple-text Fixture Capture Summary

Installed gemini-cli@0.37.1 globally via OAuth authentication, wrote the pinned version to `.gemini-cli-compat`, materialized devDependencies via `npm install`, and captured the first real NDJSON fixture (`simple-text`) end-to-end through the two-layer redaction pipeline.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | User approved gemini-cli 0.37.1 (human-action checkpoint) | — | — |
| 2 | Write .gemini-cli-compat, add .gitignore, run npm install | 5a9ef98 | .gemini-cli-compat, .gitignore, package-lock.json |
| 3 | Implement simple-text handler + capture first fixture | e758435 | scripts/capture-fixtures.mjs, spec/fixtures/simple-text.{ndjson,expected.json} |

## Version Installed

**gemini-cli@0.37.1** — matches the approved version. `gemini --version` output format is just `0.37.1` (no prefix, no "gemini-cli" label). The CLI also emits a deprecation warning `[experimental.plan] These could not be migrated...` to stderr, which is captured in `simple-text.stderr.txt`.

## Fixture Capture Results

- **File**: `spec/fixtures/simple-text.ndjson`
- **Event count**: 4 (init, user message, assistant message, result)
- **Byte size**: 775 bytes
- **Exit code**: 0
- **Session ID**: redacted to `<REDACTED_SESSION_ID>`
- **API key leak check**: PASS — no `AIzaSy...` pattern in committed files

## Windows-Specific Discoveries

Two critical Windows compatibility issues were found and fixed (Rule 1 + 3):

1. **`spawn('gemini', args, {shell: false})` → ENOENT**: On Windows, npm installs gemini as `gemini.cmd` which requires `cmd.exe`. Fixed by detecting `process.platform === 'win32'` and using `shell:true` with `gemini.cmd` and a baked command string.

2. **Args array with `shell:true` → arg parsing failure**: When shell is true, Node concatenates args with spaces before passing to `cmd.exe`. The prompt `'Say "hello" in one word.'` caused `cmd.exe` to interpret args incorrectly. Fixed by building a single command string with double-quote escaping.

3. **stdout JSON prefix contamination**: gemini-cli 0.37.1 writes policy warning messages directly to stdout before the JSON event, on the same line: `MCP issues detected. Run /mcp list for status.{"type":"init",...}`. Fixed by stripping any non-JSON prefix before the first `{` character on each line.

## Auth Discovery

This capture host uses OAuth (via `~/.gemini/oauth_creds.json`), not `GEMINI_API_KEY`. The original preflight check required `GEMINI_API_KEY` and would exit 4. Updated to accept OAuth credentials as an alternative.

## Redactor Notes

No redactor refinement was required for the `simple-text` fixture. The session_id was correctly redacted to `<REDACTED_SESSION_ID>`. However, the GCP project regex (pattern 8) over-redacts common English words in stderr — this is a pre-existing issue flagged in the decisions log and deferred to a future redactor refinement pass.

## Trufflehog Status

`audit-fixtures.sh` uses docker fallback with `-w /work` which fails under Git Bash on Windows due to MSYS path translation (the path becomes `C:/Program Files/Git/work`). This is a pre-existing bug in the script (plan 01-02 authored). Docker audit is deferred. Manual grep confirms no API key patterns in committed fixture files.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] OAuth auth support added to preflight check**
- Found during: Task 3 (capture attempt)
- Issue: Script required `GEMINI_API_KEY` but capture host uses OAuth
- Fix: Added check for `~/.gemini/oauth_creds.json` as alternative auth method
- Files modified: `scripts/capture-fixtures.mjs`
- Commit: e758435

**2. [Rule 1 - Bug] Windows spawn ENOENT fix for gemini.cmd**
- Found during: Task 3 (first spawn attempt)
- Issue: `spawn('gemini', args, {shell:false})` returns ENOENT on Windows — the gemini binary is actually `gemini.cmd`
- Fix: Platform detection; Windows uses `shell:true` with `gemini.cmd` and a pre-built command string
- Files modified: `scripts/capture-fixtures.mjs`
- Commit: e758435

**3. [Rule 1 - Bug] stdout JSON prefix stripping**
- Found during: Task 3 (first successful capture produced contaminated NDJSON)
- Issue: gemini-cli 0.37.1 prepends warning text to JSON event lines on stdout
- Fix: Added prefix-stripping logic in readline handler; non-JSON prefix before `{` is stripped and logged to stderr
- Files modified: `scripts/capture-fixtures.mjs`
- Commit: e758435

**4. [Rule 2 - Missing] .gitignore created**
- Found during: Task 2 (git status showed no .gitignore)
- Issue: `node_modules/` would be committed without a .gitignore
- Fix: Created `.gitignore` with node_modules/, *.log, OS cruft entries
- Files modified: `.gitignore` (created)
- Commit: 5a9ef98

**5. [Rule 1 - Bug] deriveChunks role mapping fixed**
- Found during: Task 3 (reviewing expected.json output)
- Issue: All message events were mapped to "assistant" type; user messages have `role: "user"` in the stream-json format
- Fix: Use `ev.role` field in deriveChunks to correctly distinguish user vs assistant messages
- Files modified: `scripts/capture-fixtures.mjs`
- Commit: e758435

## Self-Check: PASSED

- spec/fixtures/simple-text.ndjson: FOUND
- spec/fixtures/simple-text.expected.json: FOUND
- .gemini-cli-compat (0.37.1): FOUND
- package-lock.json: FOUND
- commit 5a9ef98: FOUND
- commit e758435: FOUND
