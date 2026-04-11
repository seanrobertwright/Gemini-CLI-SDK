---
phase: 1
slug: feasibility-spike-fixture-capture
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-11
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Phase 1 ships no runtime SDK code; validation operates on the spec documents, JSON Schema, and NDJSON fixture corpus themselves. Every check is a concrete shell command that either passes silently or fails with a non-zero exit code.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None for SDK runtime (Phase 1 ships no runtime code). Validation is ad-hoc Node + `uvx` commands executed by standalone scripts under `scripts/`. |
| **Config file** | None yet — Phase 2 creates `ts/vitest.config.ts` and `python/pyproject.toml`. Phase 1 uses `package.json` at repo root for `devDependencies` only. |
| **Quick run command** | `node scripts/validate-fixtures.mjs` |
| **Full suite command** | `node scripts/validate-fixtures.mjs && node scripts/validate-schema-ts.mjs && bash scripts/validate-schema-py.sh && bash scripts/audit-fixtures.sh` |
| **Estimated runtime** | ~30 seconds (full suite); <2 seconds (quick run) |

---

## Sampling Rate

- **After every task commit:** Run `node scripts/validate-fixtures.mjs` (< 2 seconds — JSON-parses every fixture + validates every event against `spec/events.schema.json` via Ajv + asserts `.ndjson`/`.expected.json` pair completeness)
- **After every plan wave:** Run the full suite above — adds the two codegen smoke tests (`json-schema-to-typescript` + `datamodel-code-generator`) plus the trufflehog secret audit across `spec/fixtures/`
- **Before `/gsd:verify-work`:** Full suite must be green AND a human must have reviewed the diff for every committed fixture
- **Max feedback latency:** 30 seconds (full suite); 2 seconds (quick run)

---

## Per-Task Verification Map

Tasks will be created by `gsd-planner` in PLAN.md files. This map lists the verification command per requirement; each PLAN.md task inherits the commands that match its Req IDs. All Req IDs for Phase 1 are `PRS-08` and `PRS-09`.

| Req ID | Behavior | Test Type | Automated Command | File Exists | Status |
|--------|----------|-----------|-------------------|-------------|--------|
| PRS-08 | `spec/events.schema.json` compiles with `json-schema-to-typescript@15.0.4` to TS that `tsc --noEmit --strict` accepts | smoke | `node scripts/validate-schema-ts.mjs` | ❌ W0 creates | ⬜ pending |
| PRS-08 | `spec/events.schema.json` compiles with `datamodel-code-generator@0.30.2` to importable Pydantic v2 | smoke | `bash scripts/validate-schema-py.sh` | ❌ W0 creates | ⬜ pending |
| PRS-08 | `spec/events.schema.json` is valid JSON Schema Draft 2020-12 | unit | `npx -y ajv-cli@5 compile -s spec/events.schema.json --spec=draft2020` | ❌ W0 installs ajv-cli locally | ⬜ pending |
| PRS-09 | Every `spec/fixtures/*.ndjson` parses as well-formed NDJSON (one JSON object per line, trailing newline tolerated) | unit | `node scripts/validate-fixtures.mjs parse` | ❌ W0 creates script | ⬜ pending |
| PRS-09 | Every event in every `spec/fixtures/*.ndjson` validates against `spec/events.schema.json` via Ajv 2020 | unit | `node scripts/validate-fixtures.mjs schema` | ❌ W0 adds `schema` subcommand | ⬜ pending |
| PRS-09 | Every `spec/fixtures/*.ndjson` has a sibling `spec/fixtures/*.expected.json` of equal file stem | unit | `node scripts/validate-fixtures.mjs pairs` | ❌ W0 adds `pairs` subcommand | ⬜ pending |
| PRS-09 | All 11 required fixture slugs exist under `spec/fixtures/` (simple-text, tool-use-builtin, resume-session, error-rate-limit, error-auth, event-unknown, thinking, multimodal-image, multimodal-pdf, large-output, abort-midstream) | unit | `node scripts/validate-fixtures.mjs manifest` | ❌ W0 adds `manifest` subcommand; slug list lives in `spec/fixtures.manifest.json` | ⬜ pending |
| PRS-09 | No secrets remain in `spec/fixtures/` after capture (GEMINI_API_KEY, project IDs, OAuth tokens, absolute host paths) | integration | `bash scripts/audit-fixtures.sh` | ❌ W0 creates; invokes trufflehog filesystem scan | ⬜ pending |
| PRS-09 | `.gemini-cli-compat` exists with a pinned semver string matching `^[0-9]+\.[0-9]+\.[0-9]+$` | unit | `node scripts/validate-fixtures.mjs pin` | ❌ W0 adds `pin` subcommand | ⬜ pending |
| PRS-09 | `spec/feasibility.md` exists AND contains exactly three "Verdict:" lines (resume, config-dir, flush) with pass/fail markers | unit | `node scripts/validate-fixtures.mjs feasibility` | ❌ W0 adds `feasibility` subcommand | ⬜ pending |
| PRS-09 | `spec/protocol.md` and `spec/errors.md` drafts exist AND cite at least one fixture filename per normative claim | unit | `node scripts/validate-fixtures.mjs citations` | ❌ W0 adds `citations` subcommand; script greps for `spec/fixtures/` references | ⬜ pending |
| PRS-09 | Feasibility smoke tests produce a committed pass/fail verdict per the 9-cell `--resume` matrix in `01-RESEARCH.md` | manual → automated | `bash scripts/capture-fixtures.sh feasibility` then the verdicts are parsed by `validate-fixtures.mjs feasibility` | ❌ W2 adds subcommand | ⬜ pending |
| PRS-09 | Fixture re-capture from scratch produces a byte-identical corpus (modulo timestamps and post-redaction normalized paths) | manual | `rm -rf spec/fixtures/*.ndjson spec/fixtures/*.expected.json && bash scripts/capture-fixtures.sh all && git diff --stat spec/fixtures/` should show only expected noise | manual-only |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Phase 1 starts with zero test and capture infrastructure. Wave 0 MUST create these files before any W1+ task runs. Every subsequent wave depends on one or more of them.

