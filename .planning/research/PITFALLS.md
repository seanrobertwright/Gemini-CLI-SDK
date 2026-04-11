# Pitfalls Research

**Domain:** Subprocess-wrapper SDK (TS + Python) over a fast-moving upstream CLI (`gemini-cli`)
**Researched:** 2026-04-11
**Confidence:** HIGH for gemini-cli-specific issues (linked to real issues); MEDIUM for general subprocess/SDK pitfalls (based on Claude Agent SDK, Codex SDK, and Python/Node subprocess literature).

This document is intentionally opinionated. "Be careful" is not a prevention strategy — every pitfall below ends with an actionable rule, a warning sign, and a phase to address it.

---

## Critical Pitfalls

### Pitfall 1: Treating `gemini-cli --output-format stream-json` as a stable, versioned wire protocol

**What goes wrong:**
Code assumes the stream-json schema (`init`, `message`, `tool_use`, `tool_result` events) is stable. Upstream renames a field, adds a new event type, or changes an event's shape in a minor release. The SDK's parser crashes on real user machines the day gemini-cli auto-updates.

**Why it happens:**
Stream-json is new (the feature was explicitly requested in [issue #8203](https://github.com/google-gemini/gemini-cli/issues/8203)). It is not documented as versioned, there is no JSON Schema published, and `gemini-cli` ships weekly. Non-JSON log lines have already been observed corrupting the stream in [issue #22647 (`--acp` / `--experimental-acp` plain-text log lines polluting the JSON-RPC stream)](https://github.com/google-gemini/gemini-cli/issues/22647). This is not hypothetical — it has already happened to a sibling integration.

**How to avoid:**
1. **Parse defensively.** Treat every event as `Record<string, unknown>` at ingress. Validate with Zod (TS) / Pydantic (Python) into a *tagged union* of known events, but **never throw** on unknown event types — log and yield a typed `UnknownEvent { raw: string, type?: string }` instead.
2. **Skip non-JSON lines gracefully.** The parser must `try { JSON.parse(line) } catch { yield { kind: "non-json-noise", raw: line } }`. Assume gemini-cli will leak log lines into stdout on at least one platform.
3. **Pin a known-good version in `engines` / install docs** and treat the tested range as a compat matrix cell, not a promise.
4. **Golden-file tests** capturing real `stream-json` output for every pinned version. When CI runs against a new `gemini-cli`, diff the event schema and fail loudly.

**Warning signs:**
- Unit tests only cover synthetic JSON, not recorded CLI output.
- Parser code uses `as EventType` casts rather than runtime validation.
- No fixture files in the test suite named after `gemini-cli` versions.

**Phase to address:** **Parsing** (foundational — ship the defensive parser before sessions or tools).

---

### Pitfall 2: Subprocess stdout buffering deadlocks and silent truncation

**What goes wrong:**
The SDK uses `child_process.exec` (Node) or `subprocess.run(..., capture_output=True)` (Python) and the process hangs or silently truncates long agent outputs. Symptom: short queries work, long agent runs with many tool calls freeze after ~200 KB or crash with `maxBuffer exceeded`.

**Why it happens:**
- Node `child_process.exec` buffers stdout and has a documented ~200 KB OS pipe capacity and a 1 MB default `maxBuffer` ([nodejs/node#4236](https://github.com/nodejs/node/issues/4236), [nodejs docs](https://nodejs.org/api/child_process.html)). When exceeded, the child is killed and output is **truncated silently**.
- Python `subprocess.run(capture_output=True)` buffers the entire output in memory.
- OS pipes have a finite kernel buffer (~64 KB on Linux, varies on Windows). A child writing faster than the parent reads will block indefinitely on `write()`.

**How to avoke:**
Never use `exec` / `run(capture_output=True)`. Use:
- **Node:** `child_process.spawn` with `{ stdio: ['pipe', 'pipe', 'pipe'] }`, consume `stdout` as a stream via `readline.createInterface` or a proper line splitter. Never buffer the whole thing into a string.
- **Python:** `asyncio.create_subprocess_exec` with `stdout=asyncio.subprocess.PIPE`. Read via `await proc.stdout.readline()` in a loop; do **not** call `proc.communicate()` for streaming cases.
- **Always drain stderr in parallel.** A full stderr pipe will block a child whose stdout is being read.

**Warning signs:**
- `exec`, `execFile`, or `.communicate()` anywhere in the hot path.
- A single `await proc.stdout.read()` call without a loop.
- No explicit stderr reader task.
- Tests only exercise prompts that produce < 10 KB of output.

**Phase to address:** **Foundation / Process layer** — this is the first thing the SDK builds and the hardest thing to retrofit.

---

### Pitfall 3: Partial-line NDJSON parsing across chunk boundaries

**What goes wrong:**
The parser reads a chunk from stdout, splits on `\n`, and parses each piece. When a JSON event straddles a chunk boundary, the trailing partial line is discarded or fed to `JSON.parse` and throws. Intermittent test failures. In production, random events go missing — including `tool_use` events, so the agent appears to execute tools silently.

**Why it happens:**
`stream.on('data')` in Node and `readuntil` in Python deliver **byte chunks**, not lines. A naive `chunk.split('\n').forEach(JSON.parse)` is wrong because the last element is almost always a partial line.

**How to avoid:**
1. Use a proper line splitter: Node's `readline.createInterface({ input: proc.stdout, crlfDelay: Infinity })` or Python's `async for line in proc.stdout` (which returns complete lines including the `\n`).
2. If rolling your own: maintain a string buffer, split on `\n`, yield all-but-the-last piece, keep the last as the new buffer. At EOF, flush the buffer if non-empty.
3. **Encoding:** force UTF-8 decode with a stateful decoder (`new TextDecoder('utf-8', { fatal: false })` in Node, `codecs.getincrementaldecoder('utf-8')` in Python). Multibyte characters can straddle chunks too.
4. **CRLF tolerance:** trim trailing `\r` before parse (Windows gemini-cli output may be CRLF).

**Warning signs:**
- Code calls `.split('\n')` on raw chunks.
- No test with injected split points mid-JSON-object.
- Intermittent "unexpected end of JSON input" errors in logs.

**Phase to address:** **Parsing** (same phase as Pitfall 1).

---

### Pitfall 4: Orphaned / zombie subprocesses on parent crash or timeout

**What goes wrong:**
SDK is embedded in Archon. Archon worker crashes, times out, or is killed. The `gemini-cli` subprocess (which spawned *its own* children for MCP servers — see [issue #13604: npx stdio transport hang](https://github.com/google-gemini/gemini-cli/issues/13604)) is left running, holding OAuth tokens, chewing CPU, and filing 429s against the user's quota. Over a day this accumulates into dozens of dead geminis.

**Why it happens:**
- `child.kill()` and `process.terminate()` signal **only the direct child**. gemini-cli itself spawns MCP servers via stdio; those grandchildren become orphans.
- On Windows, `SIGTERM` doesn't exist in the Unix sense; Node's `kill()` on Windows is effectively `TerminateProcess` on the immediate child.
- `asyncio.subprocess.Process.terminate()` starts termination but doesn't wait — you must `await proc.wait()` with a timeout, then escalate.
- asyncio child watcher quirks: without an explicit watcher configured, `wait()` can hang forever with `returncode = None`.

**How to avoid:**
1. **POSIX:** spawn with `detached: true` (Node) / `start_new_session=True` (Python) to create a new process group, then `process.kill(-pid, 'SIGTERM')` / `os.killpg(pgid, SIGTERM)` to signal the entire group.
2. **Windows:** use Node's `taskkill /pid X /T /F` fallback (the `/T` tree-kill flag) or Python's `subprocess.Popen` + `CREATE_NEW_PROCESS_GROUP` + `taskkill`. Document this explicitly; it is not portable with the same code path.
3. **Escalation ladder:** SIGTERM → wait 5s → SIGKILL / `/F`. Always await the final exit.
4. **Finalizer safety:** register `process.on('exit')` (Node) and `atexit` + signal handlers (Python) to kill child on parent death. Use `try/finally` around every `query()` call.
5. **Integration test:** spawn, kill parent, verify no `gemini` or `node` processes remain after 10s.

**Warning signs:**
- Only `proc.kill()` with no group handling.
- No Windows-specific termination path.
- Test suite never kills the parent mid-stream.
- `ps aux | grep gemini` after a failed test run shows orphans.

**Phase to address:** **Foundation / Process layer**, with a Windows-specific follow-up task.

---

### Pitfall 5: Silent subprocess death — missing exit code propagation

**What goes wrong:**
gemini-cli crashes, gets OOM-killed, or exits with a non-zero code mid-stream. The SDK's stream reader sees EOF, returns cleanly, and the caller thinks the query succeeded with zero tokens. Callers build on wrong results.

**Why it happens:**
Stream parsers naturally focus on `'data'` events and forget the `'exit'` / `'close'` events. In Python, `async for line in proc.stdout` terminates silently on EOF regardless of exit code.

**How to avoid:**
1. After stream iteration completes, **always** `await proc.wait()` (or equivalent) and inspect the exit code.
2. Non-zero exit codes must raise a typed `ProcessError { exitCode, stderr, partialEvents }` — include the collected stderr buffer and any parsed events so the caller can diagnose.
3. Stream consumers must treat "stream ended without a terminal event" (no `result` / `end` event) as an error even if exit code is 0. Upstream has landed bugs where the process exits successfully mid-generation.
4. For Archon's retry classifier: map exit-code patterns to `rate_limit` / `auth` / `crash` (Archon uses these five buckets, per its own retry code). See Pitfall 16.

**Warning signs:**
- No reference to `exitCode` or `returncode` in the streaming query code path.
- `ProcessError` doesn't carry stderr.
- Tests simulate only successful completion.

**Phase to address:** **Foundation / Process layer**.

---

### Pitfall 6: Shell injection via `shell: true` or string-concatenated commands

**What goes wrong:**
To "handle quoting," a dev uses `spawn(cmd, { shell: true })` or `subprocess.run(..., shell=True)` and builds the command as a string with a user-supplied prompt interpolated in. A prompt like `"; rm -rf ~; echo "` executes on the host. Or on Windows, a prompt with `^`, `&`, `|`, or nested quotes breaks the shell and exposes shell metacharacter handling bugs.

**Why it happens:**
- `shell: true` / `shell=True` is documented as a security risk but is convenient.
- Windows shell escaping is famously unsolvable. cmd.exe, PowerShell, and MSYS all have different rules; batch files are launched through a shell even when `shell=False`. See [Phabricator T13209 "How To Properly Escape Commands on Windows (A Dark Tragedy)"](https://secure.phabricator.com/T13209).
- gemini-cli itself has an [unescaped-nested-quotes bug in `run_shell_command` on Windows (issue #18112)](https://github.com/google-gemini/gemini-cli/issues/18112) — a reminder that even the upstream got this wrong.

**How to avoid:**
1. **Never `shell: true`.** Always pass an array of args to `spawn` / `create_subprocess_exec`. Node and Python handle quoting internally when given arrays.
2. User-controlled data (prompts, paths) goes via CLI **arguments**, never interpolated into a shell string.
3. For very long prompts, prefer `stdin` over `--prompt "..."` to avoid command-line length limits (Windows caps at 8191 chars) and eliminate any possibility of argument escaping issues.
4. Linter rule: CI greps for `shell: true` and `shell=True` and fails.
5. If a user sets `GEMINI_BIN_PATH` to a path with spaces (common on Windows: `C:\Program Files\...`), the array-args approach handles it correctly; a shell-string approach won't.

**Warning signs:**
- `shell: true` anywhere in code.
- Test inputs never include shell metacharacters (`;`, `|`, `&`, `` ` ``, `$`, `"`, `'`).
- Path handling code uses string concat rather than array args.

**Phase to address:** **Foundation / Process layer** + **lint/security gate in CI**.

---

### Pitfall 7: Windows encoding corruption (mojibake and ERR_ENCODING_NOT_SUPPORTED)

**What goes wrong:**
Non-ASCII output from gemini-cli on Windows comes back as garbage (mojibake), or the SDK crashes with `ERR_ENCODING_NOT_SUPPORTED`. Users on Windows JP / KR / ZH / DE locales cannot use the SDK.

**Why it happens:**
This is not hypothetical — it's currently broken upstream in multiple forms:
- [Issue #4945: "CLI Crashes on Windows with ERR_ENCODING_NOT_SUPPORTED When Running Shell Commands"](https://github.com/google-gemini/gemini-cli/issues/4945) — gemini-cli uses a `TextDecoder` that doesn't support legacy OEM codepages (cp437, cp850, CP936).
- [Issue #20186: Korean garbled text in PowerShell](https://github.com/google-gemini/gemini-cli/issues/20186)
- [Issue #15389: Japanese garbled output](https://github.com/google-gemini/gemini-cli/issues/15389)
- [Issue #12468: Japanese bug report (still open)](https://github.com/google-gemini/gemini-cli/issues/12468)
- [Issue #20661: Chinese GBK/CP936 confusion](https://github.com/google-gemini/gemini-cli/issues/20661)
- [Issue #3015: Windows shell command failures](https://github.com/google-gemini/gemini-cli/issues/3015)

The root cause is that gemini-cli assumes UTF-8 but inherits the console's active codepage.

**How to avoid:**
1. **Force UTF-8 at subprocess spawn.** On Windows, set `env.PYTHONIOENCODING = 'utf-8'`, `env.LANG = 'en_US.UTF-8'`, and **critically** prepend a `chcp 65001` hint via `env.GEMINI_CODEPAGE = '65001'` if/when gemini-cli adopts it. Until then, set the console codepage via `kernel32.SetConsoleOutputCP(65001)` through ffi, or spawn through `cmd /c chcp 65001 >nul && gemini ...` (but see Pitfall 6 — this re-introduces shell=true; prefer the env approach).
2. **Decode output with `utf-8` + `errors='replace'` (Python) / `TextDecoder('utf-8', { fatal: false })` (Node).** Never let a decode exception bubble up.
3. **CI matrix includes Windows with a non-en-US locale** (JP or DE runner). Test prompts that include non-ASCII characters and file paths with spaces.
4. **Document** the Windows encoding gotcha in README with a "if you see mojibake, try these env vars" section.
5. **Flag affected gemini-cli versions** in the compat matrix. When upstream fixes #4945, bump the supported minimum.

**Warning signs:**
- No Windows runner in CI.
- No non-ASCII test fixtures.
- Decode calls use default encoding.
- Zero references to `codepage` / `65001` / `PYTHONIOENCODING` in codebase.

**Phase to address:** **Foundation / Process layer** (set env at spawn) + **CI matrix** (Windows locale job).

---

### Pitfall 8: OAuth / auth mode confusion and 403 blast radius

**What goes wrong:**
SDK defaults to OAuth because it's what developers use interactively. In production (Archon), OAuth breaks catastrophically for entire classes of users — and has done so repeatedly in the last six months.

**Real incidents (cite these in docs so users know they're not crazy):**
- [Issue #16435: 403 FORBIDDEN with personal Google account](https://github.com/google-gemini/gemini-cli/issues/16435)
- [Issue #24517: 403 PERMISSION_DENIED for Google One AI Premium subscribers](https://github.com/google-gemini/gemini-cli/issues/24517)
- [Issue #24962: 403 on new Google AI Ultra plan](https://github.com/google-gemini/gemini-cli/issues/24962)
- [Issue #14934: 403 for personal free-tier accounts](https://github.com/google-gemini/gemini-cli/issues/14934)
- [Issue #10110: 403 for Google AI Pro "Login with Google"](https://github.com/google-gemini/gemini-cli/issues/10110)
- [Issue #22241: indefinite hang on Google One AI Ultra subscriptions](https://github.com/google-gemini/gemini-cli/issues/22241)
- [Discussion #22970: "Service update: mitigating abuse and prioritizing traffic" (March 25 2026 routing change that broke many paid users)](https://github.com/google-gemini/gemini-cli/discussions/22970)
- Google's own [FAQ warns](https://geminicli.com/docs/resources/faq/) that using third-party software to piggyback on Gemini CLI's OAuth violates ToS and may result in account suspension. **This directly implicates an SDK that wraps the CLI.** Read carefully and document the recommended path.

**Why it happens:**
gemini-cli has three auth modes (OAuth, Gemini API key, Vertex AI) with wildly different reliability, rate-limit profiles, quota-attribution rules, and ToS implications. OAuth is the least stable — Google has been actively rebalancing routing for it.

**How to avoid:**
1. **API key is the canonical SDK default.** Document this explicitly. OAuth is supported but labeled "interactive / personal use only." Vertex AI is the production-grade path.
2. **Detect auth mode at startup** and log it. Add a `sdk.auth.mode` field to error payloads so users can diagnose.
3. **Typed `AuthError`** must distinguish: `AuthError.NotConfigured`, `AuthError.Forbidden403` (quota/routing issue), `AuthError.Expired`, `AuthError.ToSViolation` (when Google blocks third-party CLI piggybacking).
4. **Rate-limit-aware error mapping:** 60 req/min OAuth vs ~1K/day free API key is a 40×+ throughput cliff. Mis-classification as `rate_limit` vs `model_access` matters for Archon's retry logic.
5. **Env var precedence:** document `GEMINI_API_KEY` > `GOOGLE_APPLICATION_CREDENTIALS` (Vertex) > OAuth fallback, and warn if multiple are set.
6. **Never automate OAuth login.** Require the user to run `gemini /login` themselves. Automating login is precisely what Google's FAQ forbids.

**Warning signs:**
- SDK defaults to OAuth.
- No `AuthError` subtypes.
- Docs don't mention the three auth modes.
- No logged "using auth mode: X" line.

**Phase to address:** **Adapter / Auth layer** (separate phase from raw process plumbing).

---

### Pitfall 9: Rate-limit error mis-classification breaks Archon retry loops

**What goes wrong:**
Archon's workflow executor classifies errors into five buckets — `rate_limit`, `auth`, `model_access`, `crash`, `unknown` — and retries up to 3× with exponential backoff (2000 ms × 2^attempt), per Archon's own code. The SDK returns a generic `Error("429")` on rate limits. Archon classifies it as `unknown`, gives up, and the entire workflow fails even though a 30s wait would have succeeded. Conversely, transient `crash` errors get retried against quota and burn through the OAuth 60/min cap.

**Why it happens:**
- Generic error messages lose structure.
- Stream-json errors can arrive as JSON payloads *or* as process exits with stderr, depending on whether the failure was during request or during streaming. Both paths must produce the same typed error.
- Upstream has [issue #22631: "keeps thinking because of Too Many Requests"](https://github.com/google-gemini/gemini-cli/issues/22631) — rate limits don't always surface as clean 429s.

**How to avoid:**
1. **Define a typed error hierarchy** that maps to Archon's buckets *exactly*:
   - `GeminiError` (base)
   - `RateLimitError extends GeminiError` → Archon `rate_limit`
   - `AuthError extends GeminiError` → Archon `auth`
   - `ModelAccessError extends GeminiError` (403 for this model, not quota) → Archon `model_access`
   - `ProcessError extends GeminiError` (subprocess crashed) → Archon `crash`
   - `InvalidPromptError extends GeminiError` (400) → Archon `unknown` (non-retryable)
2. **Include a `.retryable: boolean` and `.retryAfterMs?: number`** on every error, so Archon doesn't have to reverse-engineer it from the class.
3. **Parse 429 Retry-After** from stderr/JSON errors where available.
4. **Contract test against Archon's adapter:** a fixture suite that produces each error and verifies the Archon adapter classifies it correctly.

**Warning signs:**
- Only one `GeminiError` class.
- No `retryable` boolean on errors.
- Error messages are plain strings derived from stderr.

**Phase to address:** **Error taxonomy** phase (can be parallel with Parsing, must complete before Adapter).

---

### Pitfall 10: Model availability drift and silent fallback to Flash

**What goes wrong:**
User requests `gemini-2.5-pro`, the SDK passes it through, and gemini-cli silently downgrades to `gemini-2.5-flash` without telling the caller. Test suite passes. Production behavior quality degrades invisibly.

**Why it happens:**
This is a current, live bug — multiple open issues:
- [Issue #3485: "Model keeps changing from gemini-2.5-pro to gemini-2.5-flash"](https://github.com/google-gemini/gemini-cli/issues/3485)
- [Issue #3425: "Default model switches from pro to flash automatically mid-session"](https://github.com/google-gemini/gemini-cli/issues/3425)
- [Issue #2470: "Switches to flash model without reason"](https://github.com/google-gemini/gemini-cli/issues/2470)
- [Issue #8269: "CLI automatically switching from 2.5-pro to flash"](https://github.com/google-gemini/gemini-cli/issues/8269)
- [Issue #11650: "Gemini CLI immediately falls back to Flash on startup, making gemini-2.5-pro unusable for oauth-personal users"](https://github.com/google-gemini/gemini-cli/issues/11650)

Plus: gemini-2.5-flash and gemini-2.5-pro are scheduled for **deprecation on June 17, 2026** (two months from today). Gemini 3 is default as of gemini-cli 0.29.0 (Feb 2026). Hardcoded model strings will break.

**How to avoid:**
1. **Inspect the `init` event** in stream-json and verify the actual model matches the requested model. If they differ, surface a `ModelDowngradeWarning` in the result (not an error — Archon may want to accept the downgrade).
2. **Typed model enum with string escape hatch:** `GeminiModel.GEMINI_3_PRO | GEMINI_3_FLASH | GEMINI_2_5_PRO | GEMINI_2_5_FLASH | (string & {})`. Mark 2.5-series as `@deprecated` in JSDoc/docstrings with the June 17 2026 date.
3. **Default model is `latest` or an alias**, not a pinned version. Let gemini-cli pick. Expose override for callers who need reproducibility.
4. **Compat-matrix cell: "model X on gemini-cli Y → actually-used model."** Refresh weekly.

**Warning signs:**
- Model passed through as a string with no verification.
- No check of `init` event contents.
- Hardcoded `gemini-2.5-pro` anywhere.

**Phase to address:** **Parsing** (for init inspection) + **Model selection** sub-phase.

---

### Pitfall 11: Session / checkpoint APIs that can't survive a subprocess restart

**What goes wrong:**
SDK exposes `session.continue(prompt)` that holds a long-lived `gemini-cli` subprocess. Process crashes mid-conversation (OOM, upstream bug, OS restart). All state is lost. User re-runs; SDK cannot resume because it wasn't designed around durable session state.

**Why it happens:**
The obvious design — keep a pipe open and feed prompts through stdin — bakes in process lifetime as conversation lifetime. Claude Agent SDK hit exactly this: [zed-industries/claude-agent-acp#338 "Claude CLI subprocess death leaves session permanently..."](https://github.com/zed-industries/claude-agent-acp/issues/338). The fix is that sessions must be **identifier-based**, and a fresh subprocess can `resume: sessionId` from on-disk state.

**How to avoid:**
1. **Session = identifier, not a process.** Store session state (gemini-cli checkpoint file or conversation JSONL) keyed by a session ID the SDK generates.
2. **Each `query()` call spawns a fresh subprocess** in v1. Persistent pipes are a v2 optimization (token cost), not a correctness guarantee.
3. **Expose `resumeSession(id)`** as the primary multi-turn API. Don't expose `continue()` on an object holding a pipe handle.
4. **If v1 uses persistent pipes** for token efficiency, wrap them in a supervisor that detects process death, respawns with `--resume <id>`, and transparently replays — but test this explicitly with a kill-mid-stream case.
5. **Session store abstraction:** filesystem (default, mirrors Claude's `~/.claude/projects/...`) with a pluggable interface so Archon can persist elsewhere.

**Warning signs:**
- Session API exposes a process handle.
- No session ID visible to the caller.
- Test suite never kills a subprocess mid-session.

**Phase to address:** **Sessions** phase, but API design decision must be made before coding begins.

---

### Pitfall 12: Tool-use round-trip broken — custom tools don't actually work

**What goes wrong:**
SDK advertises "custom tools" but gemini-cli's non-interactive mode doesn't support caller-defined tools. v1 ships and immediately takes GitHub issues from users whose tools "don't fire."

**Why it happens:**
gemini-cli exposes tools via:
- Built-ins (shell, file ops, web fetch, Google Search) — always on.
- MCP servers — configured via `settings.json`, not per-call API.
- No inline "here is my tool schema for this one query" flag.

And MCP integration is currently fragile:
- [Issue #2654: TypeError when registering MCP server with multi-type JSON schema](https://github.com/google-gemini/gemini-cli/issues/2654) — `toUpperCase()` called on an array type field.
- [Issue #3406: MCP servers not detected despite valid config on macOS](https://github.com/google-gemini/gemini-cli/issues/3406).
- [Issue #20694: `gemini mcp enable` throws "Server not found" due to config parsing bug](https://github.com/google-gemini/gemini-cli/issues/20694).
- [Issue #17787: Gemini CLI ignores MCP timeout configuration](https://github.com/google-gemini/gemini-cli/issues/17787).
- [Issue #23296 / #23776: MCP HTTP OAuth token refresh works via `mcp list` but fails during actual tool calls](https://github.com/google-gemini/gemini-cli/issues/23296).
- [Issue #13604: CLI hangs indefinitely when spawning npx subprocess for MCP stdio transport](https://github.com/google-gemini/gemini-cli/issues/13604).

**How to avoid:**
1. **v1 ships with built-ins passthrough only.** Custom tools deferred to v1.1 or v2, clearly labeled.
2. **If custom tools are in v1:** the only correct mechanism is a stub MCP server the SDK spins up as a sidecar. Budget for every issue above to bite you. Pin a gemini-cli version known to work.
3. **Avoid multi-type JSON schema** (`"type": ["string", "number"]`) in any tool definition the SDK generates — a known crash per #2654.
4. **Round-trip test:** SDK sends a prompt, gemini-cli requests a tool, SDK executes it, result goes back, gemini-cli uses it in the final response. Golden-file the entire event stream.
5. **Document which built-in tools are available and how to disable them** (the shell tool is a security footgun — see Pitfall 14).

**Warning signs:**
- Tool API promises inline custom tools but code has no MCP sidecar.
- No round-trip test through a real tool execution.
- Examples use fabricated event shapes, not recorded output.

**Phase to address:** **Tools** phase (defer until built-ins passthrough is solid).

---

### Pitfall 13: Compat-matrix gap — testing only against "latest" or only against pinned

**What goes wrong:**
**Option A:** CI tests only `gemini-cli@latest`. Upstream breaks on Friday, Monday users pull via npm, everything's broken, can't bisect because the test grid doesn't cover the previous working version.
**Option B:** CI tests only the pinned version. User installed a newer `gemini-cli` because they use it interactively too. SDK crashes with no test coverage of that version.

**Why it happens:**
Fast-moving upstream + semver mismatch. The SDK's semver version says nothing about which gemini-cli versions it supports. `npm` [issue #9179 "semver for package that wraps semver-compliant executable"](https://github.com/npm/cli/issues/9179) articulates this exact problem — and has no widely-adopted solution.

**How to avoid:**
1. **Publish a compat matrix in the README and docs site.** Rows = SDK versions, columns = gemini-cli versions, cells = `✅ tested` / `⚠️ known-issue-N` / `❌ unsupported`.
2. **CI matrix job:** every PR runs against N = 3 gemini-cli versions: oldest-supported, latest-tested, and `@latest`. Latest-tested and `@latest` failures are separate CI jobs so a flaky `@latest` doesn't block PRs but does file issues.
3. **Runtime version check:** on first `query()`, the SDK runs `gemini --version`, parses it, and warns (not errors) if it's outside the tested range. Config flag `GEMINI_SDK_SKIP_VERSION_CHECK=1` to silence.
4. **Error messages reference the compat matrix URL** when a known-issue version is detected.
5. **Pre-release channel for breakage:** publish `@next` alongside `@latest`, with `@next` tracking newer gemini-cli.
6. **Deprecation pathway:** when dropping support for a gemini-cli version, publish a minor SDK release with a runtime warning first, then a major release that errors. Mirror Python/Node support matrix conventions.

**Warning signs:**
- Only one gemini-cli version in CI.
- No `gemini --version` check at runtime.
- README doesn't mention a supported version range.

**Phase to address:** **CI / Release engineering** (starts with project setup, continuously maintained).

---

### Pitfall 14: Tool-execution security — passthrough exposes shell to Archon workflows

**What goes wrong:**
gemini-cli's built-in `run_shell_command` has full shell access. SDK passes tools through transparently. An Archon workflow runs user-supplied prompts. A prompt-injection causes gemini to run `rm -rf /` or exfiltrate env vars. Not a gemini-cli bug — the SDK's security model failure.

**Why it happens:**
The default posture of "expose everything the CLI exposes" is incompatible with running as a backend in a multi-tenant-ish harness like Archon. Built-in tools include file write, shell exec, and web fetch.

**How to avoid:**
1. **Opt-in tool allowlist** on `query()`. Default v1 allowlist: `read_file`, `list_directory`, `search`. Shell, file write, and web fetch require explicit opt-in via `{ tools: { shell: true } }`.
2. **Pass tool restrictions through to gemini-cli** via whatever flags / settings.json it exposes (research: confirm the exact mechanism). If gemini-cli doesn't honor restrictions in headless mode, document the limitation and use a confirmation-callback pattern.
3. **Confirmation callback pattern:** `query({ onToolCall: async (tool) => allowed })` — SDK intercepts `tool_use` events, pauses the stream, asks the caller, and only proceeds on approval. (Requires bidirectional stdio or session resume.)
4. **Sandbox recommendation in docs:** document running gemini-cli inside a container / restricted workspace for untrusted prompts.
5. **`workspace` / `cwd` option:** callers specify a working directory; default to a temp directory, not `process.cwd()`.

**Warning signs:**
- No `tools` option on query.
- No `cwd` / `workspace` handling.
- Docs don't mention prompt injection.

**Phase to address:** **Tools / Security** phase — must land before 1.0.

---

### Pitfall 15: TS / Python parity drift — behaviors diverge in subtle ways

**What goes wrong:**
TS and Python SDKs start identical. Over time a bug fix lands in TS but not Python. An option is renamed in Python but not TS. Tests in each language drift. A year later, the two SDKs behave differently enough that the same prompt produces different results — and Archon users silently get worse Gemini behavior depending on which Archon branch they use.

**Why it happens:**
- Two languages = two maintainers' attention split.
- Docs are copy-pasted, then diverge.
- Test suites are written in idiomatic-for-each-language style and cover different cases.

**How to avoid:**
1. **Shared test corpus.** A language-agnostic test definition (YAML or JSON) describing inputs, expected events, expected errors. Both runtimes load it and assert against the same contract. Fraction's parity-benchmark harness is a real-world example ([Geektrovert/fraction#1](https://github.com/Geektrovert/fraction/pull/1)).
2. **Shared fixtures.** Recorded `stream-json` outputs live in a `fixtures/` directory at repo root; both languages read from there.
3. **Parity CI job.** Runs both SDKs against the corpus and diffs outputs. Blocks merge if they diverge.
4. **Single source of truth for errors.** Publish the error taxonomy as a YAML doc; generate TS enums and Python enums from it.
5. **Release-sync policy:** one version number for both SDKs. No TS 1.2.3 without Python 1.2.3. Monorepo + shared CHANGELOG.
6. **Docs are generated from shared schema** (OpenAPI-style) rather than hand-written twice. Letta's approach (single OpenAPI → Fern generates both SDKs) is a known-good pattern when feasible.

**Warning signs:**
- Separate CHANGELOGs.
- TS has tests Python doesn't (or vice versa).
- Error names differ subtly between languages.
- Docs diverge on behavior description.

**Phase to address:** **Foundation** (set the parity harness before feature work) + **every feature phase** thereafter.

---

### Pitfall 16: Archon adapter breakage from upstream Archon changes

**What goes wrong:**
Archon changes its adapter interface (renames a method, adds a required field, changes error shapes). The Gemini adapter in Archon stops compiling. Users on `DEFAULT_AI_ASSISTANT=gemini` cannot upgrade Archon. Worst case: the adapter silently runs with stale contract and Archon's retry classifier mis-reads our errors.

**Why it happens:**
The Gemini SDK lives in its own repo; the Archon adapter lives in `coleam00/Archon/packages/adapters/gemini/`. Changes to Archon's adapter interface happen in Archon's repo, not ours. Archon is itself rapidly developing — issue [#965 "Pi as third AI assistant provider"](https://github.com/coleam00/Archon/issues/965) shows they're actively refactoring the adapter surface for a third provider.

**How to avoid:**
1. **Adapter is a thin shim, not a feature layer.** Every behavior should live in the SDK; the adapter only translates SDK types ↔ Archon types. Target ~200 LOC, no business logic.
2. **Contract tests in the Archon repo.** The adapter's PR in Archon includes tests that exercise Archon's retry classifier against recorded SDK error payloads. CI on Archon's side catches breakage when Archon changes its interface.
3. **Pin Archon's adapter API version** in the adapter's package manifest. Bump explicitly after verifying compatibility.
4. **Subscribe to Archon releases.** Automated dependabot-style PR that runs the contract tests against new Archon versions and files an issue on failure.
5. **Env-var namespace discipline:** `GEMINI_*` and `GEMINI_SDK_*` only. Never overload `GOOGLE_*` (Vertex uses these) or generic `API_KEY`.
6. **Match Archon's existing env-var shape** from its `.env.example`: `DEFAULT_AI_ASSISTANT=gemini`, `GEMINI_API_KEY`, `GEMINI_BIN_PATH`. Don't invent new naming.

**Warning signs:**
- Adapter has >500 LOC of logic.
- Adapter duplicates SDK error handling.
- No CI link between Archon's repo and the SDK's repo.
- Archon upgrade broke the adapter silently without a test flag.

**Phase to address:** **Adapter** phase (final phase before 1.0).

---

### Pitfall 17: Hooks / structured output / system prompt APIs that silently degrade

**What goes wrong:**
SDK exposes `hooks: { onToolCall, onMessage }` and `systemPrompt: "..."` and `responseFormat: z.object({...})`. These are not natively supported by gemini-cli's non-interactive mode (per `PROJECT.md` open questions). The SDK fakes them with prompt-prepending or output-parsing tricks. The tricks are fragile: a user sets a system prompt, a subsequent multi-turn message loses it; a user specifies a JSON schema, the model returns markdown-wrapped JSON (see [litellm#12496: "Gemini CLI JSON parse error unexpected character \`"](https://github.com/BerriAI/litellm/issues/12496) — exactly this class of bug).

**Why it happens:**
Leaky abstraction: SDK promises a feature the underlying CLI doesn't support.

**How to avoid:**
1. **Feasibility-audit every requirement from PROJECT.md's "Active" list** *before* writing API types. For each: does a clean flag exist? If not, document the workaround and its failure modes.
2. **Mark workaround-backed features as `@experimental`** in the public API until upstream support lands.
3. **Structured output:** strip markdown code fences before JSON parsing (upstream routinely wraps JSON in `` ``` ``). Validate with Zod/Pydantic and retry with explicit "raw JSON only" reminder once on failure.
4. **System prompt:** prefer a transient `GEMINI.md` in a per-session temp directory (CLI reads it automatically) over prompt-prepending (which gets dropped on multi-turn).
5. **Hooks:** if the event stream contains the hook-able events, hooks work. If not (e.g., there's no `pre-tool-call` event), don't fake it. Document what works and what doesn't.
6. **No silent degradation.** If a user passes `responseFormat` and the model returned free-form text, raise an `InvalidPromptError` with a clear message. Don't return `undefined` and hope they notice.

**Warning signs:**
- API surface exists with no underlying CLI support documented.
- Examples use hooks that don't correspond to real events.
- `responseFormat` code path has no retry/repair logic.
- No `@experimental` markers.

**Phase to address:** **Feasibility audit** (research phase outcome, *before* SDK-design phase).

---

### Pitfall 18: Process-pool / concurrency model chosen before measuring

**What goes wrong:**
SDK picks "spawn-per-call" for simplicity. At 10 qps (Archon doing a batch of PR reviews in parallel), startup overhead dominates latency (gemini-cli takes ~2s to cold-start). Switching to a pool later is a breaking API change.

Or: SDK picks "long-lived piped process" for efficiency. The pipe wedges under load, orphaned processes accumulate (Pitfall 4), and a single process crash takes down all in-flight queries.

**Why it happens:**
Concurrency model is marked deferred in PROJECT.md open questions. It's easy to punt and then lock in by accident.

**How to avoid:**
1. **Design the API so concurrency is an implementation detail.** `query()` returns an async iterator; whether it's backed by spawn-per-call or a pool should not change the signature.
2. **v1 ships spawn-per-call.** Simplest, safest, most debuggable (matches Claude Agent SDK's default, per architecture writeup).
3. **Pool is additive, opt-in:** `new GeminiClient({ pool: { min: 1, max: 4 } })`. Same `query()` API.
4. **Benchmark before choosing.** Measure gemini-cli cold-start on Windows/Mac/Linux; if it's < 500ms, spawn-per-call is fine for Archon's load profile.
5. **Backpressure:** slow consumers must backpressure through the async iterator. Do not buffer the entire event stream in memory. If the caller awaits slowly, pause reading from stdout (Node: `proc.stdout.pause()`; Python asyncio: the queue naturally backpressures).

**Warning signs:**
- `query()` returns an array of all events (buffered).
- No mention of cold-start cost in perf docs.
- Pool implementation leaks into the public API.

**Phase to address:** **Foundation / API design**.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Use `child_process.exec` with a big `maxBuffer` | "It works, who cares about streams" | Silent truncation, 200 KB deadlocks, no streaming → useless for agents | Never for this SDK |
| `shell: true` / `shell=True` to "handle quoting" | 2 fewer lines of code | Command injection CVE, Windows escaping hell | Never |
| String-concat user prompt into `--prompt "..."` arg | Easy | CLI length limits (8191 chars Windows), metachar bugs | Never — always use stdin or arrays |
| Single `GeminiError` class with a string message | Fast to write | Archon retry classifier can't discriminate → workflows fail | Never for v1 — error taxonomy is core |
| Hand-maintained TS + Python codebases with docs-copy-paste | No shared-tooling setup cost | Parity drift (Pitfall 15), impossible to maintain at v1.5 | MVP prototype (< 2 weeks); never for shipping code |
| Pin exactly one gemini-cli version, refuse others | Deterministic | Users can't upgrade CLI independently; SDK becomes friction | Only in integration tests; never at runtime |
| Test only `gemini-cli@latest` | Always current | Can't bisect breakages, no historical compat data | Never as the only job |
| Persistent piped subprocess for all queries | Token savings | Orphan processes, crash cascades, session state loss | v1.1 opt-in optimization after base case is solid |
| Custom tools via output-parsing tricks (regex for "tool call: X") | Ships "custom tools" in v1 | Broken on every model update, non-deterministic | Never — use MCP sidecar or defer |
| Swallow unknown stream-json event types | Parser doesn't crash | Missing `tool_use` events = silent wrong behavior | Never silently — always emit as `UnknownEvent` |
| Default to OAuth auth | Easy local dev | Broken for paid users, 403 storms, ToS risk | Dev default only; production default must be API key |
| Hardcode `gemini-2.5-pro` as default | Matches today's best model | Deprecated June 17 2026 | Never — alias to "latest" |

---

## Integration Gotchas

Common mistakes when connecting to external services.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `gemini-cli` auth | Default to OAuth because "that's what devs use" | Default to API key; OAuth is opt-in, documented as unstable for production |
| `gemini-cli` stream-json | Treat schema as stable | Validate at ingress, yield `UnknownEvent` on surprise, pin & golden-file per version |
| `gemini-cli` MCP servers | Configure in `settings.json` and hope | Spin per-query or pin a known-good `settings.json`; assume MCP bugs (#3406, #17787, #23296, #13604) are active |
| Archon adapter | Thick adapter with business logic | 200-LOC shim, contract tests on Archon side |
| Archon env vars | Invent `GEMINI_SDK_API_KEY` | Use `GEMINI_API_KEY` and `GEMINI_BIN_PATH` — match Archon's existing Codex pattern |
| Vertex AI auth | Rely on ADC discovery magic | Require explicit `GOOGLE_APPLICATION_CREDENTIALS`, log which path was chosen |
| Model selection | Pass-through string, trust the result | Verify `init` event, raise `ModelDowngradeWarning` if upstream silently switched |
| Windows `GEMINI_BIN_PATH` | String concat the path | Array-args-only, never shell-interp a path with spaces |
| User-supplied cwd | Default to `process.cwd()` | Default to an explicit temp workspace; require callers to opt in to real cwd |
| MCP tool schema | Use `"type": ["string", "number"]` | Never — crashes gemini-cli (#2654); emit single types and document |

---

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Buffered output via `exec` | Freezes on long agent runs, `maxBuffer exceeded` | `spawn` + line-stream from day one | > 200 KB output (≈ 30 tool calls) |
| No stderr reader | Random freezes when gemini-cli logs to stderr | Parallel drain task from day one | Any run with non-trivial gemini logging |
| Spawning per call without benchmarking | 2+ second cold-start dominates wall time | Benchmark; pool if > 500 ms | ~5 queries/sec (Archon batch workflows) |
| Missing backpressure | Memory balloons on slow consumers | Async iterator with paused stdout | Long runs with a slow LLM downstream or a slow user |
| No orphan reaping | `ps` shows dozens of stale `gemini` | Process-group kill + atexit hook | Any crash loop; within 1 day in Archon |
| Wide event-stream buffering "just for replay" | Memory grows with run length | Bounded ring-buffer or disk spill | 10k+ event runs |
| Ignoring OAuth 60 req/min cap | Hits quota at ~1 qps sustained | Rate-limit-aware retry + document API-key path | 5+ concurrent Archon workers |

---

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| `shell: true` in subprocess spawn | Remote command execution via prompt | Forbidden; lint rule in CI |
| Default tool allowlist includes shell/file-write/web-fetch | Prompt injection → arbitrary code execution on host | Opt-in allowlist; minimal defaults |
| Running gemini-cli with SDK's cwd = user project root | Prompt can exfiltrate or damage the host project | Default to temp workspace; require explicit `cwd` opt-in |
| Logging full prompts / tool args at INFO | Leaks user data, API keys embedded in prompts | Redact at log layer; offer a `--debug-raw` flag that's never default |
| Automating OAuth flow via scraping or token reuse | Violates Gemini CLI ToS per [FAQ](https://geminicli.com/docs/resources/faq/) — account suspension risk | Never automate login; require user-run `gemini /login` |
| Passing `GEMINI_API_KEY` via argv | Visible in `ps` output on shared hosts | Always via env var; scrub from process listings |
| Trusting gemini-cli's exit code alone | Silent success with empty output | Also verify a terminal event was emitted |
| Blindly executing tool calls from stream | Prompt injection → exec arbitrary tools | Confirmation-callback pattern or strict allowlist |
| Storing session state in world-readable files | Leaks conversation history on multi-user hosts | `chmod 600` session files; document location |
| Inheriting parent env wholesale | Leaks unrelated secrets to gemini-cli | Filtered env whitelist: `PATH`, `HOME`, `GEMINI_*`, explicitly-forwarded others |

---

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Cryptic errors when `gemini-cli` isn't installed | User confusion, wasted hours | Check at client construction; raise `GeminiBinNotFoundError { searchedPaths, installUrl }` |
| Version mismatch errors with no context | User thinks their code is broken | Error message links to compat matrix URL |
| No progress indication during long agent runs | Feels frozen | Always stream events, never buffer; document `onMessage` callback |
| Hard error when upstream silently swaps model | Surprise quality change in production | `ModelDowngradeWarning` event, not a fatal error |
| OAuth error that says "permission denied" | User has no idea this is a known Google-side outage | Error message links to gemini-cli discussion #22970 and suggests switching to API key |
| Mojibake on Windows with no remediation hint | User abandons SDK | Error message: "Set `PYTHONIOENCODING=utf-8` or see docs link" |
| Two different SDKs (TS/Python) with different option names | Users switching languages re-learn everything | Single schema → generated types in both; identical option names |
| Session state lost on restart | User has to reconstruct context | Session IDs are stable across process restarts by default |
| Tools that silently no-op | Agent appears confused, user debugs their prompt | Emit a diagnostic if a tool is requested but not in allowlist |
| Long prompts truncated on Windows | Mystery failures | Use stdin for prompts > 4000 chars always |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Streaming parser:** Often missing partial-line reassembly across chunk boundaries — verify with a test that injects splits mid-JSON and mid-UTF-8.
- [ ] **Process spawn:** Often missing stderr drain — verify parent doesn't hang when child writes > 64 KB to stderr.
- [ ] **Kill path:** Often missing process-group handling — verify no orphan `gemini` after parent SIGKILL.
- [ ] **Windows support:** Often "tests pass on Linux runner" — verify CI has a Windows job with a non-UTF-8 locale (JP or DE).
- [ ] **Auth errors:** Often collapsed to one `AuthError` — verify 403-quota, 403-ToS, and expired-token are distinguishable.
- [ ] **Model selection:** Often pass-through only — verify `init` event is inspected and downgrade is surfaced.
- [ ] **Session resume:** Often tested with happy-path only — verify resume works after a `SIGKILL` mid-conversation.
- [ ] **Tool round-trip:** Often tested with a mock — verify end-to-end with a real MCP sidecar and gemini-cli execution.
- [ ] **Compat matrix:** Often just a README table — verify CI actually runs against all listed gemini-cli versions.
- [ ] **Error taxonomy:** Often just class hierarchy — verify Archon adapter contract test covers every class → bucket mapping.
- [ ] **TS/Python parity:** Often separate test suites — verify a shared corpus runs against both.
- [ ] **Rate limiting:** Often "we throw `RateLimitError`" — verify `.retryAfterMs` is populated from real upstream responses.
- [ ] **Security defaults:** Often "tools work" — verify the default allowlist excludes shell/file-write/web-fetch.
- [ ] **Unknown events:** Often "parser crashes" — verify unknown event types are yielded, not thrown.
- [ ] **Subprocess version check:** Often absent — verify a `gemini --version` call occurs and warns on out-of-range.
- [ ] **Long-prompt handling:** Often tested with short prompts — verify a > 8KB prompt works on Windows via stdin.

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Buffered `exec` used in hot path | MEDIUM | Rewrite to `spawn` + streaming; API stays same if it already returned an async iterator |
| Orphan processes in production | LOW (detection) / MEDIUM (fix) | Add supervisor that reaps children by PID group; ship as patch release |
| OAuth 403 outbreak | LOW | Docs update + env-var switch to API key; no code change needed if typed errors are in place |
| Stream-json schema change upstream | LOW if defensive parser | Update event type definitions, add fixture, ship patch; HIGH if parser throws on unknown |
| Model silently downgraded | LOW | Already surfaced via `ModelDowngradeWarning`; user decides to wait or switch |
| Shell injection vulnerability | HIGH | Emergency CVE release, force all users to upgrade, audit all call sites |
| Archon adapter broken by Archon upgrade | LOW if contract tests exist | Bump pin, fix shim, re-run contract tests; MEDIUM if no tests (blind fix) |
| TS/Python parity drift discovered | MEDIUM | Run parity harness, file bugs for each divergence, fix incrementally |
| Session state lost after crash | MEDIUM | Implement resume-by-ID if not present; data already on disk in most cases |
| Compat matrix gap (a version silently broke) | LOW if CI matrix exists | Identify the breaking version, add known-issue note, warn at runtime |
| Orphan MCP subprocesses from gemini-cli itself | HIGH | Workaround: kill process group. Real fix requires upstream (issue #13604 territory) |
| Encoding corruption on Windows | MEDIUM | Force UTF-8 env at spawn; document; upstream fix depends on gemini-cli (#4945) |
| Tool-use round-trip broken after upstream change | HIGH | May require reverting pinned gemini-cli version; update compat matrix |
| Auth mode precedence bug leaks secrets | HIGH | Emergency release; audit logs for leaked keys; rotate |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls. Phases named here correspond to the categories requested in the research prompt (foundation / parsing / sessions / tools / adapter / docs) plus a few additions that fell out of the research.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. Stream-json schema instability | Parsing | Golden-file fixture per pinned gemini-cli version; unknown-event test |
| 2. Stdout buffer deadlocks | Foundation / Process | Test with > 2 MB output; assert no `maxBuffer` reference in code |
| 3. Partial-line NDJSON parsing | Parsing | Fuzz test that injects chunk boundaries at every byte offset |
| 4. Orphaned subprocesses | Foundation / Process | Integration test: SIGKILL parent, `ps` clean after 10s |
| 5. Silent subprocess death | Foundation / Process | Test that non-zero exit → typed `ProcessError` with stderr |
| 6. Shell injection | Foundation / Process + CI lint | CI greps fail on `shell: true`; fuzz test with metacharacters |
| 7. Windows encoding | Foundation / Process + CI matrix | Windows-JP CI job with non-ASCII prompt fixtures |
| 8. Auth mode / 403 blast radius | Adapter / Auth | Docs updated; typed AuthError subclasses; default is API key |
| 9. Rate-limit misclassification | Error taxonomy | Contract test against Archon's 5-bucket classifier |
| 10. Model downgrade | Parsing / Model selection | Assertion that `init` event model matches requested model |
| 11. Session can't survive restart | Sessions | Kill-mid-session test verifies `resumeSession(id)` works |
| 12. Tool-use round-trip broken | Tools | End-to-end test with real MCP sidecar; v1 ships built-ins only |
| 13. Compat-matrix gap | CI / Release | CI runs 3 gemini-cli versions; runtime `--version` check |
| 14. Tool-execution security | Tools / Security | Default allowlist excludes shell/file-write; cwd defaults to temp |
| 15. TS/Python parity drift | Foundation (harness) + every phase | Parity CI job blocks merges on divergence |
| 16. Archon adapter breakage | Adapter | Contract tests in Archon repo; adapter < 300 LOC |
| 17. Silently-degraded feature APIs | Feasibility audit (pre-design) | Every `@experimental` feature has a failure-mode doc |
| 18. Concurrency model locked in | Foundation / API design | `query()` is async iterator; spawn-per-call v1, pool opt-in v1.1 |

Phase ordering implied by this mapping (tightest dependency chain first):

1. **Feasibility audit** — resolves PROJECT.md open questions; outputs "which features are real, which are workarounds"
2. **Foundation / Process layer** — spawn, stdio, kill, encoding, security. Prevents 2, 4, 5, 6, 7, 18.
3. **Parsing** — NDJSON, stream-json schema, unknown events, model verification. Prevents 1, 3, 10.
4. **Error taxonomy** — typed errors with retryable/retryAfter. Prevents 9.
5. **Parity harness** — shared test corpus set up before feature work. Prevents 15.
6. **Sessions** — ID-based, resume-capable. Prevents 11.
7. **Tools** — built-ins passthrough, allowlist, security defaults. Prevents 12, 14.
8. **Auth / API polish** — three auth modes, canonical default. Prevents 8.
9. **CI / Compat matrix** — cross-cutting, ongoing from phase 2. Prevents 13.
10. **Adapter** — thin Archon shim, contract tests. Prevents 16.
11. **Feature feasibility workarounds** (system prompt, structured output, hooks) — each `@experimental`. Prevents 17.
12. **Docs** — compat matrix, known-issues appendix, migration guide.

---

## Sources

### gemini-cli upstream issues (HIGH confidence — direct bug reports)

**Stream / output format:**
- [Issue #8203 — Add `stream-json` output format](https://github.com/google-gemini/gemini-cli/issues/8203)
- [Issue #22647 — `--acp` modes output plain text to stdout, corrupting JSON-RPC stream](https://github.com/google-gemini/gemini-cli/issues/22647)
- [Issue #9009 — Despite docs, Gemini CLI does not support JSON output](https://github.com/google-gemini/gemini-cli/issues/9009)
- [Issue #8022 — Structured JSON Output](https://github.com/google-gemini/gemini-cli/issues/8022)
- [Issue #20264 — JSON syntax error in gemini-automated-issue-triage](https://github.com/google-gemini/gemini-cli/issues/20264)
- [litellm #12496 — Gemini CLI JSON parse error unexpected character "\`"](https://github.com/BerriAI/litellm/issues/12496)

**OAuth / auth / 403s:**
- [Issue #16435 — 403 FORBIDDEN with personal account](https://github.com/google-gemini/gemini-cli/issues/16435)
- [Issue #24517 — 403 PERMISSION_DENIED for Google One AI Premium](https://github.com/google-gemini/gemini-cli/issues/24517)
- [Issue #24962 — 403 on new Google AI Ultra plan](https://github.com/google-gemini/gemini-cli/issues/24962)
- [Issue #14934 — 403 for personal free-tier accounts](https://github.com/google-gemini/gemini-cli/issues/14934)
- [Issue #10110 — 403 Forbidden with Google AI Pro Login with Google](https://github.com/google-gemini/gemini-cli/issues/10110)
- [Issue #22241 — indefinite hang on Google One AI Ultra (OAuth)](https://github.com/google-gemini/gemini-cli/issues/22241)
- [Issue #13246 — "Are you kidding? code: 403"](https://github.com/google-gemini/gemini-cli/issues/13246)
- [Discussion #22970 — Service update: mitigating abuse and prioritizing traffic (Mar 25 2026 routing change)](https://github.com/google-gemini/gemini-cli/discussions/22970)
- [Issue #15823 — Vertex AI CREDENTIALS_MISSING despite valid service account](https://github.com/google-gemini/gemini-cli/issues/15823)

**Windows / shell / encoding:**
- [Issue #4945 — ERR_ENCODING_NOT_SUPPORTED on Windows shell commands](https://github.com/google-gemini/gemini-cli/issues/4945)
- [Issue #20186 — Korean text corruption on Windows PowerShell](https://github.com/google-gemini/gemini-cli/issues/20186)
- [Issue #18112 — run_shell_command fails to escape nested quotes on Windows](https://github.com/google-gemini/gemini-cli/issues/18112)
- [Issue #15389 — Japanese characters garbled on Windows](https://github.com/google-gemini/gemini-cli/issues/15389)
- [Issue #12468 — Japanese garbled in run_shell_command on Windows](https://github.com/google-gemini/gemini-cli/issues/12468)
- [Issue #20661 — Chinese GBK/CP936 garbled output](https://github.com/google-gemini/gemini-cli/issues/20661)
- [Issue #3015 — Failure to execute shell commands on Windows](https://github.com/google-gemini/gemini-cli/issues/3015)
- [Issue #15493 — Allow configuring shell environment (not hardcoded powershell.exe)](https://github.com/google-gemini/gemini-cli/issues/15493)
- [Issue #18374 — Gemini CLI should choose pwsh over powershell by default](https://github.com/google-gemini/gemini-cli/issues/18374)

**MCP / tools:**
- [Issue #2654 — TypeError with multi-type JSON schema in MCP tool params](https://github.com/google-gemini/gemini-cli/issues/2654)
- [Issue #3406 — MCP servers not detected despite valid config on macOS](https://github.com/google-gemini/gemini-cli/issues/3406)
- [Issue #20694 — `gemini mcp enable` throws "Server not found" (config parsing bug)](https://github.com/google-gemini/gemini-cli/issues/20694)
- [Issue #17787 — Gemini CLI ignores MCP timeout configuration](https://github.com/google-gemini/gemini-cli/issues/17787)
- [Issue #23296 — MCP HTTP OAuth token refresh works via mcp list but fails during tool calls](https://github.com/google-gemini/gemini-cli/issues/23296)
- [Issue #23776 — MCP OAuth lose authentication when token expires mid-session](https://github.com/google-gemini/gemini-cli/issues/23776)
- [Issue #13604 — Gemini CLI hangs spawning npx subprocess for MCP stdio transport](https://github.com/google-gemini/gemini-cli/issues/13604)

**Model selection / downgrade:**
- [Issue #3485 — Model keeps changing from gemini-2.5-pro to gemini-2.5-flash](https://github.com/google-gemini/gemini-cli/issues/3485)
- [Issue #3425 — Default model switches from pro to flash mid-session](https://github.com/google-gemini/gemini-cli/issues/3425)
- [Issue #2470 — Switches to flash model without reason](https://github.com/google-gemini/gemini-cli/issues/2470)
- [Issue #8269 — CLI switches from 2.5-pro to flash with Code Assist Standard](https://github.com/google-gemini/gemini-cli/issues/8269)
- [Issue #11650 — CLI falls back to Flash on startup for oauth-personal](https://github.com/google-gemini/gemini-cli/issues/11650)
- [Issue #17487 — Prefer Gemini 3 over hardcoded Gemini 2.5](https://github.com/google-gemini/gemini-cli/issues/17487)
- [Issue #11935 — CRITICAL: Gemini CLI UNUSABLE (parsing blocked, read loop)](https://github.com/google-gemini/gemini-cli/issues/11935)
- [Issue #22631 — Gemini CLI keeps thinking on 429 Too Many Requests](https://github.com/google-gemini/gemini-cli/issues/22631)
- [AI developer forum — Clarification on stable replacement models before June 2026 deprecation](https://discuss.ai.google.dev/t/clarification-on-stable-replacement-models-for-gemini-2-5-flash-and-gemini-2-5-pro-before-june-2026-deprecation/130009)

**Official docs:**
- [gemini-cli headless mode reference](https://geminicli.com/docs/cli/headless/)
- [gemini-cli FAQ — third-party software ToS warning](https://geminicli.com/docs/resources/faq/)
- [gemini-cli quotas and pricing](https://geminicli.com/docs/resources/quota-and-pricing/)
- [gemini-cli configuration reference](https://geminicli.com/docs/reference/configuration/)
- [gemini-cli release notes / changelog](https://geminicli.com/docs/changelogs/)
- [gemini-cli MCP servers docs](https://geminicli.com/docs/tools/mcp-server/)
- [gemini-cli Gemini 3 migration guide](https://geminicli.com/docs/get-started/gemini-3/)
- [gemini-cli troubleshooting](https://geminicli.com/docs/resources/troubleshooting/)

### Claude Agent SDK / Codex SDK / reference-SDK architecture (MEDIUM-HIGH)

- [Inside the Claude Agent SDK: stdin/stdout communication architecture (buildwithaws.substack.com)](https://buildwithaws.substack.com/p/inside-the-claude-agent-sdk-from)
- [Wrapping Claude CLI for Agentic Applications (avasdream.com)](https://avasdream.com/blog/claude-cli-agentic-wrapper)
- [Why Claude Code subagents waste 50K tokens per turn (dev.to)](https://dev.to/jungjaehoon/why-claude-code-subagents-waste-50k-tokens-per-turn-and-how-to-fix-it-41ma)
- [Claude Agent SDK Python (PyPI)](https://pypi.org/project/claude-agent-sdk/)
- [Claude Agent SDK Python (GitHub)](https://github.com/anthropics/claude-agent-sdk-python)
- [Claude Agent SDK sessions docs](https://platform.claude.com/docs/en/agent-sdk/sessions)
- [Claude Code file checkpointing](https://platform.claude.com/docs/en/agent-sdk/file-checkpointing)
- [Claude Code checkpointing](https://code.claude.com/docs/en/checkpointing)
- [zed-industries/claude-agent-acp #338 — Claude CLI subprocess death leaves session permanently broken](https://github.com/zed-industries/claude-agent-acp/issues/338)
- [Claude Agent SDK "subagents, sessions, why it's worth it"](https://www.ksred.com/the-claude-agent-sdk-what-it-is-and-why-its-worth-understanding/)

### Node / Python subprocess literature (MEDIUM — general best practices)

- [Node.js child_process documentation](https://nodejs.org/api/child_process.html)
- [nodejs/node #4236 — spawn() has undocumented 200kb buffer limit](https://github.com/nodejs/node/issues/4236)
- [nodejs/help #963 — Buffering stdout/stderr from child process](https://github.com/nodejs/help/issues/963)
- [2ality — Working with stdout and stdin of a child process in Node.js](https://2ality.com/2018/05/child-process-streams.html)
- [Python subprocess documentation](https://docs.python.org/3/library/subprocess.html)
- [PEP 787 — Safer subprocess usage using t-strings](https://peps.python.org/pep-0787/)
- [Semgrep — Command Injection in Python](https://semgrep.dev/docs/cheat-sheets/python-command-injection)
- [Phabricator T13209 — How To Properly Escape Commands on Windows (A Dark Tragedy)](https://secure.phabricator.com/T13209)
- [Spawning subprocesses smartly and securely (Chris Warrick)](https://chriswarrick.com/blog/2017/09/02/spawning-subprocesses-smartly-and-securely/)
- [Eliminating Zombie Processes in Python Applications](https://medium.com/@python-javascript-php-html-css/effectively-eliminating-zombie-processes-and-task-resources-in-python-applications-c5d837112d7a)
- [Mastering SIGCHLD in Python](https://runebook.dev/en/docs/python/library/signal/signal.SIGCLD)
- [Python tracker bpo-43884 — Cannot cleanly kill a subprocess using high-level asyncio APIs](https://bugs.python.org/issue43884)
- [asyncio subprocess termination troubleshooting](https://runebook.dev/en/docs/python/library/asyncio-subprocess/asyncio.subprocess.Process.terminate)

### Wrapping / semver / compat matrix (MEDIUM)

- [npm/cli #9179 — semver for package that wraps semver-compliant executable](https://github.com/npm/cli/issues/9179)
- [Semantic Versioning 2.0.0](https://semver.org/)
- [SemVer Compatibility — Cargo Book](https://doc.rust-lang.org/cargo/reference/semver.html)

### Cross-language parity (MEDIUM)

- [Geektrovert/fraction #1 — Python-vs-TypeScript parity benchmark harness](https://github.com/Geektrovert/fraction/pull/1)
- [Letta — Announcing client SDKs for Python and TypeScript (Fern-generated)](https://www.letta.com/blog/announcing-our-sdks)

### Archon (HIGH — direct target)

- [coleam00/Archon repository](https://github.com/coleam00/Archon)
- [Archon #965 — Pi coding-agent as third AI assistant provider (adapter refactor in progress)](https://github.com/coleam00/Archon/issues/965)
- [Archon #362 — Missing error handling on OpenAI 429](https://github.com/coleam00/Archon/issues/362)

### Gemini API / function calling (MEDIUM)

- [Gemini API function calling docs](https://ai.google.dev/gemini-api/docs/function-calling)
- [Gemini API rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Gemini API models](https://ai.google.dev/gemini-api/docs/models)
- [Gemini OpenAI compatibility: tool_call + streaming bug (AI developer forum)](https://discuss.ai.google.dev/t/gemini-openai-compatibility-issue-with-tool-call-streaming/59886)
- [googleapis/python-genai #1162 — json.loads(chunk) fails on streaming error message](https://github.com/googleapis/python-genai/issues/1162)

---

*Pitfalls research for: Gemini SDK — subprocess wrapper over fast-moving gemini-cli upstream*
*Researched: 2026-04-11*
