# scripts/platform-clean.ps1
#
# BrandOS Platform Clean — v6
#
# Removes all dist artifacts, caches, and transient build outputs.
# Does NOT remove node_modules by default.
# Use -DeepClean to also wipe node_modules and lockfile.
#
# v6 changes:
#   - Dot-sources shared/preflight.ps1 (npmrc guard, no local duplicate)
#   - Dist folder list sourced from shared/package-registry.mjs
#     via inline node call — single source of truth for package names
#
# USAGE:
#   .\scripts\platform-clean.ps1
#   .\scripts\platform-clean.ps1 -DeepClean

param(
  [switch]$DeepClean
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

. "$PSScriptRoot\shared\preflight.ps1"

Write-Host ""
Write-Host "🧹 BrandOS Platform Clean" -ForegroundColor Cyan
Write-Host ""

# ── Guard ──────────────────────────────────────────────────────────────────
$npmrcPath = Join-Path $Root ".npmrc"
if (-not (Test-Path $npmrcPath)) {
  "node-linker=hoisted" | Set-Content $npmrcPath
  Write-Host "[clean] .npmrc was missing — created with node-linker=hoisted." -ForegroundColor Yellow
}
Assert-NpmrcHoisted -Root $Root

# ── Dist folder cleanup — list from canonical registry ─────────────────────
Write-Host ""
Write-Host "🗑️  Removing package dist folders..."

$buildableJson = node --input-type=module --eval `
  "import { BUILDABLE_PACKAGES } from './scripts/shared/package-registry.mjs'; process.stdout.write(JSON.stringify(BUILDABLE_PACKAGES));"
$buildablePkgs = $buildableJson | ConvertFrom-Json

$distFolders = $buildablePkgs | ForEach-Object { "$_\dist".Replace("/", "\") }

$cleaned = 0
foreach ($folder in $distFolders) {
  if (Test-Path $folder) {
    Write-Host "   removing $folder"
    Remove-Item $folder -Recurse -Force -ErrorAction SilentlyContinue
    $cleaned++
  }
}

# Also clean output-control-layer dist-patches
$patchDir = "packages\output-control-layer\dist-patches"
if (Test-Path $patchDir) {
  Write-Host "   removing $patchDir"
  Remove-Item $patchDir -Recurse -Force -ErrorAction SilentlyContinue
  $cleaned++
}

Write-Host ""
Write-Host "   ✅ Dist folders cleaned ($cleaned of $($distFolders.Count) packages had dist)"

# ── Next.js build cache ────────────────────────────────────────────────────
Write-Host ""
Write-Host "🗑️  Removing Next.js cache..."
Remove-Item -Recurse -Force "apps\web\.next" -ErrorAction SilentlyContinue

# ── Turbo cache ────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "🗑️  Removing turbo cache..."
Remove-Item -Recurse -Force ".turbo" -ErrorAction SilentlyContinue

# ── tsbuildinfo ────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "🗑️  Removing tsbuildinfo files..."
Get-ChildItem -Recurse -Filter "*.tsbuildinfo" -ErrorAction SilentlyContinue |
  Remove-Item -Force -ErrorAction SilentlyContinue

# ── Accidental compiled artifacts in src/ ─────────────────────────────────
Write-Host ""
Write-Host "🗑️  Removing accidental compiled artifacts from src/..."
Get-ChildItem -Recurse .\packages `
  -Include "*.js","*.d.ts","*.d.ts.map" `
  -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match "\\src\\" } |
  Remove-Item -Force -ErrorAction SilentlyContinue

# ── Deep clean (optional) ─────────────────────────────────────────────────
if ($DeepClean) {
  Write-Host ""
  Write-Host "🗑️  Deep cleaning dependencies..." -ForegroundColor Yellow

  Get-ChildItem -Path . -Directory -Recurse `
    -Filter "node_modules" `
    -ErrorAction SilentlyContinue |
  ForEach-Object {
    Write-Host "   removing $($_.FullName)"
    Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
  }

  if (Test-Path "pnpm-lock.yaml") {
    Write-Host "   removing pnpm-lock.yaml (will be regenerated with correct hoisting)"
    Remove-Item "pnpm-lock.yaml" -Force -ErrorAction SilentlyContinue
  }

  pnpm store prune
  Remove-Item "$env:LOCALAPPDATA\pnpm-cache" -Recurse -Force -ErrorAction SilentlyContinue

  Write-Host ""
  Write-Host "✅ Dependency state reset complete" -ForegroundColor Green
  Write-Host ""
  Write-Host "⚠️  IMPORTANT: node_modules was wiped. Run pnpm install to restore." -ForegroundColor Yellow
  Write-Host "   The .npmrc node-linker=hoisted setting will take effect on next install." -ForegroundColor Gray
}

# ── Done ──────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "✅ Platform clean complete."

if ($DeepClean) {
  Write-Host "   Run: pnpm install --no-frozen-lockfile" -ForegroundColor Gray
  Write-Host "   Then: .\scripts\platform-dev.ps1 -SkipInstall" -ForegroundColor Gray
} else {
  Write-Host "   Run: .\scripts\platform-dev.ps1 -SkipInstall" -ForegroundColor Gray
}

Write-Host ""
