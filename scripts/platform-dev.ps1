# scripts/platform-dev.ps1
#
# BrandOS Platform Dev Starter — v5
#
# Installs dependencies, builds all packages in correct topological order,
# typechecks the web app, then starts the Next.js dev server.
#
# v5 changes:
#   - Dot-sources shared/preflight.ps1 (npmrc guard, pnpm/node checks,
#     Invoke-PnpmInstall — no more duplicated inline implementations)
#   - ManualOrder build list sourced from shared/package-registry.mjs
#     via inline node call — single source of truth
#
# USAGE:
#   .\scripts\platform-dev.ps1
#   .\scripts\platform-dev.ps1 -SkipInstall
#   .\scripts\platform-dev.ps1 -ManualOrder    # debug: bypass turbo

param(
  [switch]$SkipInstall,
  [switch]$ManualOrder
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

. "$PSScriptRoot\shared\preflight.ps1"

function Log($msg)  { Write-Host "[dev] $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "[dev] ✅ $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "[dev] ⚠️  $msg" -ForegroundColor Yellow }
function Err($msg)  { Write-Host "[dev] ❌ $msg" -ForegroundColor Red; exit 1 }

Log ""
Log "🚀 BrandOS Dev Bootstrap"
Log ""

# ── Pre-flight ─────────────────────────────────────────────────────────────
# Auto-create .npmrc if missing (node-linker=hoisted required for Next.js 15 + pnpm)
$npmrcPath = Join-Path $Root ".npmrc"
if (-not (Test-Path $npmrcPath)) {
  "node-linker=hoisted" | Set-Content $npmrcPath
  Warn ".npmrc was missing — created with node-linker=hoisted. Re-run pnpm install if you see CSS loader errors."
}
Assert-NpmrcHoisted -Root $Root
Assert-Node
Assert-Pnpm

# ── Install ────────────────────────────────────────────────────────────────
Invoke-PnpmInstall -Skip:$SkipInstall

# ── Build packages ─────────────────────────────────────────────────────────
if ($ManualOrder) {
  Log "Building packages in explicit topological order (ManualOrder mode)..."

  # Pull build order from the canonical registry — write a temp helper so
  # we don't depend on --input-type=module --eval which varies by Node version.
  $tmpScript = Join-Path $env:TEMP "brandos-build-order-$([System.Guid]::NewGuid().ToString('N')).mjs"
  try {
    Set-Content $tmpScript "import { BUILD_ORDER } from './scripts/shared/package-registry.mjs'; process.stdout.write(JSON.stringify(BUILD_ORDER));"
    $buildOrderJson = node $tmpScript
  } finally {
    if (Test-Path $tmpScript) { Remove-Item $tmpScript -Force }
  }
  $buildOrder = $buildOrderJson | ConvertFrom-Json
  # web app is not built in this step (built/started by pnpm dev)
  $buildOrder = $buildOrder | Where-Object { $_ -ne "@brandos/web" }

  foreach ($pkg in $buildOrder) {
    Log "Building $pkg..."
    pnpm --filter $pkg build
    if ($LASTEXITCODE -ne 0) { Err "Build failed for $pkg" }
    Ok $pkg
  }
} else {
  Log "Building all packages (turbo — topological resolution)..."
  pnpm turbo build --filter='!@brandos/web'
  if ($LASTEXITCODE -ne 0) { Err "Package build failed" }
  Ok "All packages built"
}

# ── Typecheck web ──────────────────────────────────────────────────────────
Log "Typechecking web app..."
pnpm --filter "@brandos/web" typecheck
if ($LASTEXITCODE -ne 0) { Err "Web typecheck failed" }
Ok "Typecheck passed"

# ── Env check ─────────────────────────────────────────────────────────────
if (-not (Test-Path "apps/web/.env.local")) {
  Write-Host ""
  Warn "apps/web/.env.local not found"
  Warn "Copy apps/web/.env.local.template and fill in values."
  Write-Host ""
}

# ── Start dev server ───────────────────────────────────────────────────────
Log "Starting Next.js dev server on port 3000..."
Set-Location "apps/web"
pnpm dev
