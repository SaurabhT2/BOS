# scripts/release-gate.ps1
#
# BrandOS Release Gate — v1
#
# Implements Deliverable 3 from reports/verification-platform-design.md.
#
# This is the canonical packaging verifier. Run it before any release,
# packaging operation, or tag creation. It is also the entry point for
# CI/CD release gate jobs.
#
# Execution order (from verification-platform-design.md §5.1):
#   Stage 1 — Existing Platform Verification  (platform-verify.ps1)
#   Stage 2 — Architecture Verification       (platform-architecture-verify.ps1)
#   Stage 3 — Runtime Verification            (platform-runtime-verify.ps1)
#
# Each stage produces PASS | WARN | FAIL.
# Release Gate Result:
#   PASS — all stages passed
#   WARN — no FAIL; ≥1 WARN (human sign-off required)
#   FAIL — any stage returned FAIL (packaging blocked)
#
# Exit codes:
#   0 — PASS
#   1 — FAIL  (packaging blocked)
#   2 — WARN  (human sign-off required; use --Force to override)
#
# USAGE:
#   .\scripts\release-gate.ps1
#   .\scripts\release-gate.ps1 -SkipRuntime           # skip Stage 3 (no live env)
#   .\scripts\release-gate.ps1 -SkipBuildCheck        # pass through to platform-verify
#   .\scripts\release-gate.ps1 -Force                 # promote WARN to PASS (requires justification)
#   .\scripts\release-gate.ps1 -Verbose               # verbose output from all stages
#   .\scripts\release-gate.ps1 -StrictWarnings        # treat WARN as FAIL

