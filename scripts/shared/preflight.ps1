# scripts/shared/preflight.ps1
#
# BrandOS Shared PowerShell Preflight Utilities — v1
#
# Dot-source this file at the top of any platform script:
#   . "$PSScriptRoot\shared\preflight.ps1"
#
# Provides:
#   Assert-NpmrcHoisted      — verify node-linker=hoisted before pnpm calls
#   Assert-Pnpm              — verify pnpm >= 9 is installed
#   Assert-Node              — verify node >= 22 is installed
#   Resolve-RepoRoot         — walk up from script dir to find repo root
#   Write-Header / Write-Section / Write-Step / Write-Ok / Write-Warn
#   Write-Fail / Write-Info / Write-Debug2 / Invoke-Abort
#
# Previously duplicated across:
#   platform-dev.ps1, platform-clean.ps1          (npmrc guard)
#   setup-artifact-workspace.ps1, setup-runtime-workspace.ps1
#     (Resolve-RepoRoot, all Write-* helpers, Abort)

# ── Terminal styling ──────────────────────────────────────────────────────
# Scripts can override $AccentColor before dot-sourcing, or pass it to
# individual calls. Defaults to Cyan.

if (-not (Get-Variable -Name 'AccentColor' -Scope Script -ErrorAction SilentlyContinue)) {
  $script:AccentColor = 'Cyan'
}

function Write-Header {
  param([string]$msg, [string]$Color = $script:AccentColor)
  Write-Host ""
  Write-Host "  ╔══════════════════════════════════════════════════════════╗" -ForegroundColor $Color
  Write-Host "  ║  $msg" -ForegroundColor $Color
  Write-Host "  ╚══════════════════════════════════════════════════════════╝" -ForegroundColor $Color
  Write-Host ""
}

function Write-Section {
  param([string]$msg, [string]$Color = $script:AccentColor)
  Write-Host ""
  Write-Host "  ─── $msg ───────────────────────────────────────" -ForegroundColor $Color
}

function Write-Step   { param([string]$msg) Write-Host "  [>>] $msg" -ForegroundColor White }
function Write-Ok     { param([string]$msg) Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn   { param([string]$msg) Write-Host "  [!!] $msg" -ForegroundColor Yellow }
function Write-Fail   { param([string]$msg) Write-Host "  [XX] $msg" -ForegroundColor Red }
function Write-Info   { param([string]$msg) Write-Host "  [..] $msg" -ForegroundColor Gray }
function Write-Debug2 {
  param([string]$msg)
  if ($Verbose) { Write-Host "  [vb] $msg" -ForegroundColor DarkGray }
}

function Invoke-Abort {
  param([string]$msg)
  Write-Fail $msg
  Write-Host ""
  Write-Host "  ABORTED. Fix the issue above and re-run." -ForegroundColor Red
  Write-Host ""
  exit 1
}

# ── Tool checks ───────────────────────────────────────────────────────────

function Assert-Node {
  try {
    $v = node --version 2>&1
    # Floor is 22, not just "whatever works" — Node 20 reached end-of-life
    # April 30, 2026, and @supabase/supabase-js (used by IntelligenceOS)
    # requires Node >=22 for native WebSocket support. See
    # REPOSITORY_PORTABILITY_REPORT.md's Node runtime addendum for the full
    # rationale. Node 24.x (Active LTS, Vercel's default) is recommended —
    # see .nvmrc — but 22 (Maintenance LTS) is accepted as the floor.
    if ($v -match "v(\d+)" -and [int]$Matches[1] -lt 22) {
      Invoke-Abort "Node $v found — requires >=22 (24.x recommended, see .nvmrc)"
    }
    Write-Ok "Node $v"
  } catch {
    Invoke-Abort "node not found. Install Node.js >= 22 (24.x recommended)."
  }
}

function Assert-Pnpm {
  try {
    $v = pnpm --version 2>&1
    if ($v -match "^(\d+)" -and [int]$Matches[1] -lt 9) {
      Write-Warn "pnpm $v — recommend >=9"
    } else {
      Write-Ok "pnpm $v"
    }
  } catch {
    Invoke-Abort "pnpm not found. Install: npm install -g pnpm@9"
  }
}

# ── .npmrc guard ──────────────────────────────────────────────────────────
# node-linker=hoisted is REQUIRED for Next.js 15 + pnpm.
# Without it, next build crashes: Cannot find module '../../../../loaders/css-loader/src'

function Assert-NpmrcHoisted {
  param([string]$Root = (Get-Location).Path)

  $npmrc = Join-Path $Root ".npmrc"

  if (-not (Test-Path $npmrc)) {
    Invoke-Abort ".npmrc is missing. Create it: echo 'node-linker=hoisted' > .npmrc`n  Then run: pnpm install --no-frozen-lockfile"
  }

  if (-not (Select-String -Path $npmrc -Pattern "node-linker=hoisted" -Quiet)) {
    Invoke-Abort ".npmrc exists but is missing 'node-linker=hoisted'.`n  Add it, then run: pnpm install --no-frozen-lockfile"
  }

  Write-Ok ".npmrc OK (node-linker=hoisted)"
}

# ── Repo root detection ───────────────────────────────────────────────────
# Walks up from $StartDir looking for turbo.json + pnpm-lock.yaml.
# Returns the resolved path or calls Invoke-Abort on failure.

function Resolve-RepoRoot {
  param(
    [string]$StartDir  = $PSScriptRoot,
    [string]$Specified = "",   # if non-empty, validate and return directly
    [int]   $MaxDepth  = 6
  )

  if ($Specified -ne "") {
    if (-not (Test-Path $Specified)) {
      Invoke-Abort "Specified repo root does not exist: $Specified"
    }
    $resolved = Resolve-Path $Specified
    Write-Ok "Using specified repo root: $resolved"
    return $resolved
  }

  $current = if ($StartDir) { $StartDir } else { Get-Location }
  $depth   = 0

  while ($depth -lt $MaxDepth) {
    if ((Test-Path (Join-Path $current "turbo.json")) -and
        (Test-Path (Join-Path $current "pnpm-lock.yaml"))) {
      Write-Ok "Auto-detected repo root: $current"
      return $current
    }
    $parent = Split-Path $current -Parent
    if ($parent -eq $current) { break }
    $current = $parent
    $depth++
  }

  Invoke-Abort "Could not auto-detect repo root (no turbo.json + pnpm-lock.yaml found). Use -RepoRoot to specify."
}

# ── pnpm install helper ───────────────────────────────────────────────────

function Invoke-PnpmInstall {
  param(
    [switch]$Skip,
    [string]$Context = "install"
  )

  if ($Skip) {
    if (-not (Test-Path "node_modules")) {
      Write-Warn "node_modules not found but -SkipInstall was passed."
      Write-Warn "Run without -SkipInstall, or run: pnpm install --no-frozen-lockfile first."
      Invoke-Abort "Aborting — node_modules required."
    }
    return
  }

  Write-Step "Installing dependencies..."
  if (Test-Path "pnpm-lock.yaml") {
    pnpm install --frozen-lockfile
  } else {
    Write-Warn "pnpm-lock.yaml missing — regenerating (expected after deep clean)..."
    pnpm install --no-frozen-lockfile
  }
  if ($LASTEXITCODE -ne 0) { Invoke-Abort "pnpm install failed" }
  Write-Ok "Dependencies installed"
}
