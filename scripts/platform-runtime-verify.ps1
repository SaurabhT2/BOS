# scripts/platform-runtime-verify.ps1
#
# BrandOS Runtime Verification Layer — V2.1 (production-grade evolution of V2)
#
# V2 (see header history below) fixed AUTH and ROUTE DRIFT by replacing
# browser-session impersonation with a secret-authenticated Internal
# Verification API. This revision evolves V2 into a production-grade
# end-to-end verification suite without changing any production runtime
# behavior — every change below lives in this script and in
# apps/web/app/api/internal/runtime-verify/* (the verifier's OWN surface).
#
# WHAT'S NEW IN THIS REVISION:
#
#   Part 1 — Resilience:
#     Invoke-APIWithResilience detects rate-limit (429 / errorKind
#     'rate_limited') and circuit-breaker (503 / errorKind 'circuit_open')
#     responses from the verify API (see
#     apps/web/lib/internal/runtime-verify-errors.ts for the classifier —
#     grounded in the actual strings ai-runtime-layer's execution engine
#     throws, not invented). Rate limits back off 15s → 30s → 60s (or honor
#     a server-supplied retryAfterSeconds, when present). Circuit-open waits
#     for AdminSettingsService's live circuitResetMs (the ACTUAL configured
#     cooldown, not a guess). Retries are scoped to the ONE failing stage's
#     HTTP call — a retry never re-runs earlier stages. Only after retries
#     are exhausted does a stage FAIL; a stage that needed retries but
#     ultimately succeeded reports WARN (not PASS, not FAIL) with the retry
#     count visible in the report, so instability is never silently hidden
#     behind a green checkmark.
#
#   Part 2 — Semantic Verification (§7):
#     New stage after Persistence. Calls
#     POST /api/internal/runtime-verify/semantic, which inspects the actual
#     generated artifact and runtime metadata (not just HTTP status) for
#     topic preservation, Brand Memory correctness, persona injection,
#     audience resolution, identity contribution, schema conformance,
#     governance recording, persistence fidelity, trace completeness, and
#     provider/model correctness. See runtime-verify-service.ts's
#     verifySemantic() doc comment for the canary-injection methodology and
#     its honest limitations (some checks are heuristic proxies for
#     subjective LLM-output qualities and report WARN rather than FAIL on a
#     miss, by design).
#
#   Part 3 — RuntimeTrace validation:
#     Every trace returned by the API is now run through
#     validateRuntimeTrace() (@brandos/contracts) — presence-checked against
#     all 13 production-grade fields and cross-checked for internal
#     consistency (e.g. fallbackUsed must agree with
#     configuredProvider/resolvedProvider). Issues surface as WARN (missing
#     field) or FAIL (genuine contradiction) with a human-readable
#     explanation, never a bare boolean.
#
#   Part 4 — Reporting:
#     Every stage now reports PASS/WARN/FAIL + execution time + retry count
#     + provider + model + root cause + recommended action. The end of the
#     run computes four scores (Runtime Health, Semantic Health,
#     Infrastructure Health, Readiness) and a release recommendation
#     (READY / READY WITH WARNINGS / NOT READY) — see the Scoring section
#     below for the exact, documented formula (no hidden thresholds).
#
# CONSTRAINTS HONORED:
#   - Still drives the real production execution path (runControlPlane →
#     executeArtifactPipeline → CPL proxies) — no mocks anywhere.
#   - Still never bypasses Control Plane / Governance / Persistence / Brand
#     Intelligence — every check goes through the same CPL entrypoints the
#     real product routes use.
#   - Still has zero dependency on the Studio UI — pure HTTP + a secret.
#   - Still compatible with release-gate.ps1: the
#     "Runtime Verification: N passed, N warned, N failed, N skipped"
#     summary line and the 0/1/2 exit code contract are UNCHANGED.
#
# Verification type: Runtime
# (all checks execute code paths against a live environment, via the
#  secret-authenticated Internal Verification API — never against raw
#  user-facing routes, and never by impersonating a browser session)
#
# Prerequisites:
#   - apps/web must be running at $BaseUrl (default: http://localhost:3000)
#   - BRANDOS_RUNTIME_VERIFY_SECRET set on BOTH the server (so
#     /api/internal/runtime-verify/* will accept requests) and wherever this
#     script runs (so it can authenticate). This is the ONLY secret this
#     script needs. Configure it once, the same way you configure any other
#     CI secret — it is never extracted from a browser session.
#
# Optional (NOT required — zero-config default uses a self-provisioning
# verification fixture workspace; see apps/web/lib/internal/runtime-verify-context.ts):
#   - BRANDOS_RUNTIME_VERIFY_WORKSPACE_ID + BRANDOS_RUNTIME_VERIFY_USER_ID
#     — verify against a specific real workspace instead of the fixture.
#     Both must be set together. Like the secret, this is one-time deploy
#     config, not something looked up per run.
#
# Checks (mapped 1:1 onto /api/internal/runtime-verify/*):
#   §0  Verifier Health Check     — GET  /api/internal/runtime-verify/ping
#   §1  Provider Verification     — GET  /api/internal/runtime-verify/provider
#   §2  Model Verification        — GET  /api/internal/runtime-verify/model
#   §3  Brand Intelligence        — POST /api/internal/runtime-verify/brand-memory
#   §4  Governance Verification   — POST /api/internal/runtime-verify/governance
#   §5  Persistence Verification  — POST /api/internal/runtime-verify/persistence
#   §6  Runtime Diagnostics       — GET  /api/internal/runtime-verify/diagnostics
#   §7  Semantic Verification     — POST /api/internal/runtime-verify/semantic
#
# Generates:
#   reports/runtime-verification.md   (unified Pass/Fail/Warn per section + scores)
#   reports/provider-propagation.md
#   reports/model-propagation.md
#   reports/governance-audit.md
#   reports/persistence-audit.md
#   reports/semantic-verification.md
#
# Exit codes:
#   0 — PASS
#   1 — FAIL  (≥1 failure with environment available)
#   2 — WARN  (skipped checks due to missing environment, OR warnings only)

