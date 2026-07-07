# scripts/platform-verify.ps1
#
# BrandOS Platform Verifier — v4
#
# Quick pre-deploy / post-install verification.
# Checks: Node/pnpm, dependencies, workspace structure, architectural
# boundaries, environment, and build outputs.
#
# v4 changes:
#   - Dot-sources shared/preflight.ps1
#   - Package list sourced from shared/package-registry.mjs
#     (identity-layer → brand-intelligence; config packages added)
#
# USAGE:
#   .\scripts\platform-verify.ps1
#   .\scripts\platform-verify.ps1 -SkipBuildCheck
#   .\scripts\platform-verify.ps1 -Verbose

param(
  [switch]$SkipBuildCheck,
  [switch]$Verbose
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

. "$PSScriptRoot\shared\preflight.ps1"

$Passed = 0
$Failed = 0

function Pass($msg)    { Write-Host "  ✅ $msg" -ForegroundColor Green; $script:Passed++ }
function Fail($msg)    { Write-Host "  ❌ $msg" -ForegroundColor Red;   $script:Failed++ }
function Section($msg) { Write-Host "`n▶ $msg" -ForegroundColor Cyan }

# ── Node & pnpm ───────────────────────────────────────────────────────────────
Section "Node & pnpm"

try {
  $nodeVer = node --version 2>&1
  if ($nodeVer -match "v(\d+)") {
    if ([int]$Matches[1] -ge 22) { Pass "Node $nodeVer" }
    else { Fail "Node $nodeVer — requires >=22 (24.x recommended, see .nvmrc)" }
  }
} catch { Fail "node not found" }

try {
  $pnpmVer = pnpm --version 2>&1
  if ($pnpmVer -match "^(\d+)") {
    if ([int]$Matches[1] -ge 9) { Pass "pnpm $pnpmVer" }
    else { Fail "pnpm $pnpmVer — requires >=9" }
  }
} catch { Fail "pnpm not found — install: npm install -g pnpm@9" }

# ── Dependencies ──────────────────────────────────────────────────────────────
Section "Dependencies"

pnpm install --frozen-lockfile 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) { Pass "pnpm install --frozen-lockfile" }
else { Fail "pnpm install failed" }

pnpm ls react 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) { Pass "react dependency tree OK" }
else { Fail "react dependency tree issue — run: pnpm ls react" }

# ── Workspace structure — from canonical registry ─────────────────────────────
Section "Workspace structure"

$knownJson = node --input-type=module --eval `
  "import { KNOWN_PACKAGES } from './scripts/shared/package-registry.mjs'; process.stdout.write(JSON.stringify(KNOWN_PACKAGES.map(p=>p.dir)));"
$allPackages = $knownJson | ConvertFrom-Json

foreach ($pkg in $allPackages) {
  if (Test-Path "$Root/$pkg/package.json") { Pass $pkg }
  else { Fail "Missing: $pkg/package.json" }
}

# ── Workspace wiring & architectural boundaries ────────────────────────────────
Section "Workspace wiring & architectural boundaries"

node scripts/check-workspace.mjs 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) { Pass "All workspace:* refs correct" }
else { Fail "Workspace wiring errors — run: node scripts/check-workspace.mjs" }

node scripts/check-boundaries.mjs 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) { Pass "No upward layer imports" }
else { Fail "Boundary violations — run: node scripts/check-boundaries.mjs" }

node scripts/check-route-boundaries.mjs 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) { Pass "Route boundaries clean" }
else { Fail "Route violations — run: node scripts/check-route-boundaries.mjs" }

node scripts/check-circular.mjs 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) { Pass "No circular imports" }
else { Fail "Circular imports detected — run: node scripts/check-circular.mjs" }

node scripts/lint-imports.mjs 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) { Pass "Import lint clean" }
else { Fail "Import lint issues — run: node scripts/lint-imports.mjs" }

# ── Environment ───────────────────────────────────────────────────────────────
Section "Environment"

$EnvFile = "apps/web/.env.local"
if (Test-Path $EnvFile) {
  $envContent = Get-Content $EnvFile -Raw
  foreach ($key in @("NEXT_PUBLIC_SUPABASE_URL","NEXT_PUBLIC_SUPABASE_ANON_KEY","SUPABASE_SERVICE_ROLE_KEY")) {
    if ($envContent -match "$key=.+") { Pass "$key set" }
    else { Fail "$key missing in $EnvFile" }
  }
  $hasAI = ($envContent -match "ANTHROPIC_API_KEY=.+") -or
           ($envContent -match "OPENAI_API_KEY=.+")    -or
           ($envContent -match "GROQ_API_KEY=.+")       -or
           ($envContent -match "OLLAMA_URL=.+")
  if ($hasAI) { Pass "AI provider key configured" }
  else { Fail "No AI provider key — set ANTHROPIC_API_KEY, GROQ_API_KEY, or OLLAMA_URL" }
} else {
  Fail "$EnvFile not found — copy apps/web/.env.local.template"
}

# ── Build outputs — from canonical registry ────────────────────────────────────
if (-not $SkipBuildCheck) {
  Section "Build outputs"

  $buildableJson = node --input-type=module --eval `
    "import { BUILDABLE_PACKAGES } from './scripts/shared/package-registry.mjs'; process.stdout.write(JSON.stringify(BUILDABLE_PACKAGES));"
  $buildablePkgs = $buildableJson | ConvertFrom-Json

  foreach ($pkg in $buildablePkgs) {
    if (Test-Path "$Root/$pkg/dist/index.js") { Pass $pkg }
    else { Fail "$pkg/dist/index.js missing — run: pnpm build" }
  }

  node scripts/check-exports.mjs 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { Pass "Export map entries present" }
  else { Fail "Missing exports — run: node scripts/check-exports.mjs" }
}

# ── Summary ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "══════════════════════════════════════════" -ForegroundColor White
$color = if ($Failed -eq 0) { "Green" } else { "Red" }
Write-Host "  VERIFICATION: $Passed passed, $Failed failed" -ForegroundColor $color
Write-Host "══════════════════════════════════════════" -ForegroundColor White
Write-Host ""

if ($Failed -gt 0) { exit 1 }