- [ ] `package.json` at repo root with `devDependencies` for `ajv`, `ajv-formats`, `json-schema-to-typescript@15.0.4`, and lockfile committed — ajv is the runtime validator used by `validate-fixtures.mjs`; json-schema-to-typescript is used by `validate-schema-ts.mjs`; `uvx` is used for `datamodel-code-generator` (no Python deps committed yet)
- [ ] `.gitattributes` at repo root with `spec/fixtures/** -text` — disables git's CRLF normalization for captured NDJSON (Pitfall 5: CRLF drift corrupts byte-exact fixtures)
- [ ] `scripts/validate-fixtures.mjs` — Node ESM script with subcommands `parse`, `schema`, `pairs`, `manifest`, `pin`, `feasibility`, `citations`. Default (no arg) runs `parse` + `schema` + `pairs` + `manifest`. Exits non-zero on any failure with a human-readable error per failing fixture.
- [ ] `scripts/validate-schema-ts.mjs` — Node script that invokes `json-schema-to-typescript@15.0.4` on `spec/events.schema.json`, writes to a temp `.d.ts`, runs `npx -y typescript@5 tsc --noEmit --strict --target es2022 --lib es2022 --module esnext --moduleResolution bundler` against the output, and exits non-zero on any TypeScript error
- [ ] `scripts/validate-schema-py.sh` + `scripts/validate-schema-py.cmd` — Shell wrapper that invokes `uvx --from datamodel-code-generator==0.30.2 datamodel-codegen --input spec/events.schema.json --input-file-type jsonschema --output <tempdir>/events.py --output-model-type pydantic_v2.BaseModel --target-python-version 3.10`, then runs `uvx --with pydantic python -c "import importlib.util; spec=importlib.util.spec_from_file_location('events', '<tempdir>/events.py'); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m); print('ok')"` and asserts `ok` in stdout
- [ ] `scripts/audit-fixtures.sh` + `scripts/audit-fixtures.cmd` — Invokes `trufflehog filesystem spec/fixtures/ --fail --no-update --only-verified=false` (or equivalent docker image on Windows), exits non-zero on any detected secret
- [ ] `scripts/capture-fixtures.mjs` — Capture engine (stubbed in W0 with a `--help` / `feasibility` subcommand that prints "not implemented"; body filled in W2 for feasibility smoke tests and W3 for full fixture capture). Node ESM + `child_process.spawn` for gemini-cli subprocess lifecycle.
- [ ] `scripts/capture-fixtures.sh` + `scripts/capture-fixtures.cmd` — Thin platform wrappers that forward to `node scripts/capture-fixtures.mjs "$@"` / `node scripts/capture-fixtures.mjs %*` respectively
- [ ] `spec/` directory tree with the following placeholder files created empty (so later tasks can append to them atomically):
  - `spec/protocol.md` (seed with `# Event Wire Protocol\n\n(Drafted in Phase 1 from captured fixtures.)\n`)
  - `spec/errors.md` (seed with `# Error Patterns\n\n(Drafted in Phase 1 from captured error fixtures.)\n`)
  - `spec/feasibility.md` (seed with frontmatter block containing `resume_verdict: pending`, `config_dir_verdict: pending`, `flush_verdict: pending`)
  - `spec/capture.md` (seed with `# Fixture Capture Procedure\n\n(Documented in Phase 1 W2/W3.)\n`)
  - `spec/events.schema.json` (seed with a minimal valid JSON Schema 2020-12 skeleton: `{"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"https://gemini-sdk.dev/spec/events.schema.json","title":"Gemini CLI stream-json event","oneOf":[]}`; the `oneOf` array is populated in W4)
  - `spec/fixtures/` (empty directory; `.gitkeep` file so it persists)
  - `spec/fixtures/_assets/` (empty directory; `.gitkeep` file so it persists — will hold the test image and PDF used by multimodal fixtures)
  - `spec/fixtures.manifest.json` (seed with the 11 required fixture slugs listed above, so `manifest` validation immediately fails loudly until W3 populates them)