param(
  [switch]$SkipRuntime,
  [switch]$SkipBuildCheck,
  [switch]$Force,
  [string]$ForceJustification = "",
  [switch]$Verbose,
  [switch]$StrictWarnings,
  # Runtime verify pass-through params — Runtime Verification V2.
  # VerifySecret is the ONLY required credential (Internal Verification API,
  # x-runtime-verify-secret). WorkspaceId/UserId are optional and only needed
  # to verify a specific real workspace instead of the self-provisioning
  # fixture — see apps/web/lib/internal/runtime-verify-context.ts.
  [string]$BaseUrl      = ($env:BRANDOS_BASE_URL ?? "http://localhost:3000"),
  [string]$VerifySecret = ($env:BRANDOS_RUNTIME_VERIFY_SECRET ?? ""),
  [string]$WorkspaceId  = ($env:BRANDOS_RUNTIME_VERIFY_WORKSPACE_ID ?? ""),
  [string]$UserId       = ($env:BRANDOS_RUNTIME_VERIFY_USER_ID ?? "")
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$StartTime = Get-Date
$Timestamp = $StartTime.ToString("yyyy-MM-dd HH:mm:ss UTC")

$ReportsDir = Join-Path $Root "reports"
New-Item -ItemType Directory -Path $ReportsDir -Force | Out-Null

# Stage results: 0=PASS, 1=FAIL, 2=WARN
$Stage1Result = 0
$Stage2Result = 0
$Stage3Result = 0

$Stage1Label = "PASS"
$Stage2Label = "PASS"
$Stage3Label = "PASS"

$Stage1Counts = ""
$Stage2Counts = ""
$Stage3Counts = ""

function Result-Label($code) {
  switch ($code) {
    0 { "PASS" }
    1 { "FAIL" }
    2 { "WARN" }
    default { "UNKNOWN" }
  }
}

function Result-Color($code) {
  switch ($code) {
    0 { "Green"  }
    1 { "Red"    }
    2 { "Yellow" }
    default { "Gray" }
  }
}

# ── Header ────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "══════════════════════════════════════════════════════════════" -ForegroundColor White
Write-Host "  BrandOS Release Gate — $Timestamp" -ForegroundColor White
Write-Host "══════════════════════════════════════════════════════════════" -ForegroundColor White
Write-Host ""

# ── Stage 1: Existing Platform Verification ───────────────────────────────────

Write-Host "┌─────────────────────────────────────────────────────────────┐" -ForegroundColor DarkGray
Write-Host "│  Stage 1: Repository Health (platform-verify.ps1)           │" -ForegroundColor White
Write-Host "└─────────────────────────────────────────────────────────────┘" -ForegroundColor DarkGray
Write-Host ""

$verifyArgs = @()
if ($SkipBuildCheck) { $verifyArgs += "-SkipBuildCheck" }
if ($Verbose)        { $verifyArgs += "-Verbose" }

$verifyOutput = & pwsh -NoProfile -NonInteractive `
  -File "$PSScriptRoot\platform-verify.ps1" @verifyArgs 2>&1

$Stage1Result = $LASTEXITCODE
$Stage1Label  = if ($Stage1Result -eq 0) { "PASS" } else { "FAIL" }

# Extract pass/fail counts from platform-verify's VERIFICATION summary line.
# e.g. "  VERIFICATION: 44 passed, 1 failed"
# This is ASCII-safe and survives subprocess stdout encoding correctly.
$verifySummaryLine = $verifyOutput | Where-Object { $_ -match 'VERIFICATION:' } | Select-Object -Last 1
if ($verifySummaryLine -and $verifySummaryLine -match '(\d+) passed,\s*(\d+) failed') {
  $Stage1Counts = "$($Matches[1]) passed, $($Matches[2]) failed"
} else {
  $Stage1Counts = if ($Stage1Result -eq 0) { "all checks passed" } else { "check output for details" }
}

# Print output (always show on failure; suppress on clean pass unless Verbose)
if ($Stage1Result -ne 0 -or $Verbose) {
  $verifyOutput | ForEach-Object { Write-Host "  $_" }
} else {
  Write-Host "  $Stage1Counts" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host ("  Stage 1 Result: {0,-6} ({1})" -f $Stage1Label, $Stage1Counts) `
  -ForegroundColor (Result-Color $Stage1Result)
Write-Host ""

# ── Stage 2: Architecture Verification ────────────────────────────────────────

Write-Host "┌─────────────────────────────────────────────────────────────┐" -ForegroundColor DarkGray
Write-Host "│  Stage 2: Architecture Health (platform-architecture-verify) │" -ForegroundColor White
Write-Host "└─────────────────────────────────────────────────────────────┘" -ForegroundColor DarkGray
Write-Host ""

$archArgs = @()
if ($Verbose)        { $archArgs += "-Verbose" }
if ($StrictWarnings) { $archArgs += "-StrictWarnings" }

$archOutput = & pwsh -NoProfile -NonInteractive `
  -File "$PSScriptRoot\platform-architecture-verify.ps1" @archArgs 2>&1

$Stage2Result = $LASTEXITCODE
$Stage2Label  = Result-Label $Stage2Result

$archSummaryLine = $archOutput | Where-Object { $_ -match 'Architecture Verification:' } | Select-Object -Last 1
if ($archSummaryLine -and $archSummaryLine -match '(\d+) passed,\s*(\d+) warned,\s*(\d+) failed') {
  $Stage2Counts = "$($Matches[1]) passed, $($Matches[2]) warned, $($Matches[3]) failed"
} else {
  $Stage2Counts = if ($Stage2Result -eq 0) { "all checks passed" } elseif ($Stage2Result -eq 2) { "warnings — see report" } else { "check output for details" }
}

if ($Stage2Result -ne 0 -or $Verbose) {
  $archOutput | ForEach-Object { Write-Host "  $_" }
} else {
  Write-Host "  $Stage2Counts" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host ("  Stage 2 Result: {0,-6} ({1})" -f $Stage2Label, $Stage2Counts) `
  -ForegroundColor (Result-Color $Stage2Result)
Write-Host ""

# ── Stage 3: Runtime Verification ─────────────────────────────────────────────

Write-Host "┌─────────────────────────────────────────────────────────────┐" -ForegroundColor DarkGray
Write-Host "│  Stage 3: Runtime Health (platform-runtime-verify.ps1)      │" -ForegroundColor White
Write-Host "└─────────────────────────────────────────────────────────────┘" -ForegroundColor DarkGray
Write-Host ""

if ($SkipRuntime) {
  Write-Host "  ⏭  Stage 3 skipped (--SkipRuntime)" -ForegroundColor DarkGray
  $Stage3Result = 2
  $Stage3Label  = "WARN"
  $Stage3Counts = "skipped (--SkipRuntime)"
} else {
  $runtimeArgs = @(
    "-BaseUrl",      $BaseUrl,
    "-VerifySecret", $VerifySecret
  )
  if ($WorkspaceId) { $runtimeArgs += @("-WorkspaceId", $WorkspaceId) }
  if ($UserId)      { $runtimeArgs += @("-UserId", $UserId) }
  if ($Verbose) { $runtimeArgs += "-Verbose" }

  $runtimeOutput = & pwsh -NoProfile -NonInteractive `
    -File "$PSScriptRoot\platform-runtime-verify.ps1" @runtimeArgs 2>&1

  $Stage3Result = $LASTEXITCODE
  $Stage3Label  = Result-Label $Stage3Result

  $rtSummaryLine = $runtimeOutput | Where-Object { $_ -match 'Runtime Verification:' } | Select-Object -Last 1
  if ($rtSummaryLine -and $rtSummaryLine -match '(\d+) passed,\s*(\d+) warned,\s*(\d+) failed,\s*(\d+) skipped') {
    $Stage3Counts = "$($Matches[1]) passed, $($Matches[2]) warned, $($Matches[3]) failed, $($Matches[4]) skipped"
  } else {
    $Stage3Counts = if ($Stage3Result -eq 0) { "all checks passed" } elseif ($Stage3Result -eq 2) { "warnings or skipped — see report" } else { "check output for details" }
  }

  if ($Stage3Result -eq 1 -or $Verbose) {
    $runtimeOutput | ForEach-Object { Write-Host "  $_" }
  } else {
    Write-Host "  $Stage3Counts" -ForegroundColor DarkGray
  }
}

Write-Host ""
Write-Host ("  Stage 3 Result: {0,-6} ({1})" -f $Stage3Label, $Stage3Counts) `
  -ForegroundColor (Result-Color $Stage3Result)
Write-Host ""

# ── Gate Decision ─────────────────────────────────────────────────────────────

$GateResult = 0  # PASS by default
if ($Stage1Result -eq 1 -or $Stage2Result -eq 1 -or $Stage3Result -eq 1) {
  $GateResult = 1  # FAIL — any stage failed
} elseif ($Stage1Result -eq 2 -or $Stage2Result -eq 2 -or $Stage3Result -eq 2) {
  $GateResult = 2  # WARN — no failure, at least one warning
}

if ($StrictWarnings -and $GateResult -eq 2) {
  $GateResult = 1
}

$GateLabel = Result-Label $GateResult
$Elapsed   = [math]::Round(((Get-Date) - $StartTime).TotalSeconds, 1)

# ── Generate release-readiness.md ─────────────────────────────────────────────

$gateEmoji = switch ($GateResult) { 0 { "✅" }; 1 { "❌" }; 2 { "⚠️" } }
$actionRequired = switch ($GateResult) {
  0 { "None — proceed to packaging." }
  1 { "Packaging BLOCKED. Fix all FAIL items before retrying." }
  2 { "Human sign-off required. Review findings and approve with --Force if acceptable." }
}

$forceNote = if ($Force -and $GateResult -eq 2) {
  "`n> **Force override applied** by operator at $Timestamp.`n> Justification: $(if ($ForceJustification) { $ForceJustification } else { '(none provided)' })`n"
} else { "" }

$readinessReport = @"
# Release Readiness Report

> Generated: $Timestamp
> Elapsed: ${Elapsed}s
> Release Gate: scripts/release-gate.ps1

$forceNote
## Stage Results

| Stage | Script | Result | Detail |
|---|---|---|---|
| Repository Health | platform-verify.ps1 | $Stage1Label | $Stage1Counts |
| Architecture Health | platform-architecture-verify.ps1 | $Stage2Label | $Stage2Counts |
| Runtime Health | platform-runtime-verify.ps1 | $Stage3Label | $Stage3Counts |

## Release Gate Decision

$gateEmoji **$GateLabel**

**Action required:** $actionRequired

## Finding Summary

| Report | Location |
|---|---|
| Ownership Audit | reports/ownership-audit.md |
| V1/V2 Audit | reports/runtime-v1-v2-audit.md |
| Runtime Verification (unified) | reports/runtime-verification.md |
| Provider Propagation | reports/provider-propagation.md |
| Model Propagation | reports/model-propagation.md |
| Governance Audit | reports/governance-audit.md |
| Persistence Audit | reports/persistence-audit.md |
| Semantic Verification | reports/semantic-verification.md |

## Packaging Gate

$(if ($GateResult -eq 0) {
  "✅ Packaging is CLEARED. Proceed with scripts/package-workspace.ps1."
} elseif ($GateResult -eq 1) {
  "❌ Packaging is BLOCKED. Do not proceed until all FAIL findings are resolved."
} else {
  "⚠️ Packaging requires human sign-off. Use \`\`--Force\`\` with \`\`--ForceJustification\`\` to override."
})

## Verification Coverage

Checks performed by this gate:

**Static** (source code analysis — no runtime required)
- Toolchain: Node ≥18, pnpm ≥9
- Lockfile integrity
- Workspace structure (all 16 package.json files)
- Layer boundary rules (12 named RULE-* checks)
- BI isolation rules (import-graph + semantic)
- Route import restrictions
- Pipeline ordering (runControlPlane → executeArtifactPipeline)
- process.env provider/model resolution outside runtime-config
- V1 code reachability
- Duplicate schema definitions

**Contract** (ownership and architectural rules)
- Runtime ownership chain (UI → RT Profile → RT Config → AI Runtime → Provider)
- Brand Intelligence semantic ownership (OCL schema selection, CPL BI logic)
- Single production execution path (no bypass routes)
- Table ownership: declared vs actual writers
- Artifact engine no-touch enforcement

**Runtime** (live execution — requires BRANDOS_RUNTIME_VERIFY_SECRET; see
Runtime Verification V2.1 — Internal Verification API, scripts/platform-runtime-verify.ps1)
- Verifier health check (secret + route mounting)
- Provider verification (resolution, selection, propagation; per-provider silent-fallback detection)
- Model verification (configured vs resolved, runtime propagation)
- Brand Intelligence verification (Brand Memory ON/OFF, identity contribution, style projection, semantic identity propagation)
- Governance verification (repair ceiling, MAX_REPAIR_ATTEMPTS = 3, threshold evaluation)
- Persistence verification (artifact + provider/model/governance metadata, read-back)
- Runtime diagnostics accuracy vs runtime reality, with full RuntimeTrace validation
- Semantic verification (§7) — topic preservation, persona/audience/identity correctness, artifact schema conformance, persistence fidelity
- Resilient to transient provider rate limits and circuit-breaker trips (retries the failing stage only — see Invoke-APIWithResilience)
- Per-stage health scoring (Infrastructure/Runtime/Semantic/Readiness) and a READY / READY WITH WARNINGS / NOT READY release recommendation

## Status

$GateLabel
"@

Set-Content -Path (Join-Path $ReportsDir "release-readiness.md") -Value $readinessReport -Encoding UTF8

# ── Final output ──────────────────────────────────────────────────────────────

Write-Host "══════════════════════════════════════════════════════════════" -ForegroundColor White
Write-Host ("  Repository Health     {0}" -f $Stage1Label.PadRight(6)) -ForegroundColor (Result-Color $Stage1Result)
Write-Host ("  Architecture Health   {0}" -f $Stage2Label.PadRight(6)) -ForegroundColor (Result-Color $Stage2Result)
Write-Host ("  Runtime Health        {0}" -f $Stage3Label.PadRight(6)) -ForegroundColor (Result-Color $Stage3Result)
Write-Host "──────────────────────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host ("  Release Gate Result:  {0}   ({1}s)" -f $GateLabel.PadRight(6), $Elapsed) `
  -ForegroundColor (Result-Color $GateResult)
Write-Host ""
Write-Host "  Action required: $actionRequired" -ForegroundColor (Result-Color $GateResult)
Write-Host ""
Write-Host "  reports/release-readiness.md written" -ForegroundColor DarkGray
Write-Host "══════════════════════════════════════════════════════════════" -ForegroundColor White
Write-Host ""

# ── Force override ────────────────────────────────────────────────────────────

if ($Force -and $GateResult -eq 2) {
  if (-not $ForceJustification) {
    Write-Host "  ⚠️  --Force requires --ForceJustification <text>" -ForegroundColor Yellow
    Write-Host "      Example: --Force --ForceJustification 'Runtime env unavailable in CI'" -ForegroundColor DarkGray
    exit 2
  }
  Write-Host "  ⚠️  WARN overridden by --Force" -ForegroundColor Yellow
  Write-Host "      Justification: $ForceJustification" -ForegroundColor DarkGray
  Write-Host ""
  exit 0
}

if ($Force -and $GateResult -eq 1) {
  Write-Host "  ❌ --Force cannot override FAIL. Fix failures first." -ForegroundColor Red
  exit 1
}

exit $GateResult
