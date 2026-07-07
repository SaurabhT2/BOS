# scripts/platform-rebuild.ps1
#
# BrandOS Full Platform Rebuild — v4
#
# Wipes all dist artifacts, reinstalls, rebuilds everything from scratch.
# Use for: clean onboarding, dependency changes, post-refactor verification.
#
# v4 changes:
#   - Dot-sources shared/preflight.ps1
#   - Dist list and build order sourced from shared/package-registry.mjs
#     (identity-layer removed; brand-intelligence and config packages added)
#
# USAGE:
#   .\scripts\platform-rebuild.ps1
#   .\scripts\platform-rebuild.ps1 -SkipInstall
#   .\scripts\platform-rebuild.ps1 -SkipValidation
#   .\scripts\platform-rebuild.ps1 -ManualOrder

param(
  [switch]$SkipInstall,
  [switch]$SkipValidation,
  [switch]$ManualOrder
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

. "$PSScriptRoot\shared\preflight.ps1"

function Log($msg) { Write-Host "[rebuild] $msg" -ForegroundColor Cyan }
function Ok($msg)  { Write-Host "[rebuild] ✅ $msg" -ForegroundColor Green }
function Err($msg) { Write-Host "[rebuild] ❌ $msg" -ForegroundColor Red; exit 1 }

Log "BrandOS Platform Rebuild — $Root"

# ── Pre-flight ──────────────────────────────────────────────────────────────
$npmrcPath = Join-Path $Root ".npmrc"
if (-not (Test-Path $npmrcPath)) {
  "node-linker=hoisted" | Set-Content $npmrcPath
  Log ".npmrc was missing — created with node-linker=hoisted"
}
Assert-NpmrcHoisted -Root $Root
Assert-Pnpm

# ── Clean dist — list from canonical registry ──────────────────────────────
Log "Cleaning dist directories..."

$buildableJson = node --input-type=module --eval `
  "import { BUILDABLE_PACKAGES } from './scripts/shared/package-registry.mjs'; process.stdout.write(JSON.stringify(BUILDABLE_PACKAGES));"
$buildablePkgs = $buildableJson | ConvertFrom-Json
$distDirs = $buildablePkgs | ForEach-Object { "$_\dist".Replace("/", "\") }

foreach ($d in $distDirs) {
  if (Test-Path $d) { Remove-Item $d -Recurse -Force; Log "  removed $d" }
}

Log "Cleaning turbo cache..."
if (Test-Path ".turbo") { Remove-Item ".turbo" -Recurse -Force }

Log "Cleaning tsbuildinfo files..."
Get-ChildItem -Recurse -Filter "*.tsbuildinfo" -ErrorAction SilentlyContinue |
  Remove-Item -Force -ErrorAction SilentlyContinue

# ── Install ─────────────────────────────────────────────────────────────────
Invoke-PnpmInstall -Skip:$SkipInstall

# ── Pre-build validation ─────────────────────────────────────────────────────
if (-not $SkipValidation) {
  Log "Validating workspace wiring..."
  node scripts/check-workspace.mjs
  if ($LASTEXITCODE -ne 0) { Err "Workspace validation failed — fix before rebuilding" }

  Log "Checking architectural boundaries..."
  node scripts/check-boundaries.mjs
  if ($LASTEXITCODE -ne 0) { Err "Boundary violations found — fix before rebuilding" }
}

# ── Build ────────────────────────────────────────────────────────────────────
if ($ManualOrder) {
  Log "Building in explicit topological order (debug mode)..."

  $buildOrderJson = node --input-type=module --eval `
    "import { BUILD_ORDER } from './scripts/shared/package-registry.mjs'; process.stdout.write(JSON.stringify(BUILD_ORDER));"
  $buildOrder = $buildOrderJson | ConvertFrom-Json

  foreach ($pkg in $buildOrder) {
    Log "Building $pkg..."
    pnpm --filter $pkg build
    if ($LASTEXITCODE -ne 0) { Err "Build failed for $pkg" }
    Ok $pkg
  }
} else {
  Log "Building all packages with turbo..."
  pnpm build
  if ($LASTEXITCODE -ne 0) { Err "Build failed" }
  Ok "All packages built"
}

# ── Post-build validation ────────────────────────────────────────────────────
if (-not $SkipValidation) {
  Log "Validating exports..."
  node scripts/check-exports.mjs
  if ($LASTEXITCODE -ne 0) { Err "Export validation failed" }
  Ok "Exports validated"
}

# ── Done ─────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "══════════════════════════════════════════" -ForegroundColor Green
Write-Host "  ✅ REBUILD COMPLETE" -ForegroundColor Green
Write-Host "   Next: pnpm dev" -ForegroundColor Green
Write-Host "══════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
