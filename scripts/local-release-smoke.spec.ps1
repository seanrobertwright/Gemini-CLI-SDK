# local-release-smoke.spec.ps1 — self-test for local-release-smoke.ps1
#
# Validates preflight-error exit codes without requiring a real Archon clone.
# Run: pwsh scripts/local-release-smoke.spec.ps1

$ErrorActionPreference = 'Continue'

$SdkRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Script  = Join-Path $SdkRoot 'scripts\local-release-smoke.ps1'
$Pass = 0
$Fail = 0

function Assert-Exit {
    param(
        [int]$Expected,
        [string]$Description,
        [hashtable]$Env
    )
    $prev = @{}
    foreach ($k in $Env.Keys) {
        $prev[$k] = [Environment]::GetEnvironmentVariable($k, 'Process')
        [Environment]::SetEnvironmentVariable($k, $Env[$k], 'Process')
    }
    try {
        & pwsh -NoProfile -File $Script *> $null
        $actual = $LASTEXITCODE
    } finally {
        foreach ($k in $Env.Keys) {
            [Environment]::SetEnvironmentVariable($k, $prev[$k], 'Process')
        }
    }

    if ($actual -eq $Expected) {
        Write-Host "PASS: $Description (exit $actual)"
        $script:Pass++
    } else {
        Write-Host "FAIL: $Description (expected exit $Expected, got $actual)"
        $script:Fail++
    }
}

# Case 1: missing ARCHON_DIR → exit 1
Assert-Exit -Expected 1 -Description "missing archon dir exits 1" -Env @{
    GEMINI_API_KEY = $null
    ARCHON_DIR     = 'C:\definitely\does\not\exist\archon'
    SKIP_QUERY     = $null
}

# Case 2: missing GEMINI_API_KEY with valid ARCHON_DIR → exit 1
Assert-Exit -Expected 1 -Description "missing api key exits 1" -Env @{
    GEMINI_API_KEY = $null
    ARCHON_DIR     = $SdkRoot
    SKIP_QUERY     = $null
}

# Case 3: script exists and is a file
if (Test-Path $Script -PathType Leaf) {
    Write-Host "PASS: script exists"
    $Pass++
} else {
    Write-Host "FAIL: script missing at $Script"
    $Fail++
}

Write-Host ""
Write-Host "=========================================="
Write-Host "Results: $Pass passed, $Fail failed"
Write-Host "=========================================="
if ($Fail -ne 0) { exit 1 }
exit 0
