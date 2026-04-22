# local-release-smoke.ps1 — REL-07 gate (PowerShell port of local-release-smoke.sh)
#
# Applies the pr-artifacts bundle from Phase 10 to a local Archon fork,
# installs the Gemini SDK into it, and runs one real query() through the
# Archon workflow path. Passing this script is the prerequisite for tagging
# v1.0.0.
#
# Usage:
#   pwsh scripts/local-release-smoke.ps1
#   $env:ARCHON_DIR = "D:\path\to\archon-fork"; pwsh scripts/local-release-smoke.ps1
#
# Environment:
#   ARCHON_DIR       — path to a clean local Archon clone (default: ..\Archon)
#   GEMINI_API_KEY   — REQUIRED; used for the live query() call
#   SKIP_QUERY       — if "1", skips the live query step (patches + install only)
#
# Exit codes (mirror local-release-smoke.sh):
#   0  = smoke test passed (safe to tag v1.0.0)
#   1  = missing prerequisite
#   2  = patch apply failed
#   3  = install / bun test failed
#   4  = live query() failed

$ErrorActionPreference = 'Stop'

$SdkRoot   = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ArchonDir = if ($env:ARCHON_DIR) { $env:ARCHON_DIR } else { Join-Path $SdkRoot '..\Archon' }
$BundleDir = Join-Path $SdkRoot '.planning\phases\10-archon-adapter-ts-only\pr-artifacts'

$ArchonShaPin = ''
$compatFile = Join-Path $SdkRoot '.archon-compat'
if (Test-Path $compatFile) {
    $match = Select-String -Path $compatFile -Pattern '[a-f0-9]{40}' | Select-Object -First 1
    if ($match) { $ArchonShaPin = $match.Matches[0].Value }
}

function Log($msg)  { Write-Host "[local-release-smoke] $msg" }
function Fail($msg, [int]$code = 1) {
    [Console]::Error.WriteLine("[local-release-smoke] ERROR: $msg")
    exit $code
}
function Invoke-OrFail($code, $message, [scriptblock]$block) {
    & $block
    if ($LASTEXITCODE -ne 0) { Fail $message $code }
}

# --- preflight ---
Log "SDK root: $SdkRoot"
Log "Archon dir: $ArchonDir"

if (-not (Test-Path $BundleDir -PathType Container)) {
    Fail "pr-artifacts bundle not found at $BundleDir" 1
}
if (-not (Test-Path $ArchonDir -PathType Container)) {
    Fail "Archon checkout not found at $ArchonDir; clone your fork first or set `$env:ARCHON_DIR" 1
}
if (-not $env:GEMINI_API_KEY -and $env:SKIP_QUERY -ne '1') {
    Fail "GEMINI_API_KEY not set (required unless `$env:SKIP_QUERY = '1')" 1
}

# Verify Archon SHA matches pin (warn-not-fail)
if ($ArchonShaPin) {
    Push-Location $ArchonDir
    try {
        $actualSha = (& git rev-parse HEAD 2>$null).Trim()
        if (-not $actualSha) { $actualSha = 'unknown' }
        if ($actualSha -ne $ArchonShaPin) {
            Log "WARN: Archon is at $actualSha but pr-artifacts was verified against $ArchonShaPin"
            Log "WARN: continuing anyway; if patches fail, checkout the pinned SHA"
        }
    } finally {
        Pop-Location
    }
}

# --- step 1: copy gemini/ into community providers ---
Log "Step 1/5: copying provider files into community tree"
$ProvidersDir = Join-Path $ArchonDir 'packages\providers\src\community'
New-Item -ItemType Directory -Force -Path $ProvidersDir | Out-Null
try {
    Copy-Item -Recurse -Force (Join-Path $BundleDir 'gemini') $ProvidersDir
} catch {
    Fail "copy failed: $_" 2
}

# --- step 2: apply patches ---
Log "Step 2/5: applying registry + env.example patches"
Push-Location $ArchonDir
try {
    Invoke-OrFail 2 "registry.patch does not apply cleanly" {
        & git apply --check (Join-Path $BundleDir 'registry.patch')
    }
    Invoke-OrFail 2 "registry.patch apply failed" {
        & git apply (Join-Path $BundleDir 'registry.patch')
    }

    & git apply --check (Join-Path $BundleDir 'env.example.patch') 2>$null
    if ($LASTEXITCODE -eq 0) {
        Invoke-OrFail 2 "env.example.patch apply failed" {
            & git apply (Join-Path $BundleDir 'env.example.patch')
        }
    } else {
        Log "env.example.patch does not apply cleanly — likely GEMINI_API_KEY already present; continuing"
    }
} finally {
    Pop-Location
}

# --- step 3: install SDK as local dep ---
Log "Step 3/5: adding gemini-sdk as a local dep via bun link or tarball"
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Fail "bun not found; Archon requires bun — install via https://bun.sh" 3
}

Push-Location (Join-Path $ArchonDir 'packages\providers')
try {
    Push-Location (Join-Path $SdkRoot 'ts')
    try { & bun link 2>$null | Out-Null } finally { Pop-Location }

    & bun link '@gemini-sdk/core'
    if ($LASTEXITCODE -ne 0) {
        Invoke-OrFail 3 "bun add file: failed" {
            & bun add ("file:" + (Join-Path $SdkRoot 'ts'))
        }
    }
} finally {
    Pop-Location
}

Push-Location $ArchonDir
try {
    Invoke-OrFail 3 "bun install failed" { & bun install }

    # --- step 4: run adapter tests ---
    Log "Step 4/5: bun test packages/providers"
    Invoke-OrFail 3 "bun test failed" { & bun test packages/providers }

    # --- step 5: live query via DEFAULT_AI_ASSISTANT=gemini ---
    if ($env:SKIP_QUERY -eq '1') {
        Log "Step 5/5: SKIPPED (SKIP_QUERY=1)"
        Log "SMOKE TEST PARTIAL PASS (patches + install + test only; no live query)"
        exit 0
    }

    Log "Step 5/5: running one live query() through Archon"
    $contractTest = 'packages/providers/test/community/gemini.contract.test.ts'
    if (Test-Path (Join-Path $ArchonDir $contractTest)) {
        $env:DEFAULT_AI_ASSISTANT = 'gemini'
        Invoke-OrFail 4 "contract test failed against real gemini-cli" {
            & bun test $contractTest
        }
    } else {
        Log "WARN: contract test not found in Archon checkout; running a minimal inline smoke instead"
        Push-Location (Join-Path $SdkRoot 'ts')
        try {
            $env:DEFAULT_AI_ASSISTANT = 'gemini'
            $inline = @"
import { query } from './src/index.ts';
let saw = false;
for await (const chunk of query({ prompt: 'Say hello in one word.' })) {
  if (chunk.type === 'assistant' && chunk.text) saw = true;
}
if (!saw) { console.error('no assistant chunk'); process.exit(4); }
console.log('live query ok');
"@
            Invoke-OrFail 4 "live query failed" {
                & node --experimental-strip-types -e $inline
            }
        } finally {
            Pop-Location
        }
    }
} finally {
    Pop-Location
}

Log "SMOKE TEST PASSED — safe to tag v1.0.0"
exit 0
