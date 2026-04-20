---
phase: 08-tools-approval-mode-structured-output-best-effort
plan: "02"
subsystem: query
tags: [typescript, types, argv, tools, approval-mode, structured-output, zod]
dependency_graph:
  requires: []
  provides: [ApprovalMode-type, allowedTools-argv-branch, approvalMode-argv-branch, outputSchema-type, structured-result-type, zod-deps]
  affects: [ts/src/query/types.ts, ts/src/query/buildArgv.ts, ts/src/query/buildArgv.spec.ts, ts/src/query/index.ts, ts/package.json]
tech_stack:
  added: [zod@4.3.6, zod-from-json-schema@0.5.2]
  patterns: [const-object-union-type, additive-argv-branch, experimental-jsdoc]
key_files:
  created: []
  modified:
    - ts/package.json
    - ts/src/query/types.ts
    - ts/src/query/buildArgv.ts
    - ts/src/query/buildArgv.spec.ts
    - ts/src/query/index.ts
    - pnpm-lock.yaml
decisions:
  - "ApprovalMode type-only export omitted from barrel: value export already carries both value and type; adding to export type {} causes TS2300 Duplicate identifier"
  - "Zod v4.3.6 resolved (not v3): zod-from-json-schema 0.5.2 supports both; no v3 subpath needed for Phase 8 plans 03-06"
metrics:
  duration_minutes: 3
  completed_date: "2026-04-20"
  tasks_completed: 2
  files_changed: 6
requirements_satisfied: [TOL-01, TOL-02, TOL-04, OUT-04]
---

# Phase 8 Plan 02: TypeScript Types + buildArgv Extension Summary

**One-liner:** Zod v4 + zod-from-json-schema installed as runtime deps; ApprovalMode const-object + union type added; QueryOptions extended with allowedTools/approvalMode/outputSchema; buildArgv gains two argv branches with 21 new tests

## What Was Done

### Task 1: Types + Dependencies

**Dependency versions installed (from pnpm-lock.yaml resolved):**
- `zod`: 4.3.6 (v4 is the current default; v3 subpath available if needed by later plans)
- `zod-from-json-schema`: 0.5.2

Both added to `"dependencies"` (not devDependencies) in `ts/package.json`.

**ApprovalMode const + type declarations:**

```typescript
export const ApprovalMode = {
  DEFAULT: 'default',
  AUTO_EDIT: 'auto_edit',
  YOLO: 'yolo',
  PLAN: 'plan',
} as const;

export type ApprovalMode = (typeof ApprovalMode)[keyof typeof ApprovalMode] | string;
```

Exactly mirrors the Phase 4 Model pattern. 4 keys, all string literals.

**QueryOptions additions:**
- `allowedTools?: string[]` — CSV-joined at argv boundary; empty/undefined omits flag
- `approvalMode?: ApprovalMode` — passed as `--approval-mode <mode>`; undefined omits flag
- `outputSchema?: Record<string, unknown>` — `@experimental` tagged; only for queryFull()

**QueryResult addition:**
- `structured?: unknown` — `@experimental` tagged; populated when outputSchema validation succeeds

**@experimental tags:** 2 total (on `outputSchema` and `QueryResult.structured`)

**Barrel export:** `ApprovalMode` added to value export in `ts/src/query/index.ts`. Not added separately to `export type {}` — value export in TypeScript carries both value and type simultaneously; duplicate would cause TS2300.

### Task 2: buildArgv Branches + Tests

**New argv branches (2 total):**

```typescript
// TOL-01: --allowed-tools (skip when undefined or empty array)
if (options.allowedTools?.length) {
  argv.push('--allowed-tools', options.allowedTools.join(','));
}

// TOL-02: --approval-mode (skip when undefined)
if (options.approvalMode !== undefined) {
  argv.push('--approval-mode', options.approvalMode as string);
}
```

**Test count added: 21 new tests across 4 new describe blocks**

| Describe Block | Tests |
|---|---|
| `buildArgv: allowedTools (TOL-01)` | 5 |
| `buildArgv: approvalMode (TOL-02)` | 5 |
| `buildArgv: Phase 8 flags combined` | 2 |
| `buildArgv: allowedTools CSV fuzz` | 1 (property-based) |

**Total test suite: 52 tests (31 existing + 21 new), all passing**

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TS2300 Duplicate identifier for ApprovalMode type re-export**
- **Found during:** Task 1, Step 3 (barrel export extension)
- **Issue:** Plan specified adding `ApprovalMode` to both value (`export { ... }`) and type (`export type { ... }`) re-exports in `index.ts`. TypeScript does not allow this — a value export already exports the accompanying type, so adding it again to `export type {}` produces TS2300 Duplicate identifier.
- **Fix:** Only include `ApprovalMode` in the value export (`export { Model, ApprovalMode, AbortError }`). This makes it available as both value and type for consumers. The `export type {}` line was left unchanged with only `QueryOptions` and `QueryResult`.
- **Files modified:** `ts/src/query/index.ts`
- **Commit:** 493c750

None - all other plan steps executed exactly as written.

## Zod v4 vs v3 Note

Zod 4.3.6 was resolved (not v3). The `zod-from-json-schema` 0.5.2 supports both Zod v3 and v4. Plans 03-06 (which implement the actual schema validation in `output/schemaValidator.ts`) should use `zod/v4` subpath import or plain `zod` import — both work at the resolved version. No `zod/v3` subpath aliasing is needed.

## Commits

| Task | Commit | Description |
|---|---|---|
| Task 1 | 493c750 | feat(08-02): install zod + zod-from-json-schema, extend QueryOptions/QueryResult types, add ApprovalMode |
| Task 2 | be5a5bd | feat(08-02): add allowedTools + approvalMode branches to buildArgv with unit + fuzz tests |

## Self-Check: PASSED

All files verified to exist. Both commits (493c750, be5a5bd) found in git log. zod and zod-from-json-schema confirmed in node_modules.