param(
  [string]$BaseUrl              = ($env:BRANDOS_BASE_URL ?? "http://localhost:3000"),
  [string]$VerifySecret         = ($env:BRANDOS_RUNTIME_VERIFY_SECRET ?? ""),
  [string]$WorkspaceId          = ($env:BRANDOS_RUNTIME_VERIFY_WORKSPACE_ID ?? ""),
  [string]$UserId               = ($env:BRANDOS_RUNTIME_VERIFY_USER_ID ?? ""),
  [switch]$Verbose,
  [switch]$SkipProviderTests,
  [switch]$SkipGovernanceTests,
  [switch]$SkipSemanticTests,
  # Resilience tuning (Part 1) — defaults match the spec exactly
  # (15s → 30s → 60s backoff, 3 rate-limit retries). Override only for
  # local debugging; CI should use the defaults.
  [int]$MaxRateLimitRetries     = 3,
  [int]$MaxCircuitRetries       = 2,
  [int[]]$RateLimitBackoffSeconds = @(15, 30, 60)
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$Passed   = 0
$Warnings = 0
$Failures = 0
$Skipped  = 0

$ProviderFindings    = [System.Collections.Generic.List[hashtable]]::new()
$ModelFindings       = [System.Collections.Generic.List[hashtable]]::new()
$GovernanceFindings  = [System.Collections.Generic.List[hashtable]]::new()
$PersistenceFindings = [System.Collections.Generic.List[hashtable]]::new()
$SemanticFindings    = [System.Collections.Generic.List[hashtable]]::new()
$SectionResults      = [System.Collections.Generic.List[hashtable]]::new()

$Timestamp = (Get-Date -Format "yyyy-MM-dd HH:mm:ss UTC")

# Cross-section state (populated in §1, cross-checked in §6 — same pattern V1 used)
$ActiveProviderFromProbe = $null

# Workspace/user override forwarded to POST bodies. Both must be set together
# (the service requires the pair); if only one is set, ignore both and let
# the server fall back to its self-provisioning fixture.
$IdentityOverride = @{}
if ($WorkspaceId -and $UserId) {
  $IdentityOverride = @{ workspaceId = $WorkspaceId; userId = $UserId }
} elseif ($WorkspaceId -or $UserId) {
  Write-Host "  ⚠️  Only one of -WorkspaceId/-UserId was set — ignoring both, using the self-provisioning fixture instead." -ForegroundColor Yellow
}

# ── Helpers ───────────────────────────────────────────────────────────────────

function Pass($msg)  { Write-Host "  ✅ $msg" -ForegroundColor Green;  $script:Passed++ }
function Warn($msg)  { Write-Host "  ⚠️  WARN: $msg" -ForegroundColor Yellow; $script:Warnings++ }
function Fail($msg)  { Write-Host "  ❌ FAIL: $msg" -ForegroundColor Red;    $script:Failures++ }
function Skip($msg)  { Write-Host "  ⏭  SKIP: $msg" -ForegroundColor DarkGray; $script:Skipped++ }
function Section($n, $title) { Write-Host "`n▶ §$n $title" -ForegroundColor Cyan }
function VLog($msg)  { if ($Verbose) { Write-Host "     $msg" -ForegroundColor DarkGray } }

function Start-SectionTracking {
  return @{
    Passed = $script:Passed; Warnings = $script:Warnings; Failures = $script:Failures; Skipped = $script:Skipped
    StartTime = Get-Date
  }
}

# Stop-SectionTracking — Part 4: records the FULL rich per-stage result the
# report needs (status, execution time, retry count, provider, model, root
# cause, recommended action), not just pass/warn/fail/skip counts.
#
# Status rule: FAIL if any failure occurred this section; WARN if any
# warning/skip occurred OR the stage needed at least one retry to succeed
# (Part 1 — a retried-but-eventually-PASSing stage is reported WARN, never a
# silent PASS, so instability is visible); PASS only when the section was
# clean on the first attempt.
function Stop-SectionTracking {
  param(
    [Parameter(Mandatory)] [string]$Name,
    [Parameter(Mandatory)] [hashtable]$Before,
    [int]$RetryCount = 0,
    [string]$Provider = $null,
    [string]$Model = $null,
    [string]$RootCause = $null,
    [string]$RecommendedAction = $null
  )
  $passed  = $script:Passed   - $Before.Passed
  $warned  = $script:Warnings - $Before.Warnings
  $failed  = $script:Failures - $Before.Failures
  $skipped = $script:Skipped  - $Before.Skipped
  $execMs  = [int]((Get-Date) - $Before.StartTime).TotalMilliseconds

  $status = if ($failed -gt 0) { "FAIL" }
            elseif ($warned -gt 0 -or $skipped -gt 0 -or $RetryCount -gt 0) { "WARN" }
            else { "PASS" }

  $script:SectionResults.Add(@{
    Name = $Name; Status = $status
    Passed = $passed; Warned = $warned; Failed = $failed; Skipped = $skipped
    ExecutionMs = $execMs; RetryCount = $RetryCount
    Provider = $Provider; Model = $Model
    RootCause = $RootCause; RecommendedAction = $RecommendedAction
  })
}

# Invoke-API — authenticates with the runtime-verify shared secret, never a
# user/admin bearer token and never a browser cookie. Single attempt — see
# Invoke-APIWithResilience for the retrying wrapper every section actually
# calls.
function Invoke-API {
  param(
    [string]$Method = "GET",
    [string]$Path,
    [hashtable]$Body = $null,
    [int]$TimeoutSec = 180
  )
  $uri = "$($script:BaseUrl)$Path"
  $headers = @{ "x-runtime-verify-secret" = $script:VerifySecret; "Content-Type" = "application/json" }
  try {
    $params = @{
      Uri             = $uri
      Method          = $Method
      Headers         = $headers
      TimeoutSec      = $TimeoutSec
      ErrorAction     = "Stop"
      UseBasicParsing = $true
    }
    if ($Body -and $Method -ne "GET") {
      $params.Body = ($Body | ConvertTo-Json -Depth 10 -Compress)
    }
    $resp = Invoke-WebRequest @params
    return @{ ok = $true; status = $resp.StatusCode; data = ($resp.Content | ConvertFrom-Json -Depth 20) }
  } catch {
    $statusCode = 0
    $errBody    = $null
    if ($_.Exception.Response) {
      $statusCode = [int]$_.Exception.Response.StatusCode
      try {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = [System.IO.StreamReader]::new($stream)
        $errBody = $reader.ReadToEnd() | ConvertFrom-Json -Depth 10 -ErrorAction SilentlyContinue
      } catch {}
    }
    return @{ ok = $false; status = $statusCode; error = $_.Exception.Message; data = $errBody }
  }
}

# Invoke-APIWithResilience — Part 1. Every section calls THIS, not Invoke-API
# directly. Retries are entirely local to this one HTTP call: a retry never
# re-runs any other stage, and never restarts the overall verification run.
#
# Detection is driven by what the server actually told us (errorKind on the
# JSON body — see classifyTransientError() in
# apps/web/lib/internal/runtime-verify-errors.ts), not by guessing from the
# status code alone, though the status code (429/503) is also checked as a
# fallback in case the body didn't parse.
function Invoke-APIWithResilience {
  param(
    [string]$Method = "GET",
    [string]$Path,
    [hashtable]$Body = $null,
    [int]$TimeoutSec = 180,
    [string]$StageName = $Path
  )

  $retryCount = 0
  $lastReason = $null

  while ($true) {
    $resp = Invoke-API -Method $Method -Path $Path -Body $Body -TimeoutSec $TimeoutSec

    if ($resp.ok) {
      return @{ ok = $true; status = $resp.status; data = $resp.data; retryCount = $retryCount; retryReason = $lastReason }
    }

    $errorKind = $resp.data.errorKind
    $isRateLimited  = ($resp.status -eq 429) -or ($errorKind -eq "rate_limited")
    $isCircuitIssue = ($resp.status -eq 503) -and ($errorKind -eq "circuit_open" -or $errorKind -eq "all_providers_failed")

    if ($isRateLimited) {
      if ($retryCount -ge $script:MaxRateLimitRetries) {
        Write-Host "  ⏱  Rate-limited on $StageName — retries exhausted ($retryCount/$($script:MaxRateLimitRetries)), reporting FAIL for this stage only" -ForegroundColor Yellow
        return @{ ok = $false; status = $resp.status; data = $resp.data; retryCount = $retryCount; retryReason = "rate_limited (exhausted)" }
      }
      $waitSeconds = $resp.data.retryAfterSeconds
      if (-not $waitSeconds) {
        $idx = [Math]::Min($retryCount, $script:RateLimitBackoffSeconds.Count - 1)
        $waitSeconds = $script:RateLimitBackoffSeconds[$idx]
        $waitSource = "exponential backoff"
      } else {
        $waitSource = "server-supplied retryAfterSeconds"
      }
      Write-Host "  ⏱  Rate-limited on $StageName — waiting ${waitSeconds}s ($waitSource) before retry $($retryCount + 1)/$($script:MaxRateLimitRetries)..." -ForegroundColor Yellow
      Start-Sleep -Seconds $waitSeconds
      $retryCount++
      $lastReason = "rate_limited"
      continue
    }

    if ($isCircuitIssue) {
      if ($retryCount -ge $script:MaxCircuitRetries) {
        Write-Host "  🔌 $errorKind on $StageName — retries exhausted ($retryCount/$($script:MaxCircuitRetries)), reporting FAIL for this stage only" -ForegroundColor Yellow
        return @{ ok = $false; status = $resp.status; data = $resp.data; retryCount = $retryCount; retryReason = "$errorKind (exhausted)" }
      }
      $resetMs = $resp.data.circuitResetMs
      $waitSeconds = if ($resetMs) { [Math]::Ceiling($resetMs / 1000) } else { 60 }
      Write-Host "  🔌 $errorKind on $StageName — waiting ${waitSeconds}s for the circuit breaker to close before retry $($retryCount + 1)/$($script:MaxCircuitRetries)..." -ForegroundColor Yellow
      Start-Sleep -Seconds $waitSeconds
      $retryCount++
      $lastReason = $errorKind
      continue
    }

    # Not a transient infrastructure condition — a genuine failure (bad
    # request, bug, auth issue downstream, etc.). Report immediately; this
    # is what "Only report FAIL after all retry attempts are exhausted"
    # means for the NON-transient case: there are no attempts to exhaust.
    return @{ ok = $false; status = $resp.status; data = $resp.data; retryCount = $retryCount; retryReason = $lastReason }
  }
}

function Add-ProviderFinding($severity, $title, $detail, $remediation) {
  $script:ProviderFindings.Add(@{ Severity=$severity; Title=$title; Detail=$detail; Remediation=$remediation })
}
function Add-ModelFinding($severity, $title, $detail, $remediation) {
  $script:ModelFindings.Add(@{ Severity=$severity; Title=$title; Detail=$detail; Remediation=$remediation })
}
function Add-GovernanceFinding($severity, $title, $detail, $remediation) {
  $script:GovernanceFindings.Add(@{ Severity=$severity; Title=$title; Detail=$detail; Remediation=$remediation })
}
function Add-PersistenceFinding($severity, $title, $field, $detail, $remediation) {
  $script:PersistenceFindings.Add(@{ Severity=$severity; Title=$title; Field=$field; Detail=$detail; Remediation=$remediation })
}
function Add-SemanticFinding($severity, $title, $detail, $remediation) {
  $script:SemanticFindings.Add(@{ Severity=$severity; Title=$title; Detail=$detail; Remediation=$remediation })
}

function Write-SkippedReports($reason) {
  $ReportsDir = Join-Path $Root "reports"
  New-Item -ItemType Directory -Path $ReportsDir -Force | Out-Null
  foreach ($report in @("runtime-verification", "provider-propagation", "model-propagation", "governance-audit", "persistence-audit", "semantic-verification")) {
    $title = (($report -replace '-',' ') -replace '\b(.)', { $_.Value.ToUpper() })
    $skippedContent = "# $title Report`n`n> Generated: $Timestamp`n> Status: SKIPPED — $reason`n`n## Status`n`nSKIPPED`n"
    Set-Content -Path (Join-Path $ReportsDir "$report.md") -Value $skippedContent -Encoding UTF8
  }
}

# ── §0 Verifier Health Check ─────────────────────────────────────────────────

Write-Host ""
Write-Host "══════════════════════════════════════════════════════════" -ForegroundColor White
Write-Host "  BrandOS Runtime Verification Layer (V2.1)" -ForegroundColor White
Write-Host "  Target: $BaseUrl" -ForegroundColor DarkGray
Write-Host "══════════════════════════════════════════════════════════" -ForegroundColor White

Section "0" "Verifier Health Check"

if (-not $VerifySecret) {
  Write-Host ""
  Write-Host "  ⚠️  BRANDOS_RUNTIME_VERIFY_SECRET is not set in this environment." -ForegroundColor Yellow
  Write-Host "  All runtime checks SKIPPED. Set it once (same as any other CI secret) to enable them." -ForegroundColor Yellow
  Write-Host "  This is WARN (not FAIL) — runtime checks require a configured secret." -ForegroundColor DarkGray

  Write-SkippedReports "BRANDOS_RUNTIME_VERIFY_SECRET not set"

  Write-Host ""
  Write-Host "══════════════════════════════════════════════════════════" -ForegroundColor White
  Write-Host "  Runtime Verification: 0 passed, 0 warned, 0 failed, ALL SKIPPED" -ForegroundColor Yellow
  Write-Host "  Result: WARN" -ForegroundColor Yellow
  Write-Host "══════════════════════════════════════════════════════════" -ForegroundColor White
  exit 2
}

$health0 = Start-SectionTracking

$pingResp = Invoke-API -Method "GET" -Path "/api/internal/runtime-verify/ping" -TimeoutSec 15

if (-not $pingResp.ok -and $pingResp.status -eq 0) {
  Write-Host "  ❌ Cannot reach $BaseUrl (connection failed)" -ForegroundColor Red
  Write-Host "     Ensure apps/web is running before executing runtime verification." -ForegroundColor DarkGray
  exit 1
}

if ($pingResp.status -eq 503) {
  Fail "Server has no BRANDOS_RUNTIME_VERIFY_SECRET configured (503) — set it on the deployment, not just locally"
  Stop-SectionTracking -Name "§0 Verifier Health Check" -Before $health0 -RootCause "Server-side secret not configured" -RecommendedAction "Set BRANDOS_RUNTIME_VERIFY_SECRET on the deployment environment"
  Write-SkippedReports "server-side BRANDOS_RUNTIME_VERIFY_SECRET not configured (deployment misconfiguration)"
  Write-Host ""
  Write-Host "  Result: FAIL" -ForegroundColor Red
  exit 1
}

if ($pingResp.status -eq 401) {
  Fail "Authentication rejected (401) — local secret does not match the server's BRANDOS_RUNTIME_VERIFY_SECRET"
  Stop-SectionTracking -Name "§0 Verifier Health Check" -Before $health0 -RootCause "Secret mismatch" -RecommendedAction "Confirm the verifier's BRANDOS_RUNTIME_VERIFY_SECRET matches the deployment's"
  Write-SkippedReports "secret mismatch between verifier and server"
  Write-Host ""
  Write-Host "  Result: FAIL" -ForegroundColor Red
  exit 1
}

if (-not $pingResp.ok) {
  Fail "Verifier health check failed unexpectedly (HTTP $($pingResp.status))"
  Stop-SectionTracking -Name "§0 Verifier Health Check" -Before $health0 -RootCause "Unexpected HTTP $($pingResp.status) from /ping" -RecommendedAction "Check apps/web server logs"
  Write-SkippedReports "unexpected error from /api/internal/runtime-verify/ping"
  Write-Host ""
  Write-Host "  Result: FAIL" -ForegroundColor Red
  exit 1
}

Pass "Secret accepted — runtime-verify API reachable at $BaseUrl"

$expectedEndpoints = $pingResp.data.endpoints
if (-not $expectedEndpoints -or $expectedEndpoints.Count -eq 0) {
  Warn "ping response did not list expected endpoints — route-existence check skipped"
} else {
  $missingRoutes = @()
  foreach ($ep in $expectedEndpoints) {
    if ($ep -eq "/api/internal/runtime-verify/ping") { continue } # already proven reachable above
    $probe = Invoke-API -Method "GET" -Path $ep -TimeoutSec 10
    # 404 = route not mounted. Anything else (200/401/405/500/502/503) proves
    # the route exists — we are only checking mounting here, not behavior.
    if ($probe.status -eq 404) { $missingRoutes += $ep }
  }
  if ($missingRoutes.Count -eq 0) {
    Pass "All $($expectedEndpoints.Count) runtime-verify routes are mounted"
  } else {
    foreach ($missing in $missingRoutes) {
      Fail "Route not mounted: $missing (404)"
    }
  }
}

Stop-SectionTracking -Name "§0 Verifier Health Check" -Before $health0

$ReportsDir = Join-Path $Root "reports"
New-Item -ItemType Directory -Path $ReportsDir -Force | Out-Null

# ── §1 Provider Verification ──────────────────────────────────────────────────

Section "1" "Provider Verification"
$s1 = Start-SectionTracking
$s1Provider = $null; $s1Model = $null; $s1Retries = 0; $s1RootCause = $null; $s1Action = $null

if ($SkipProviderTests) {
  Skip "Provider verification skipped (--SkipProviderTests)"
} else {
  $provResp = Invoke-APIWithResilience -Method "GET" -Path "/api/internal/runtime-verify/provider" -TimeoutSec 60 -StageName "§1 Provider Verification"
  $s1Retries = $provResp.retryCount

  if (-not $provResp.ok -and -not $provResp.data.trace) {
    Fail "GET /provider failed (HTTP $($provResp.status))$(if ($provResp.retryReason) { " [$($provResp.retryReason)]" })"
    $s1RootCause = if ($provResp.retryReason) { $provResp.retryReason } else { "HTTP $($provResp.status) from /provider" }
    $s1Action = "Check apps/web server logs and AdminSettingsService configuration"
    Add-ProviderFinding "critical" "Provider verification endpoint failed" `
      "GET /api/internal/runtime-verify/provider returned HTTP $($provResp.status) after $s1Retries retr$(if ($s1Retries -eq 1) {'y'} else {'ies'})." `
      "Check apps/web server logs and AdminSettingsService configuration."
  } else {
    $prov = $provResp.data
    $s1Provider = $prov.trace.provider
    $s1Model = $prov.trace.model

    if ($prov.activeProviders.Count -gt 0) {
      Pass "$($prov.activeProviders.Count) active provider(s) resolved"
    } else {
      Fail "No active providers resolved — resolved_config.active_providers is empty"
      $s1RootCause = "No active providers resolved"
      $s1Action = "Check settings-service-supabase.ts wiring and instrumentation.ts boot sequence"
      Add-ProviderFinding "critical" "Runtime config not wired" `
        "No providers are active. The lazy setRuntimeConfigProvider() bridge may not have fired." `
        "Check settings-service-supabase.ts wiring and instrumentation.ts boot sequence."
    }

    if ($prov.trace.provider) {
      Pass "Live probe served by provider: $($prov.trace.provider)"
      $ActiveProviderFromProbe = $prov.trace.provider
    } else {
      Warn "Live probe did not report a provider — propagation cannot be confirmed"
    }

    if ($prov.mismatchedProviders.Count -gt 0) {
      foreach ($mm in $prov.mismatchedProviders) {
        Fail "Provider config mismatch: $($mm.id) (enabled_in_db=$($mm.enabled_in_db), enabled_in_runtime=$($mm.enabled_in_runtime))"
        $s1RootCause = "Provider config mismatch: $($mm.id)"
        $s1Action = "Reload admin settings or restart the runtime to resync"
        Add-ProviderFinding "high" "Provider config mismatch: $($mm.id)" `
          "DB and runtime disagree on whether '$($mm.id)' is enabled." `
          "Reload admin settings or restart the runtime to resync."
      }
    } else {
      Pass "Provider config consistent: DB and runtime agree"
    }

    foreach ($w in $prov.warnings) { Warn "Provider: $w" }

    # Per-provider silent-fallback check — force each active provider and
    # confirm the live probe actually used it (this is the highest-value
    # check carried over from V1 §4.2). Each forced probe also goes through
    # the resilience wrapper so a transient blip on ONE provider doesn't
    # falsely look like a silent-fallback bug.
    foreach ($activeProvider in $prov.activeProviders) {
      $id = $activeProvider.id
      Write-Host "  Forcing provider: $id..." -ForegroundColor DarkGray
      $forced = Invoke-APIWithResilience -Method "GET" -Path "/api/internal/runtime-verify/provider?force=$id" -TimeoutSec 60 -StageName "§1 Provider Verification (force=$id)"
      $s1Retries += $forced.retryCount
      if (-not $forced.ok) {
        Warn "Forced probe for '$id' failed (HTTP $($forced.status))$(if ($forced.retryReason) { " [$($forced.retryReason)]" })"
        continue
      }
      $actual = $forced.data.trace.provider
      if ($actual -eq $id) {
        Pass "Provider '$id': actual provider matches forced selection"
      } elseif ($actual) {
        Fail "Provider propagation FAILURE: forced='$id' actual='$actual' — silent fallback detected"
        $s1RootCause = "Silent fallback: forced='$id' actual='$actual'"
        $s1Action = "Investigate runtime config provider bridge wiring and routingHint.forceProvider handling"
        Add-ProviderFinding "critical" "Provider propagation failure: $id" `
          "Forcing provider '$id' resulted in actual provider '$actual'. Silent fallback occurred." `
          "Investigate runtime config provider bridge wiring and routingHint.forceProvider handling."
      } else {
        Warn "Provider '$id': forced probe did not report an actual provider"
      }
      VLog "  $id -> actual=$actual"
    }
  }
}

Stop-SectionTracking -Name "§1 Provider Verification" -Before $s1 -RetryCount $s1Retries -Provider $s1Provider -Model $s1Model -RootCause $s1RootCause -RecommendedAction $s1Action

# ── §2 Model Verification ─────────────────────────────────────────────────────

Section "2" "Model Verification"
$s2 = Start-SectionTracking
$s2Provider = $null; $s2Model = $null; $s2Retries = 0; $s2RootCause = $null; $s2Action = $null

if ($SkipProviderTests) {
  Skip "Model verification skipped (--SkipProviderTests)"
} else {
  $modelResp = Invoke-APIWithResilience -Method "GET" -Path "/api/internal/runtime-verify/model" -TimeoutSec 60 -StageName "§2 Model Verification"
  $s2Retries = $modelResp.retryCount

  if (-not $modelResp.ok -and -not $modelResp.data.trace) {
    Fail "GET /model failed (HTTP $($modelResp.status))$(if ($modelResp.retryReason) { " [$($modelResp.retryReason)]" })"
    $s2RootCause = if ($modelResp.retryReason) { $modelResp.retryReason } else { "HTTP $($modelResp.status) from /model" }
    $s2Action = "Check apps/web server logs"
    Add-ModelFinding "critical" "Model verification endpoint failed" `
      "GET /api/internal/runtime-verify/model returned HTTP $($modelResp.status)." `
      "Check apps/web server logs."
  } else {
    $model = $modelResp.data
    $s2Provider = $model.trace.provider
    $s2Model = $model.trace.model

    if ($model.propagationOk) {
      Pass "Model propagation OK — configured='$($model.configuredModel)' resolved='$($model.resolvedModel)'"
    } else {
      Fail "Model propagation FAILURE — configured='$($model.configuredModel)' resolved='$($model.resolvedModel)'"
      $s2RootCause = "Model propagation failure: configured='$($model.configuredModel)' resolved='$($model.resolvedModel)'"
      $s2Action = "Verify no out-of-band model defaults exist outside @brandos/runtime-config. Check llmRouter"
      Add-ModelFinding "critical" "Model propagation failure" `
        "Configured model '$($model.configuredModel)' did not propagate — resolved model was '$($model.resolvedModel)'." `
        "Verify no out-of-band model defaults exist outside @brandos/runtime-config. Check llmRouter."
    }

    # Per-active-provider model check (mirrors V1 §4.3 loop)
    if (-not $SkipProviderTests) {
      $provResp2 = Invoke-APIWithResilience -Method "GET" -Path "/api/internal/runtime-verify/provider" -TimeoutSec 60 -StageName "§2 Model Verification (provider lookup)"
      $s2Retries += $provResp2.retryCount
      if ($provResp2.ok) {
        foreach ($p in $provResp2.data.activeProviders) {
          if (-not $p.configuredModel) { continue }
          $forcedModel = Invoke-APIWithResilience -Method "GET" -Path "/api/internal/runtime-verify/model?force=$($p.id)" -TimeoutSec 60 -StageName "§2 Model Verification (force=$($p.id))"
          $s2Retries += $forcedModel.retryCount
          if (-not $forcedModel.ok) { Warn "Model probe for '$($p.id)' failed (HTTP $($forcedModel.status))"; continue }
          $fm = $forcedModel.data
          if ($fm.resolvedModel -eq $p.configuredModel) {
            Pass "Model '$($p.configuredModel)' propagated correctly for provider '$($p.id)'"
          } elseif ($fm.resolvedModel) {
            Warn "Model mismatch for $($p.id): configured='$($p.configuredModel)' actual='$($fm.resolvedModel)' (may be a valid fallback)"
            Add-ModelFinding "low" "Model mismatch (possible fallback): $($p.id)" `
              "Configured model '$($p.configuredModel)' differs from resolved '$($fm.resolvedModel)'." `
              "Verify '$($p.configuredModel)' is a valid model ID for provider '$($p.id)'."
          } else {
            Warn "Model field missing for provider '$($p.id)' — cannot verify propagation"
          }
        }
      }
    }
  }
}

Stop-SectionTracking -Name "§2 Model Verification" -Before $s2 -RetryCount $s2Retries -Provider $s2Provider -Model $s2Model -RootCause $s2RootCause -RecommendedAction $s2Action

# ── §3 Brand Intelligence Verification ────────────────────────────────────────

Section "3" "Brand Intelligence Verification"
$s3 = Start-SectionTracking
$s3Provider = $null; $s3Model = $null; $s3RootCause = $null; $s3Action = $null

$bmBody = $IdentityOverride.Clone()
$bmBody.topic = "BrandOS Memory Verification $(Get-Date -Format 'yyyyMMdd-HHmmss')"

Write-Host "  Running Brand Memory ON + OFF generations (this may take 20–60s)..." -ForegroundColor DarkGray
$bmResp = Invoke-APIWithResilience -Method "POST" -Path "/api/internal/runtime-verify/brand-memory" -Body $bmBody -TimeoutSec 180 -StageName "§3 Brand Intelligence Verification"
$s3Retries = $bmResp.retryCount

if (-not $bmResp.ok -and -not $bmResp.data.onPath) {
  Fail "POST /brand-memory failed (HTTP $($bmResp.status))$(if ($bmResp.retryReason) { " [$($bmResp.retryReason)]" })"
  $s3RootCause = if ($bmResp.retryReason) { $bmResp.retryReason } else { "HTTP $($bmResp.status) from /brand-memory" }
  $s3Action = "Check apps/web server logs and CPL brand-memory proxy wiring"
  Add-GovernanceFinding "critical" "Brand Intelligence verification endpoint failed" `
    "POST /api/internal/runtime-verify/brand-memory returned HTTP $($bmResp.status)." `
    "Check apps/web server logs and CPL brand-memory proxy wiring."
} else {
  $bm = $bmResp.data
  $s3Provider = $bm.onPath.trace.provider
  $s3Model = $bm.onPath.trace.model

  if ($bm.offPath.accepted) { Pass "Brand Memory OFF path: generation accepted" }
  else {
    Fail "Brand Memory OFF path rejected: $($bm.offPath.rejection.reason)"
    $s3RootCause = "Brand Memory OFF path rejected: $($bm.offPath.rejection.reason)"
    $s3Action = "Investigate governance behavior with apply_brand_memory=false"
    Add-GovernanceFinding "high" "Brand Memory OFF path rejected" `
      "$($bm.offPath.rejection.reason)" "Investigate governance behavior with apply_brand_memory=false."
  }

  if ($bm.onPath.accepted) { Pass "Brand Memory ON path: generation accepted" }
  else {
    Fail "Brand Memory ON path rejected: $($bm.onPath.rejection.reason)"
    $s3RootCause = "Brand Memory ON path rejected: $($bm.onPath.rejection.reason)"
    $s3Action = "Investigate governance behavior with apply_brand_memory=true"
    Add-GovernanceFinding "high" "Brand Memory ON path rejected" `
      "$($bm.onPath.rejection.reason)" "Investigate governance behavior with apply_brand_memory=true."
  }

  if ($bm.identityContribution) {
    $ic = $bm.identityContribution
    Pass "Identity contribution generated ($($ic.identityVersion), confidence=$($ic.confidence))"
    if ($ic.hasSubstantialIdentity) {
      Pass "Semantic identity propagation confirmed (hasSubstantialIdentity=true)"
    } else {
      Warn "No substantial identity yet — expected for a fresh fixture/workspace with no brand signals"
    }
    if ($ic.styleProjectionPresent) {
      Pass "Style projection generated"
    } else {
      Warn "Style projection absent — expected when there is insufficient signal data"
    }
  } elseif ($bm.cognitionError) {
    Warn "Brand cognition context unavailable: $($bm.cognitionError)"
  }

  VLog "onPath trace: $($bm.onPath.trace | ConvertTo-Json -Depth 4 -Compress)"
  VLog "offPath trace: $($bm.offPath.trace | ConvertTo-Json -Depth 4 -Compress)"
}

Stop-SectionTracking -Name "§3 Brand Intelligence Verification" -Before $s3 -RetryCount $s3Retries -Provider $s3Provider -Model $s3Model -RootCause $s3RootCause -RecommendedAction $s3Action

# ── §4 Governance Verification ────────────────────────────────────────────────

Section "4" "Governance Verification"
$s4 = Start-SectionTracking
$s4Provider = $null; $s4Model = $null; $s4RootCause = $null; $s4Action = $null

if ($SkipGovernanceTests) {
  Skip "Governance verification skipped (--SkipGovernanceTests)"
  Stop-SectionTracking -Name "§4 Governance Verification" -Before $s4
} else {
  $govBody = $IdentityOverride.Clone()
  Write-Host "  Running clean + adversarial generations through governance..." -ForegroundColor DarkGray
  $govResp = Invoke-APIWithResilience -Method "POST" -Path "/api/internal/runtime-verify/governance" -Body $govBody -TimeoutSec 180 -StageName "§4 Governance Verification"
  $s4Retries = $govResp.retryCount

  if (-not $govResp.ok -and -not $govResp.data.clean) {
    Fail "POST /governance failed (HTTP $($govResp.status))$(if ($govResp.retryReason) { " [$($govResp.retryReason)]" })"
    $s4RootCause = if ($govResp.retryReason) { $govResp.retryReason } else { "HTTP $($govResp.status) from /governance" }
    $s4Action = "Check apps/web server logs and the artifact pipeline"
    Add-GovernanceFinding "critical" "Governance verification endpoint failed" `
      "POST /api/internal/runtime-verify/governance returned HTTP $($govResp.status)." `
      "Check apps/web server logs and the artifact pipeline."
  } else {
    $gov = $govResp.data
    $s4Provider = $gov.clean.trace.provider
    $s4Model = $gov.clean.trace.model

    if ($gov.clean.withinRepairCeiling) {
      Pass "Clean generation: repair attempts within ceiling ($($gov.clean.repairAttempts) ≤ $($gov.maxRepairAttempts))"
    } else {
      Fail "Clean generation EXCEEDED repair ceiling: $($gov.clean.repairAttempts) > $($gov.maxRepairAttempts)"
      $s4RootCause = "Repair ceiling exceeded on clean path: $($gov.clean.repairAttempts) > $($gov.maxRepairAttempts)"
      $s4Action = "Investigate the repair loop's while-condition in artifact-engine-layer/src/engine.ts"
      Add-GovernanceFinding "critical" "Governance repair ceiling exceeded (clean path)" `
        "Clean-prompt generation recorded $($gov.clean.repairAttempts) repair attempts; ceiling is $($gov.maxRepairAttempts)." `
        "Investigate the repair loop's while-condition in artifact-engine-layer/src/engine.ts."
    }

    if ($gov.adversarial.withinRepairCeiling) {
      Pass "Adversarial generation: repair attempts within ceiling ($($gov.adversarial.repairAttempts) ≤ $($gov.maxRepairAttempts))"
    } else {
      Fail "Adversarial generation EXCEEDED repair ceiling: $($gov.adversarial.repairAttempts) > $($gov.maxRepairAttempts)"
      $s4RootCause = "Repair ceiling exceeded on adversarial path: $($gov.adversarial.repairAttempts) > $($gov.maxRepairAttempts)"
      $s4Action = "Investigate the repair loop's while-condition in artifact-engine-layer/src/engine.ts"
      Add-GovernanceFinding "critical" "Governance repair ceiling exceeded (adversarial path)" `
        "Adversarial-prompt generation recorded $($gov.adversarial.repairAttempts) repair attempts; ceiling is $($gov.maxRepairAttempts)." `
        "Investigate the repair loop's while-condition in artifact-engine-layer/src/engine.ts."
    }

    if (-not $gov.adversarial.accepted) {
      Pass "Governance rejection path reachable: degenerate prompt was rejected after $($gov.adversarial.repairAttempts) repair attempt(s)"
    } else {
      Warn "Adversarial prompt was accepted — governance may not be enforced for minimal content (expected if thresholds allow short content)"
    }

    if ($gov.clean.accepted) {
      Pass "Clean generation accepted (score threshold met: $($gov.clean.scoreMeetsThreshold))"
    } else {
      Warn "Clean generation was rejected — threshold ($($gov.governanceScoreThreshold0to100)/100) may be set unexpectedly high"
    }

    VLog "threshold=$($gov.governanceScoreThreshold0to100)/100 clean.score-meets-threshold=$($gov.clean.scoreMeetsThreshold) adversarial.score-meets-threshold=$($gov.adversarial.scoreMeetsThreshold)"
  }

  Stop-SectionTracking -Name "§4 Governance Verification" -Before $s4 -RetryCount $s4Retries -Provider $s4Provider -Model $s4Model -RootCause $s4RootCause -RecommendedAction $s4Action
}

# ── §5 Persistence Verification ───────────────────────────────────────────────

Section "5" "Persistence Verification"
$s5 = Start-SectionTracking
$s5Provider = $null; $s5Model = $null; $s5RootCause = $null; $s5Action = $null

$persistBody = $IdentityOverride.Clone()
$persistResp = Invoke-APIWithResilience -Method "POST" -Path "/api/internal/runtime-verify/persistence" -Body $persistBody -TimeoutSec 180 -StageName "§5 Persistence Verification"
$s5Retries = $persistResp.retryCount

if (-not $persistResp.ok -and -not $persistResp.data.trace) {
  Fail "POST /persistence failed (HTTP $($persistResp.status))$(if ($persistResp.retryReason) { " [$($persistResp.retryReason)]" })"
  $s5RootCause = if ($persistResp.retryReason) { $persistResp.retryReason } else { "HTTP $($persistResp.status) from /persistence" }
  $s5Action = "Check apps/web server logs and the campaigns table RLS policy for the service-role client"
  Add-PersistenceFinding "critical" "Persistence verification endpoint failed" "endpoint" `
    "POST /api/internal/runtime-verify/persistence returned HTTP $($persistResp.status)." `
    "Check apps/web server logs and the campaigns table RLS policy for the service-role client."
} else {
  $persist = $persistResp.data
  $s5Provider = $persist.trace.provider
  $s5Model = $persist.trace.model

  if ($persist.persisted) { Pass "Artifact persisted (campaignId=$($persist.campaignId))" }
  else {
    Fail "Artifact persistence FAILED: $($persist.error)"
    $s5RootCause = "Artifact persistence failed: $($persist.error)"
    $s5Action = "Check Supabase RLS policies and the campaigns insert path"
    Add-PersistenceFinding "high" "Artifact did not persist" "campaigns.insert" `
      "$($persist.error)" "Check Supabase RLS policies and the campaigns insert path."
  }

  if ($persist.readBackOk) { Pass "Persisted row read back correctly" }
  elseif ($persist.persisted) {
    Fail "Persisted row failed read-back verification"
    $s5RootCause = "Read-back mismatch on persisted campaign row"
    $s5Action = "Verify the insert payload matches what executeArtifactPipeline()/runControlPlane() actually returned"
    Add-PersistenceFinding "high" "Read-back mismatch" "campaigns.qa_score_after / workspace_id" `
      "The persisted campaign row did not read back with the expected metadata." `
      "Verify the insert payload matches what executeArtifactPipeline() / runControlPlane() actually returned."
  }

  if ($persist.providerMetadataOk) { Pass "Provider metadata present (resolvedProvider)" }
  else {
    Fail "Provider metadata missing from generation response"
    $s5RootCause = "resolvedProvider missing from generation response"
    $s5Action = "Verify Phase 5 resolvedProvider wiring in run-control-plane.ts"
    Add-PersistenceFinding "high" "Provider metadata absent" "resolvedProvider" `
      "cpResponse.resolvedProvider was empty." "Verify Phase 5 resolvedProvider wiring in run-control-plane.ts."
  }

  if ($persist.modelMetadataOk) { Pass "Model metadata present (resolvedModel)" }
  else {
    Fail "Model metadata missing from generation response"
    $s5RootCause = "resolvedModel missing from generation response"
    $s5Action = "Verify Phase 5 resolvedModel wiring in run-control-plane.ts"
    Add-PersistenceFinding "high" "Model metadata absent" "resolvedModel" `
      "cpResponse.resolvedModel was empty." "Verify Phase 5 resolvedModel wiring in run-control-plane.ts."
  }

  if ($persist.governanceMetadataOk) { Pass "Governance metadata present (quality.score)" }
  else {
    Fail "Governance metadata missing from generation response"
    $s5RootCause = "quality.score missing from generation response"
    $s5Action = "Verify governance evaluation always populates quality.score"
    Add-PersistenceFinding "high" "Governance metadata absent" "quality.score" `
      "cpResponse.quality.score was not a number." "Verify governance evaluation always populates quality.score."
  }
}

Stop-SectionTracking -Name "§5 Persistence Verification" -Before $s5 -RetryCount $s5Retries -Provider $s5Provider -Model $s5Model -RootCause $s5RootCause -RecommendedAction $s5Action

# ── §6 Runtime Diagnostics ─────────────────────────────────────────────────────

Section "6" "Runtime Diagnostics"
$s6 = Start-SectionTracking
$s6Provider = $null; $s6Model = $null; $s6RootCause = $null; $s6Action = $null

$diagResp = Invoke-APIWithResilience -Method "GET" -Path "/api/internal/runtime-verify/diagnostics" -TimeoutSec 60 -StageName "§6 Runtime Diagnostics"
$s6Retries = $diagResp.retryCount

if (-not $diagResp.ok -and -not $diagResp.data.trace) {
  Fail "GET /diagnostics failed (HTTP $($diagResp.status))$(if ($diagResp.retryReason) { " [$($diagResp.retryReason)]" })"
  $s6RootCause = if ($diagResp.retryReason) { $diagResp.retryReason } else { "HTTP $($diagResp.status) from /diagnostics" }
  $s6Action = "Check apps/web server logs"
  Add-ProviderFinding "high" "Diagnostics endpoint failed" `
    "GET /api/internal/runtime-verify/diagnostics returned HTTP $($diagResp.status)." `
    "Check apps/web server logs."
} else {
  $diag = $diagResp.data
  $s6Provider = $diag.trace.provider
  $s6Model = $diag.trace.model

  if ($diag.healthy) { Pass "Runtime reports healthy" }
  else {
    Fail "Runtime reports unhealthy"
    $s6RootCause = "Diagnostics snapshot reports unhealthy"
    $s6Action = "Review reports/provider-propagation.md and reports/model-propagation.md for the underlying cause"
    foreach ($w in $diag.warnings) {
      Add-ProviderFinding "medium" "Diagnostics warning" $w "Investigate the condition described."
    }
  }

  if ($ActiveProviderFromProbe -and $diag.trace.provider -and $diag.trace.provider -ne $ActiveProviderFromProbe) {
    Warn "Diagnostics provider ($($diag.trace.provider)) differs from §1 propagation result ($ActiveProviderFromProbe)"
  }

  foreach ($w in $diag.warnings) { Warn "Diagnostics warning: $w" }

  # Part 3 — surface the trace validation this endpoint already ran.
  if ($diag.traceValidation) {
    $tv = $diag.traceValidation
    $tvFails = @($tv.issues | Where-Object { $_.severity -eq "fail" })
    if ($tvFails.Count -gt 0) {
      foreach ($issue in $tvFails) { Fail "RuntimeTrace inconsistency: $($issue.message)" }
      $s6RootCause = "$($tvFails.Count) RuntimeTrace inconsistenc(y/ies) on the diagnostics trace"
      $s6Action = "See reports/runtime-verification.md trace-validation detail"
    } elseif ($tv.issues.Count -gt 0) {
      Warn "RuntimeTrace: $($tv.issues.Count) field(s) not populated on the diagnostics trace ($(($tv.issues | ForEach-Object { $_.field }) -join ', '))"
    } else {
      Pass "RuntimeTrace is complete and internally consistent"
    }
  }

  VLog "diagnostics trace: $($diag.trace | ConvertTo-Json -Depth 4 -Compress)"
}

Stop-SectionTracking -Name "§6 Runtime Diagnostics" -Before $s6 -RetryCount $s6Retries -Provider $s6Provider -Model $s6Model -RootCause $s6RootCause -RecommendedAction $s6Action

# ── §7 Semantic Verification ──────────────────────────────────────────────────
# Runs after Persistence — inspects the actual generated artifact and
# runtime metadata, not just HTTP status codes. See verifySemantic() in
# apps/web/lib/internal/runtime-verify-service.ts for the full methodology
# (canary-injection for subjective qualities, deterministic checks for
# everything structurally verifiable).

Section "7" "Semantic Verification"
$s7 = Start-SectionTracking
$s7Provider = $null; $s7Model = $null; $s7RootCause = $null; $s7Action = $null

if ($SkipSemanticTests) {
  Skip "Semantic verification skipped (--SkipSemanticTests)"
  Stop-SectionTracking -Name "§7 Semantic Verification" -Before $s7
} else {
  $semBody = $IdentityOverride.Clone()
  Write-Host "  Running canary-tagged generation + inspecting the artifact (this may take 20–60s)..." -ForegroundColor DarkGray
  $semResp = Invoke-APIWithResilience -Method "POST" -Path "/api/internal/runtime-verify/semantic" -Body $semBody -TimeoutSec 180 -StageName "§7 Semantic Verification"
  $s7Retries = $semResp.retryCount

  if (-not $semResp.ok -and -not $semResp.data.trace) {
    Fail "POST /semantic failed (HTTP $($semResp.status))$(if ($semResp.retryReason) { " [$($semResp.retryReason)]" })"
    $s7RootCause = if ($semResp.retryReason) { $semResp.retryReason } else { "HTTP $($semResp.status) from /semantic" }
    $s7Action = "Check apps/web server logs"
    Add-SemanticFinding "critical" "Semantic verification endpoint failed" `
      "POST /api/internal/runtime-verify/semantic returned HTTP $($semResp.status)." `
      "Check apps/web server logs."
  } else {
    $sem = $semResp.data
    $s7Provider = $sem.trace.provider
    $s7Model = $sem.trace.model

    foreach ($check in $sem.checks) {
      switch ($check.status) {
        "pass" { Pass "$($check.name): $($check.detail)" }
        "warn" {
          Warn "$($check.name): $($check.detail)"
          Add-SemanticFinding "low" $check.name $check.detail "Review — likely a heuristic proxy miss, not a confirmed defect."
        }
        "fail" {
          Fail "$($check.name): $($check.detail)"
          if (-not $s7RootCause) { $s7RootCause = "$($check.name): $($check.detail)" }
          $s7Action = "See reports/semantic-verification.md for remediation guidance"
          Add-SemanticFinding "high" $check.name $check.detail "Investigate — this check is deterministic, not heuristic; a FAIL here is a confirmed structural defect."
        }
      }
    }
  }

  Stop-SectionTracking -Name "§7 Semantic Verification" -Before $s7 -RetryCount $s7Retries -Provider $s7Provider -Model $s7Model -RootCause $s7RootCause -RecommendedAction $s7Action
}

# ── Scoring (Part 4) ─────────────────────────────────────────────────────────
#
# Per-stage score: PASS=100, WARN=60, FAIL=0. SKIP is excluded from the
# average (a deliberately-skipped check neither helps nor hurts the score).
#
# Category membership (documented here, not hidden):
#   Infrastructure Health = §0 + §1 + §2 + §6  (is the platform reachable
#                                                and correctly configured?)
#   Runtime Health         = §3 + §4 + §5       (does the real generation
#                                                pipeline execute correctly?)
#   Semantic Health         = §7                (is the OUTPUT correct?)
#
# Readiness = weighted average of the three category scores:
#   Infrastructure 25% · Runtime 40% · Semantic 35%
# A category with zero non-skipped stages is excluded and the remaining
# weights are renormalized to sum to 1 (documented, not silently dropped).
#
# Release recommendation is a STRICT rule over section statuses, not a score
# threshold (no fabricated cutoff number): any FAIL → NOT READY; else any
# WARN → READY WITH WARNINGS; else → READY. The four scores are reported
# alongside this as supplementary diagnostic detail.

function Get-StageScore($status) {
  switch ($status) {
    "PASS" { return 100 }
    "WARN" { return 60 }
    "FAIL" { return 0 }
    default { return $null } # SKIP
  }
}

function Get-CategoryScore($sectionNames) {
  $scores = @()
  foreach ($name in $sectionNames) {
    $section = $SectionResults | Where-Object { $_.Name -eq $name } | Select-Object -First 1
    if ($section) {
      $score = Get-StageScore $section.Status
      if ($null -ne $score) { $scores += $score }
    }
  }
  if ($scores.Count -eq 0) { return $null }
  return [Math]::Round(($scores | Measure-Object -Average).Average, 1)
}

$InfrastructureSections = @("§0 Verifier Health Check", "§1 Provider Verification", "§2 Model Verification", "§6 Runtime Diagnostics")
$RuntimeSections         = @("§3 Brand Intelligence Verification", "§4 Governance Verification", "§5 Persistence Verification")
$SemanticSections        = @("§7 Semantic Verification")

$InfrastructureScore = Get-CategoryScore $InfrastructureSections
$RuntimeScore        = Get-CategoryScore $RuntimeSections
$SemanticScore       = Get-CategoryScore $SemanticSections

$weightedSum = 0.0
$weightTotal = 0.0
if ($null -ne $InfrastructureScore) { $weightedSum += $InfrastructureScore * 0.25; $weightTotal += 0.25 }
if ($null -ne $RuntimeScore)        { $weightedSum += $RuntimeScore        * 0.40; $weightTotal += 0.40 }
if ($null -ne $SemanticScore)       { $weightedSum += $SemanticScore       * 0.35; $weightTotal += 0.35 }
$ReadinessScore = if ($weightTotal -gt 0) { [Math]::Round($weightedSum / $weightTotal, 1) } else { $null }

$anyFail = @($SectionResults | Where-Object { $_.Status -eq "FAIL" }).Count -gt 0
$anyWarn = @($SectionResults | Where-Object { $_.Status -eq "WARN" }).Count -gt 0
$ReleaseRecommendation = if ($anyFail) { "NOT READY" } elseif ($anyWarn) { "READY WITH WARNINGS" } else { "READY" }

# ── Generate reports ──────────────────────────────────────────────────────────

function Write-FindingsReport($path, $title, $script, $findings) {
  $critical = ($findings | Where-Object { $_.Severity -eq 'critical' }).Count
  $high     = ($findings | Where-Object { $_.Severity -eq 'high'     }).Count
  $medium   = ($findings | Where-Object { $_.Severity -eq 'medium'   }).Count
  $low      = ($findings | Where-Object { $_.Severity -eq 'low'      }).Count

  $status = if ($critical -gt 0 -or $high -gt 0) { "FAIL" } elseif ($medium -gt 0 -or $low -gt 0) { "WARN" } else { "PASS" }

  $report = @"
# $title

> Generated: $Timestamp
> Verification layer: Runtime Verification V2.1 (platform-runtime-verify.ps1)
> Script: $script

## Summary

| Severity | Count |
|---|---|
| Critical | $critical |
| High | $high |
| Medium | $medium |
| Low | $low |

## Findings

"@
  if ($findings.Count -eq 0) {
    $report += "No findings. All tests passed.`n"
  }
  $n = 1
  foreach ($f in $findings) {
    $report += @"

### Finding $n`: $($f.Title)
- **Severity:** $($f.Severity)
- **Detail:** $($f.Detail)
- **Recommended remediation:** $($f.Remediation)

"@
    $n++
  }
  $report += "`n## Status`n`n$status`n"
  Set-Content -Path $path -Value $report -Encoding UTF8
  Write-Host "  📄 $($path | Split-Path -Leaf) written" -ForegroundColor DarkCyan
}

function Write-MasterReport($path, $sections, $overallStatus) {
  $report = @"
# Runtime Verification Report

> Generated: $Timestamp
> Target: $BaseUrl
> Verification layer: Runtime Verification V2.1 (scripts/platform-runtime-verify.ps1)
> Auth model: x-runtime-verify-secret (Internal Verification API) — no tokens, no cookies, no manual workspace lookup

## Section Results

| Section | Status | Exec Time | Retries | Provider | Model | Root Cause | Recommended Action |
|---|---|---|---|---|---|---|---|
"@
  foreach ($s in $sections) {
    $execStr  = "$($s.ExecutionMs) ms"
    $provStr  = if ($s.Provider) { $s.Provider } else { "—" }
    $modelStr = if ($s.Model) { $s.Model } else { "—" }
    $rcStr    = if ($s.RootCause) { $s.RootCause } else { "—" }
    $actStr   = if ($s.RecommendedAction) { $s.RecommendedAction } else { "—" }
    $report += "`n| $($s.Name) | $($s.Status) | $execStr | $($s.RetryCount) | $provStr | $modelStr | $rcStr | $actStr |"
  }

  $report += @"


## Pass/Warn/Fail/Skip Detail

| Section | Passed | Warned | Failed | Skipped |
|---|---|---|---|---|
"@
  foreach ($s in $sections) {
    $report += "`n| $($s.Name) | $($s.Passed) | $($s.Warned) | $($s.Failed) | $($s.Skipped) |"
  }

  $report += @"


## Health Scores

Per-stage score: PASS=100, WARN=60, FAIL=0 (SKIP excluded from the average).
Category membership: Infrastructure = §0+§1+§2+§6 · Runtime = §3+§4+§5 · Semantic = §7.
Readiness = Infrastructure×25% + Runtime×40% + Semantic×35% (renormalized if a category has no non-skipped stages).

| Score | Value |
|---|---|
| Infrastructure Health | $(if ($null -ne $InfrastructureScore) { "$InfrastructureScore / 100" } else { "N/A (all stages skipped)" }) |
| Runtime Health | $(if ($null -ne $RuntimeScore) { "$RuntimeScore / 100" } else { "N/A (all stages skipped)" }) |
| Semantic Health | $(if ($null -ne $SemanticScore) { "$SemanticScore / 100" } else { "N/A (all stages skipped)" }) |
| **Readiness** | $(if ($null -ne $ReadinessScore) { "**$ReadinessScore / 100**" } else { "**N/A**" }) |

## Release Recommendation

**$ReleaseRecommendation**

Rule: any stage FAIL → NOT READY; else any stage WARN → READY WITH WARNINGS; else → READY.
(A strict rule over stage status, not a score threshold — the scores above are supplementary diagnostic detail.)

## Detailed Reports

- [Provider Propagation](provider-propagation.md)
- [Model Propagation](model-propagation.md)
- [Governance Audit](governance-audit.md)
- [Persistence Audit](persistence-audit.md)
- [Semantic Verification](semantic-verification.md)

## Overall Result

$overallStatus
"@
  Set-Content -Path $path -Value $report -Encoding UTF8
  Write-Host "  📄 $($path | Split-Path -Leaf) written" -ForegroundColor DarkCyan
}

Write-Host ""
Section "" "Generating Reports"

Write-FindingsReport `
  (Join-Path $ReportsDir "provider-propagation.md") `
  "Provider Propagation Report" `
  "scripts/platform-runtime-verify.ps1" `
  $ProviderFindings

Write-FindingsReport `
  (Join-Path $ReportsDir "model-propagation.md") `
  "Model Propagation Report" `
  "scripts/platform-runtime-verify.ps1" `
  $ModelFindings

Write-FindingsReport `
  (Join-Path $ReportsDir "governance-audit.md") `
  "Governance Audit Report" `
  "scripts/platform-runtime-verify.ps1" `
  $GovernanceFindings

Write-FindingsReport `
  (Join-Path $ReportsDir "persistence-audit.md") `
  "Persistence Audit Report" `
  "scripts/platform-runtime-verify.ps1" `
  $PersistenceFindings

Write-FindingsReport `
  (Join-Path $ReportsDir "semantic-verification.md") `
  "Semantic Verification Report" `
  "scripts/platform-runtime-verify.ps1" `
  $SemanticFindings

$overallStatus = if ($Failures -gt 0) { "FAIL" } elseif ($Warnings -gt 0 -or $Skipped -gt 0) { "WARN" } else { "PASS" }

Write-MasterReport `
  (Join-Path $ReportsDir "runtime-verification.md") `
  $SectionResults `
  $overallStatus

# ── Summary ───────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "══════════════════════════════════════════════════════════" -ForegroundColor White
$color = if ($Failures -gt 0) { "Red" } elseif ($Warnings -gt 0) { "Yellow" } else { "Green" }
Write-Host ("  Runtime Verification: {0} passed, {1} warned, {2} failed, {3} skipped" -f `
  $Passed, $Warnings, $Failures, $Skipped) -ForegroundColor $color
Write-Host ("  Readiness: {0}   Recommendation: {1}" -f `
  $(if ($null -ne $ReadinessScore) { "$ReadinessScore/100" } else { "N/A" }), $ReleaseRecommendation) -ForegroundColor $color
Write-Host "══════════════════════════════════════════════════════════" -ForegroundColor White

if ($Failures -gt 0) {
  Write-Host "  Result: FAIL" -ForegroundColor Red
  exit 1
} elseif ($Warnings -gt 0 -or $Skipped -gt 0) {
  Write-Host "  Result: WARN" -ForegroundColor Yellow
  exit 2
} else {
  Write-Host "  Result: PASS" -ForegroundColor Green
  exit 0
}
