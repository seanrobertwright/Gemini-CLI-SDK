# Compatibility Matrix

| Component | Tested Range | Notes |
|-----------|-------------|-------|
| `gemini-cli` | `0.37.x` | Pinned in `.gemini-cli-compat`. The SDK derives the tested range as `~<pinned>` (same major.minor). |
| Node.js | 18, 20, 22 | CI matrix gates every release. |
| Python | 3.10, 3.11, 3.12, 3.13 | CI matrix gates every release. |
| Platforms | Windows, macOS, Linux | Windows is a hard-required CI job (not continue-on-error). |

## Runtime compat probe

On the first `query()` call per process, the SDK spawns `gemini --version` once, compares against the pinned range, and caches the result for the rest of the process lifetime.

### `GEMINI_SDK_COMPAT` — override probe behavior

| Value | Behavior |
|-------|----------|
| _(unset)_ or any unrecognized value | **Default — warn:** emit `[gemini-sdk] tested against gemini-cli 0.37.x, detected <detected> — proceeding` to stderr and continue. |
| `strict` | Throw an error (TS) / raise `RuntimeError` (Python) with the same message; SDK refuses to proceed. |
| `silent` | Suppress the warning entirely. SDK still runs. |

### When to use each mode

- **warn (default):** Development and most production use. You see drift but you're not blocked.
- **strict:** CI pipelines that pin to a specific gemini-cli version and want to fail loudly when the container base image drifts.
- **silent:** Bulk batch workers where stderr noise is unwelcome and you accept the drift risk.

## gemini-cli is NOT bundled

The SDK declares `gemini-cli` as a runtime prerequisite but does not install it. Users are responsible for installing and updating `gemini-cli` themselves. See the [Archon pattern discussion](https://github.com/coleam00/Archon/discussions) for the rationale.

## Version history

The current pinned version is `0.37.1`. The derived compat range is `0.37.x` (same major.minor).

When a new `gemini-cli` minor is validated, update `.gemini-cli-compat` at the repo root and re-run the full CI suite. The compat probe reads that file at runtime — no code changes needed for minor bumps within a tested range.

## Related pages

- [Known Issues](./known-issues.md) — upstream `gemini-cli` bugs with SDK defenses
- [Archon Integration](./archon-integration.md) — using the SDK with Archon's `DEFAULT_AI_ASSISTANT=gemini`
- [TypeScript Quickstart](./ts/quickstart.md) — install and first query

## Quick reference

| Env var | Default | Effect |
|---------|---------|--------|
| `GEMINI_SDK_COMPAT` | _(unset)_ = warn | Override compat probe behavior |
| `GEMINI_API_KEY` | _(fallback)_ | Gemini API authentication key (used if CLI Auth is absent) |
| `GEMINI_BIN_PATH` | resolved from PATH | Override `gemini` binary location |