- [ ] `.gemini-cli-compat` at repo root (seed empty; W1 writes the pinned version string after verifying `gemini --version` on the capture host)

---

## Manual-Only Verifications

Phase 1 has very few manual-only verifications — the heaviest lift is capture reproducibility, which is fundamentally manual because "does the same command produce the same fixture modulo expected noise" depends on a human reading a `git diff`.

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Fixture re-capture reproducibility | PRS-09 | `git diff` review cannot be fully automated — timestamps, request IDs, and CLI session IDs change between runs by design. A human judges whether the diff is "expected noise" vs. "upstream drift requiring investigation." | 1. `rm -rf spec/fixtures/*.ndjson spec/fixtures/*.expected.json`<br>2. `bash scripts/capture-fixtures.sh all` (or `.cmd` equivalent)<br>3. `git diff --stat spec/fixtures/` — should show every fixture as changed but of similar byte count (±10%)<br>4. `git diff spec/fixtures/simple-text.ndjson` — should show only timestamp/session-ID differences, NOT structural event changes<br>5. If structural changes appear, upstream gemini-cli has drifted — investigate before committing |
| Human review of every committed fixture for unredacted secrets | PRS-09 | Defense-in-depth against the trufflehog audit. TruffleHog uses pattern matching; novel key formats could slip through. | Before `git commit` on any fixture change, visually scan each committed `.ndjson` file for strings matching common secret shapes (`AIza...`, `sk-...`, bearer tokens, absolute host paths containing the capture user's home directory, Google Cloud project ID patterns). If anything looks suspicious, update the redactor in `scripts/capture-fixtures.mjs` and re-capture. |
| Feasibility verdict interpretation | PRS-09 | The three smoke test results are boolean but their *implications* for downstream phases require human judgment (e.g., "does the `--resume`+`-p` failure mode warrant blocking or fallback?"). The CONTEXT.md decisions cover the common cases; edge cases need a human. | After `scripts/capture-fixtures.sh feasibility` runs, read `spec/feasibility.md` and decide per-verdict whether the fallback path laid out in CONTEXT.md is sufficient or whether the phase needs to return `## ROADMAP BLOCKED`. |

---

## Validation Sign-Off

- [ ] All PLAN.md tasks have an `<automated>` verify command OR an explicit Wave 0 dependency on a script that provides one
- [ ] Sampling continuity: no 3 consecutive tasks without an automated verify command
- [ ] Wave 0 covers all MISSING references listed above (every checkbox in the Wave 0 Requirements section is satisfied before W1 begins)
- [ ] No watch-mode flags (all commands must be one-shot exits, never `--watch` / `--serve`)
- [ ] Feedback latency: quick run < 2s, full suite < 30s
- [ ] `nyquist_compliant: true` set in frontmatter once all tasks are mapped and sign-off criteria are met

**Approval:** pending
