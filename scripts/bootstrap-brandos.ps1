# scripts/bootstrap-brandos.ps1
#
# BrandOS AI-Native Orchestration Bootstrap — v3
#
# PHILOSOPHY:
#   Package-aware, context-minimizing, agent-oriented.
#   Three operating modes:
#
#   1. FULL    — full platform bootstrap (default dev onboarding)
#   2. PACKAGE — bootstrap and validate a single bounded context
#   3. AGENT   — generate minimal AI agent context manifest for one package
#
# USAGE:
#   .\scripts\bootstrap-brandos.ps1
#   .\scripts\bootstrap-brandos.ps1 -Mode Package -Package @brandos/control-plane-layer
#   .\scripts\bootstrap-brandos.ps1 -Mode Agent   -Package @brandos/governance-layer
#   .\scripts\bootstrap-brandos.ps1 -Mode Full -SkipBuild
#
# v2 changes:
#   - Dot-sources shared/preflight.ps1 (removes duplicated Assert-Pnpm, Invoke-PreFlight)
#   - $PackageGraph sourced from shared/package-registry.mjs at runtime — no local copy
#     (fixes identity-layer → brand-intelligence; adds L3a config packages)
#
# v3 changes (P4.1 — Bootstrap Modernization, follow-on to P3.5 Agenticity):
#   - Mode AGENT now prefers the P3.5 generated architecture-intelligence layer
#     (.context/agent_entrypoints.generated.md, architecture_graph.generated.json,
#     dependency_impact.generated.json, behavior_contracts.generated.json,
#     runtime_trace.generated.md) instead of recomputing the same facts from
#     $PackageGraph/$pkgInfo. Each field falls back independently to the original
#     v2 source-reconstruction logic if its generated artifact is missing or
#     doesn't (yet) cover the requested package — see Build-AgentManifest.
#   - FULL and PACKAGE modes are unchanged from v2.
#   - Writes a machine-readable manifest to .agent/manifest-<pkg-slug>.json,
#     matching the existing convention in setup-artifact-workspace.ps1 /
#     setup-runtime-workspace.ps1 (.agent/AGENT_MANIFEST.json), so any future
#     agent/tooling can consume the manifest as a file, not just console text.

param(
  [ValidateSet("Full", "Package", "Agent")]
  [string]$Mode = "Full",

  [string]$Package = "",          # Required for Package/Agent mode
  [switch]$SkipInstall,
  [switch]$SkipBuild,
  [switch]$SkipValidation,
  [switch]$Verbose
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$script:AccentColor = "Magenta"
. "$PSScriptRoot\shared\preflight.ps1"

function Log($msg)     { Write-Host "[bootstrap] $msg" -ForegroundColor Cyan }
function Ok($msg)      { Write-Host "[bootstrap] ✅ $msg" -ForegroundColor Green }
function Warn($msg)    { Write-Host "[bootstrap] ⚠️  $msg" -ForegroundColor Yellow }
function Err($msg)     { Write-Host "[bootstrap] ❌ $msg" -ForegroundColor Red; exit 1 }
function Section($msg) { Write-Host "`n[bootstrap] ═══ $msg ═══" -ForegroundColor Magenta }

# ── Package graph — loaded from canonical registry ─────────────────────────
# Each entry: { name, layer, dir, deps[] }

function Load-PackageGraph {
  $json = node --input-type=module --eval @"
import { KNOWN_PACKAGES, LAYER_INDEX } from './scripts/shared/package-registry.mjs';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const graph = KNOWN_PACKAGES.map(p => {
  const pkgJson = join(p.dir, 'package.json');
  let deps = [];
  if (existsSync(pkgJson)) {
    const pkg = JSON.parse(readFileSync(pkgJson, 'utf-8'));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    deps = Object.keys(allDeps).filter(k => k.startsWith('@brandos/'));
  }
  return { name: p.name, layer: LAYER_INDEX[p.name] ?? 0, dir: p.dir, deps };
});

process.stdout.write(JSON.stringify(graph));
"@
  return $json | ConvertFrom-Json
}

$PackageGraph = Load-PackageGraph

function Get-PackageInfo($name) {
  return $PackageGraph | Where-Object { $_.name -eq $name } | Select-Object -First 1
}

function Get-DepChain($name) {
  $visited = @{}
  $chain   = [System.Collections.ArrayList]::new()

  function Visit($n) {
    if ($visited[$n]) { return }
    $visited[$n] = $true
    $info = Get-PackageInfo $n
    if ($null -eq $info) { return }
    foreach ($dep in $info.deps) { Visit $dep }
    $null = $chain.Add($info)
  }

  Visit $name
  return $chain
}

# ── MODE: FULL bootstrap ───────────────────────────────────────────────────

function Invoke-FullBootstrap {
  Section "Full Platform Bootstrap"
  Log "Mode: FULL — installing, building, validating entire platform"

  Invoke-PnpmInstall -Skip:$SkipInstall

  if (-not $SkipValidation) {
    Log "Validating workspace..."
    node scripts/check-workspace.mjs
    if ($LASTEXITCODE -ne 0) { Err "Workspace validation failed" }

    Log "Checking boundaries..."
    node scripts/check-boundaries.mjs
    if ($LASTEXITCODE -ne 0) { Err "Boundary violations found" }
  }

  if (-not $SkipBuild) {
    Log "Building all packages (turbo)..."
    pnpm build
    if ($LASTEXITCODE -ne 0) { Err "Build failed" }
    Ok "All packages built"
  }

  if (-not $SkipValidation) {
    Log "Validating exports..."
    node scripts/check-exports.mjs
    if ($LASTEXITCODE -ne 0) { Err "Export validation failed" }

    Log "Checking route boundaries..."
    node scripts/check-route-boundaries.mjs
    if ($LASTEXITCODE -ne 0) { Err "Route boundary violations found" }
  }

  if (Test-Path "apps/web/.env.local") { Ok ".env.local found" }
  else { Warn ".env.local not found — copy apps/web/.env.local.template and configure" }

  Write-Host ""
  Write-Host "══════════════════════════════════════════" -ForegroundColor Green
  Write-Host " ✅ BrandOS Platform Ready" -ForegroundColor Green
  Write-Host "   Start dev: pnpm dev" -ForegroundColor Green
  Write-Host "══════════════════════════════════════════" -ForegroundColor Green
}

# ── MODE: PACKAGE bootstrap ────────────────────────────────────────────────

function Invoke-PackageBootstrap($pkgName) {
  if (-not $pkgName) { Err "Package mode requires -Package @brandos/package-name" }

  $pkgInfo = Get-PackageInfo $pkgName
  if ($null -eq $pkgInfo) { Err "Unknown package: $pkgName. Check shared/package-registry.mjs." }

  Section "Package Bootstrap: $pkgName (L$($pkgInfo.layer))"
  Log "Building this package and its dependency chain only"

  $chain = Get-DepChain $pkgName
  Log "Dependency chain ($($chain.Count) packages):"
  foreach ($p in $chain) { Log "  L$($p.layer) $($p.name)" }

  Invoke-PnpmInstall -Skip:$SkipInstall -Context "package-scoped"

  if (-not $SkipBuild) {
    foreach ($p in $chain) {
      if ($p.name -eq "@brandos/web") { continue }
      Log "Building $($p.name)..."
      pnpm --filter $p.name build
      if ($LASTEXITCODE -ne 0) { Err "Build failed for $($p.name)" }
      Ok "$($p.name) built"
    }
  }

  if (-not $SkipValidation) {
    node scripts/check-boundaries.mjs
    if ($LASTEXITCODE -ne 0) { Warn "Boundary violations detected" }
    node scripts/check-exports.mjs
    if ($LASTEXITCODE -ne 0) { Warn "Export issues detected" }
  }

  Write-Host ""
  Ok "Package $pkgName and dependency chain ready"
  Log "Run package tests: pnpm --filter $pkgName test"
}

# ── MODE: AGENT context loader (v2 — generated-context-first) ─────────────
#
# Reads the P3.5 architecture-intelligence layer (.context/*.generated.*) as
# the primary source for every field in the agent manifest. Each field falls
# back independently to the original v1/v2 source-reconstruction logic
# ($PackageGraph / $pkgInfo / AGENT_CONTEXT.md) if its generated artifact is
# missing, unreadable, or doesn't contain the requested package — so this
# still works in a partially-generated environment, and works exactly as
# before in an environment with no .context/ at all.

$script:ContextDir = Join-Path $Root ".context"

function Read-JsonContext($RelPath) {
  $p = Join-Path $Root $RelPath
  if (-not (Test-Path $p)) { return $null }
  try { return (Get-Content $p -Raw) | ConvertFrom-Json } catch { return $null }
}

function Read-TextContext($RelPath) {
  $p = Join-Path $Root $RelPath
  if (-not (Test-Path $p)) { return $null }
  try { return Get-Content $p -Raw } catch { return $null }
}

# Extracts one package's block from agent_entrypoints.generated.md (between
# its "## @brandos/x" heading and the next one, or end of file).
function Get-AgentEntrypointBlock($MdText, $PkgName) {
  if (-not $MdText) { return $null }
  $pattern = "(?ms)^## " + [regex]::Escape($PkgName) + "\s*?\n(.*?)(?=\n## |\z)"
  $m = [regex]::Match($MdText, $pattern)
  if (-not $m.Success) { return $null }
  return $m.Groups[1].Value
}

# Extracts the bullet list under a "**Heading...**" line inside a block
# produced by generate-agent-entrypoints.mjs. Tolerant of trailing
# parenthetical/annotation text before the colon (e.g.
# "**High-Risk Areas** _(from ... )_:").
function Get-BulletsUnderHeading($BlockText, $HeadingPrefix) {
  if (-not $BlockText) { return @() }
  $pattern = "(?s)\*\*" + $HeadingPrefix + ".*?\n(.*?)(?=\n\*\*|\z)"
  $m = [regex]::Match($BlockText, $pattern)
  if (-not $m.Success) { return @() }
  $bullets = @()
  foreach ($line in ($m.Groups[1].Value -split "`n")) {
    $t = $line.Trim()
    if ($t -match '^-\s+(.+)$') { $bullets += $Matches[1].Trim() }
  }
  return $bullets
}

# Same idea, but for AGENT_CONTEXT.md's own "## Heading" markdown-H2 style
# (different from agent_entrypoints.generated.md's bold-text style above) —
# used only by the fallback path, reading AGENT_CONTEXT.md directly.
function Get-BulletsUnderH2Heading($Text, $Heading) {
  if (-not $Text) { return @() }
  $pattern = "(?ms)^## " + [regex]::Escape($Heading) + "\s*\n(.*?)(?=\n## |\z)"
  $m = [regex]::Match($Text, $pattern)
  if (-not $m.Success) { return @() }
  $bullets = @()
  foreach ($line in ($m.Groups[1].Value -split "`n")) {
    $t = $line.Trim()
    if ($t -match '^-\s+(.+)$') { $bullets += $Matches[1].Trim() }
  }
  return $bullets
}

# Which runtime_trace.generated.md sections mention this package — the
# closest available proxy for "runtime touchpoints" without re-parsing the
# trace generator's own source-scanning logic a second time in PowerShell.
# The trace's prose mostly refers to packages by the same abbreviations the
# generator itself uses (CPL, BI, ARL, OCL, AEL, GL) rather than full scoped
# names, so those are matched too (word-bounded, to avoid matching inside
# unrelated words).
$script:PackageAbbreviations = @{
  "@brandos/control-plane-layer"   = "CPL"
  "@brandos/brand-intelligence"    = "BI"
  "@brandos/ai-runtime-layer"      = "ARL"
  "@brandos/output-control-layer"  = "OCL"
  "@brandos/artifact-engine-layer" = "AEL"
  "@brandos/governance-layer"      = "GL"
}

function Get-RuntimeTouchpoints($TraceText, $PkgName) {
  if (-not $TraceText) { return @() }
  $bare = $PkgName -replace '^@brandos/', ''
  $abbr = $script:PackageAbbreviations[$PkgName]
  $sections = [regex]::Split($TraceText, '(?m)^(?=## )')
  $touchpoints = [System.Collections.ArrayList]::new()
  foreach ($s in $sections) {
    if ($s -match '^## (.+)') {
      $heading = $Matches[1].Trim()
      $hit = ($s -match [regex]::Escape($PkgName)) -or ($s -match [regex]::Escape($bare))
      if (-not $hit -and $abbr -and ($s -match "\b$abbr\b")) { $hit = $true }
      if ($hit) { $null = $touchpoints.Add($heading) }
    }
  }
  return $touchpoints
}

# Builds the v2 agent manifest. Returns @{ manifest = [ordered]@{...}; sources = [ordered]@{...} }
# where `sources` records, per generated artifact, whether it was actually
# used ("generated") or whether that field fell back to source reconstruction
# ("fallback: <reason>") — printed to the operator so it's never silently
# unclear which answer they got.
function Build-AgentManifest($PkgName, $PkgInfo) {
  $sources = [ordered]@{}

  $graphJson       = Read-JsonContext ".context/architecture_graph.generated.json"
  $impactJson      = Read-JsonContext ".context/dependency_impact.generated.json"
  $contractsJson   = Read-JsonContext ".context/behavior_contracts.generated.json"
  $traceText       = Read-TextContext ".context/runtime_trace.generated.md"
  $entrypointsText = Read-TextContext ".context/agent_entrypoints.generated.md"

  $graphPkg = $null
  if ($graphJson) { $graphPkg = $graphJson.packages | Where-Object { $_.package -eq $PkgName } | Select-Object -First 1 }

  $impactPkg = $null
  if ($impactJson -and $impactJson.packages) {
    $prop = $impactJson.packages.PSObject.Properties[$PkgName]
    if ($prop) { $impactPkg = $prop.Value }
  }

  $entryBlock = $null
  if ($entrypointsText) { $entryBlock = Get-AgentEntrypointBlock $entrypointsText $PkgName }

  $manifest = [ordered]@{
    package               = $PkgName
    layer                 = $null
    ownedTables           = @()
    allowedDependencies   = @()
    forbiddenDependencies = @()
    directConsumers       = @()
    riskLevel             = $null
    behaviorContracts     = @()
    runtimeTouchpoints    = @()
    highRiskFiles         = @()
    architecturalRules    = @()
  }

  # layer / ownedTables / allowedDependencies / forbiddenDependencies / architecturalRules
  if ($graphPkg) {
    $manifest.layer                 = $graphPkg.layer
    $manifest.ownedTables           = @($graphPkg.tables)
    $manifest.allowedDependencies   = @($graphPkg.dependsOn)
    $manifest.forbiddenDependencies = @($graphPkg.forbiddenDependencies)
    $manifest.architecturalRules    = @($graphPkg.appliesRules)
    $sources["architecture_graph.generated.json"] = "generated"
  } else {
    $manifest.layer                 = "L$($PkgInfo.layer)"
    $manifest.allowedDependencies   = @($PkgInfo.deps)
    $manifest.forbiddenDependencies = @(($PackageGraph | Where-Object { $_.layer -gt $PkgInfo.layer } | ForEach-Object { $_.name }))
    $sources["architecture_graph.generated.json"] = "fallback: file missing or package not present - recomputed from the local package registry (RULE-LAYER-ORDER only; ownedTables/architecturalRules unavailable without it)"
  }

  # directConsumers / riskLevel
  if ($impactPkg) {
    $manifest.directConsumers = @($impactPkg.directConsumers)
    $manifest.riskLevel       = $impactPkg.riskLevel
    $sources["dependency_impact.generated.json"] = "generated"
  } else {
    $manifest.directConsumers = @(($PackageGraph | Where-Object { $_.deps -contains $PkgName } | ForEach-Object { $_.name }))
    $manifest.riskLevel       = "unknown"
    $sources["dependency_impact.generated.json"] = "fallback: file missing or package not present - direct consumers recomputed from the local package registry; riskLevel has no fallback (pre-P3.5 tooling never computed it)"
  }

  # behaviorContracts — no pre-P3.5 equivalent existed, so there is nothing
  # to fall back to; an empty list here means "not available", not "none exist".
  if ($contractsJson) {
    $matching = @($contractsJson.contracts | Where-Object { $_.source -eq $PkgName -or $_.target -eq $PkgName })
    $manifest.behaviorContracts = @($matching | ForEach-Object { "$($_.source) -> $($_.target): $($_.contract)" })
    $sources["behavior_contracts.generated.json"] = "generated"
  } else {
    $sources["behavior_contracts.generated.json"] = "unavailable: file missing — no fallback exists (this is new in P3.5, not a reconstruction of prior logic)"
  }

  # runtimeTouchpoints — same: net-new in P3.5, no fallback.
  if ($traceText) {
    $manifest.runtimeTouchpoints = @(Get-RuntimeTouchpoints $traceText $PkgName)
    $sources["runtime_trace.generated.md"] = "generated"
  } else {
    $sources["runtime_trace.generated.md"] = "unavailable: file missing — no fallback exists (this is new in P3.5, not a reconstruction of prior logic)"
  }

  # highRiskFiles — falls back to reading AGENT_CONTEXT.md "Dangerous Changes"
  # directly (the same source generate-agent-entrypoints.mjs itself reads),
  # rather than to nothing, since that file predates P3.5.
  if ($entryBlock) {
    $manifest.highRiskFiles = @(Get-BulletsUnderHeading $entryBlock 'High-Risk Areas')
    $sources["agent_entrypoints.generated.md"] = "generated"
  } else {
    $legacyPath = Join-Path $Root "$($PkgInfo.dir)/AGENT_CONTEXT.md"
    if (Test-Path $legacyPath) {
      $manifest.highRiskFiles = @(Get-BulletsUnderH2Heading (Get-Content $legacyPath -Raw) 'Dangerous Changes')
      $sources["agent_entrypoints.generated.md"] = "fallback: file missing or package not present — read $($PkgInfo.dir)/AGENT_CONTEXT.md directly"
    } else {
      $sources["agent_entrypoints.generated.md"] = "unavailable: neither agent_entrypoints.generated.md nor AGENT_CONTEXT.md found"
    }
  }

  return @{ manifest = $manifest; sources = $sources }
}

function Invoke-AgentBootstrap($pkgName) {
  if (-not $pkgName) { Err "Agent mode requires -Package @brandos/package-name" }

  $pkgInfo = Get-PackageInfo $pkgName
  if ($null -eq $pkgInfo) { Err "Unknown package: $pkgName" }

  Section "Agent Context: $pkgName (L$($pkgInfo.layer))"
  Log "Generating agent context manifest — preferring generated architecture intelligence (.context/) over source reconstruction"

  $built     = Build-AgentManifest $pkgName $pkgInfo
  $manifest  = $built.manifest
  $sources   = $built.sources
  $generatedCount = @($sources.Values | Where-Object { $_ -eq "generated" }).Count

  Write-Host ""
  Write-Host "┌─────────────────────────────────────────────────────────┐" -ForegroundColor Cyan
  Write-Host "│  AGENT CONTEXT MANIFEST: $pkgName" -ForegroundColor Cyan
  Write-Host "│  Layer: $($manifest.layer)   Risk: $($manifest.riskLevel)" -ForegroundColor Cyan
  Write-Host "└─────────────────────────────────────────────────────────┘" -ForegroundColor Cyan
  Write-Host ""

  Write-Host "CONTEXT SOURCES (generated vs. fallback) — $generatedCount/$($sources.Count) from .context/:" -ForegroundColor Magenta
  foreach ($k in $sources.Keys) {
    if ($sources[$k] -eq "generated") { Write-Host "  ✅ $k" -ForegroundColor Green }
    else { Write-Host "  ⚠️  $k" -ForegroundColor Yellow; Write-Host "       $($sources[$k])" -ForegroundColor DarkGray }
  }

  Write-Host ""
  Write-Host "OWNED TABLES:" -ForegroundColor Green
  if ($manifest.ownedTables.Count) { foreach ($t in $manifest.ownedTables) { Write-Host "  - $t" } }
  else { Write-Host "  (none)" -ForegroundColor DarkGray }

  Write-Host ""
  Write-Host "ALLOWED DEPENDENCIES:" -ForegroundColor Green
  if ($manifest.allowedDependencies.Count) { foreach ($d in $manifest.allowedDependencies) { Write-Host "  ✅ $d" } }
  else { Write-Host "  (none — foundational package)" -ForegroundColor DarkGray }

  Write-Host ""
  Write-Host "FORBIDDEN DEPENDENCIES:" -ForegroundColor Red
  if ($manifest.forbiddenDependencies.Count) { foreach ($d in $manifest.forbiddenDependencies) { Write-Host "  ❌ $d" } }
  else { Write-Host "  (none)" -ForegroundColor DarkGray }

  Write-Host ""
  Write-Host "DIRECT CONSUMERS:" -ForegroundColor Yellow
  if ($manifest.directConsumers.Count) { foreach ($c in $manifest.directConsumers) { Write-Host "  - $c" } }
  else { Write-Host "  (none — nothing in this repo imports it)" -ForegroundColor DarkGray }

  Write-Host ""
  Write-Host "HIGH-RISK AREAS:" -ForegroundColor Red
  if ($manifest.highRiskFiles.Count) { foreach ($h in $manifest.highRiskFiles) { Write-Host "  ⚠️  $h" } }
  else { Write-Host "  (none documented)" -ForegroundColor DarkGray }

  Write-Host ""
  Write-Host "ARCHITECTURAL RULES:" -ForegroundColor Yellow
  if ($manifest.architecturalRules.Count) { foreach ($r in $manifest.architecturalRules) { Write-Host "  - $r" } }
  else { Write-Host "  (none matched)" -ForegroundColor DarkGray }

  Write-Host ""
  Write-Host "BEHAVIOR CONTRACTS:" -ForegroundColor Yellow
  if ($manifest.behaviorContracts.Count) { foreach ($b in $manifest.behaviorContracts) { Write-Host "  - $b" } }
  else { Write-Host "  (none — package is not one of the six named contract pairs)" -ForegroundColor DarkGray }

  Write-Host ""
  Write-Host "RUNTIME TOUCHPOINTS:" -ForegroundColor Yellow
  if ($manifest.runtimeTouchpoints.Count) { foreach ($t in $manifest.runtimeTouchpoints) { Write-Host "  - $t" } }
  else { Write-Host "  (none found in runtime_trace.generated.md)" -ForegroundColor DarkGray }

  Write-Host ""
  Write-Host "ALSO LOAD (for actually writing code — the manifest above tells you risk/rules, not implementation):" -ForegroundColor Green
  Write-Host "  ✅ $($pkgInfo.dir)/AGENT_CONTEXT.md"
  Write-Host "  ✅ $($pkgInfo.dir)/package.json"
  Write-Host "  ✅ $($pkgInfo.dir)/src/ (full)"
  Write-Host "  ✅ packages/contracts/src/ (types only)"
  foreach ($dep in $pkgInfo.deps) {
    $depInfo = Get-PackageInfo $dep
    if ($null -ne $depInfo -and $dep -ne "@brandos/contracts") {
      Write-Host "  ✅ $($depInfo.dir)/src/index.ts (exports only)"
    }
  }

  Write-Host ""
  Write-Host "AGENT_CONTEXT.md:" -ForegroundColor Yellow
  $agentCtxPath = "$Root/$($pkgInfo.dir)/AGENT_CONTEXT.md"
  if (Test-Path $agentCtxPath) { Get-Content $agentCtxPath | Write-Host }
  else { Warn "AGENT_CONTEXT.md not found for $pkgName" }

  Write-Host ""
  Write-Host "VALIDATION COMMAND (run after edits):" -ForegroundColor Yellow
  Write-Host "  node scripts/check-boundaries.mjs"
  Write-Host "  node scripts/check-workspace.mjs"
  Write-Host "  pnpm --filter `"$pkgName`" build"
  Write-Host "  pnpm --filter `"$pkgName`" test"
  Write-Host ""

  # Machine-readable manifest, written alongside the console output — same
  # .agent/ convention setup-artifact-workspace.ps1 / setup-runtime-workspace.ps1
  # already use for AGENT_MANIFEST.json, scoped per-package here since this
  # script can be run for any package against the same checkout.
  $agentDir = Join-Path $Root ".agent"
  if (-not (Test-Path $agentDir)) { New-Item -ItemType Directory -Force -Path $agentDir | Out-Null }
  $slug = ($pkgName -replace '^@brandos/', '')
  $manifestPath = Join-Path $agentDir "manifest-$slug.json"
  $manifest | ConvertTo-Json -Depth 10 | Set-Content -Path $manifestPath -Encoding UTF8
  Ok "Manifest written: .agent/manifest-$slug.json"
}

# ── Entry point ────────────────────────────────────────────────────────────

Section "Pre-flight"
Assert-Node
Assert-Pnpm
Assert-NpmrcHoisted -Root $Root

switch ($Mode) {
  "Full"    { Invoke-FullBootstrap }
  "Package" { Invoke-PackageBootstrap $Package }
  "Agent"   { Invoke-AgentBootstrap $Package }
}
