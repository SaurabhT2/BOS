# scripts/package-workspace.ps1
#
# BrandOS Workspace Package Builder — v2
#
# CHANGES FROM v1:
#   Adds context generation phase before packaging.
#   New flow (full scope):
#     1. Generate Monorepo Context
#     2. Generate Package Contexts
#     3. Generate Database Context
#     4. Generate Runtime Model
#     5. Generate System Inventory
#     6. Package source (existing logic — unchanged)
#     7. Include .context/ in bundle
#     8. Create Claude bundle zip
#
#   artifact and runtime scopes: context generation is skipped by default.
#   Pass -GenerateContext to force context generation for those scopes.
#
# USAGE:
#   .\scripts\package-workspace.ps1 -Scope artifact
#   .\scripts\package-workspace.ps1 -Scope runtime
#   .\scripts\package-workspace.ps1 -Scope full
#   .\scripts\package-workspace.ps1 -Scope full -SkipContext   # skip generation (fast re-bundle)
#   .\scripts\package-workspace.ps1 -Scope artifact -GenerateContext
#
# All scopes:
#   - Run from the BrandOS monorepo root (where turbo.json lives)
#   - Create output under _workspaces\<scope>\ by default
#   - Accept -Out to override output path
#   - Accept -Zip to also produce a .zip archive
#   - Are idempotent (clean previous output before writing)

param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("artifact", "runtime", "full")]
  [string]$Scope,

  [string]$Root             = (Get-Location).Path,
  [string]$Out              = "",
  [string]$SchemaInventory  = "",        # path to schema_inventory.json; defaults to $Root\schema_inventory.json
  [switch]$Zip,
  [switch]$SkipContext,                  # skip context generation (full scope: use cached .context/)
  [switch]$GenerateContext,              # force context generation for artifact/runtime scopes
  [string]$ZipDest          = "",  # defaults to <Root>\_workspaces\dist — see resolution below (Repository Relocation Audit: was a hardcoded absolute Windows path)
  [switch]$SkipReleaseGate,             # bypass Phase 0 gate — CI only, never for production packaging
  [switch]$Force                        # promote WARN to PASS in release gate (requires sign-off)
)

$ErrorActionPreference = "Stop"

# ── Safety check ───────────────────────────────────────────────────────────────
if (-not (Test-Path (Join-Path $Root "turbo.json"))) {
  Write-Error "Must be run from the BrandOS monorepo root (where turbo.json lives)."
  exit 1
}

# ── Resolve ZipDest ─────────────────────────────────────────────────────────────
# Portable default: <Root>\_workspaces\dist, alongside the -Scope subfolders
# setup-artifact-workspace.ps1 / setup-runtime-workspace.ps1 already write to
# under $Root\_workspaces. Previously hardcoded to an absolute Windows path
# (C:\Brahmkosh\ToClaude\FullRepo) that only existed on one machine — pass
# -ZipDest explicitly to override (e.g. for a shared drop folder in CI).
if ($ZipDest -eq "") {
  $ZipDest = Join-Path $Root "_workspaces\dist"
}

# ── Resolve output path ────────────────────────────────────────────────────────
if ($Out -eq "") {
  $Out = Join-Path $ZipDest $Scope
}
if (!(Test-Path $ZipDest)) {
  New-Item -ItemType Directory -Force -Path $ZipDest | Out-Null
}

# ── Resolve schema_inventory.json path ────────────────────────────────────────
if ($SchemaInventory -eq "") {
  $SchemaInventory = Join-Path $Root "schema_inventory.json"
}

Write-Host ""
Write-Host "=== BrandOS Workspace Package Builder v2 ===" -ForegroundColor Cyan
Write-Host "Scope:   $Scope"
Write-Host "Root:    $Root"
Write-Host "Output:  $Out"
Write-Host "Schema:  $SchemaInventory"
Write-Host ""

# ── Clean and recreate output ──────────────────────────────────────────────────
if (Test-Path $Out) {
  Write-Host "Removing existing workspace..." -ForegroundColor Yellow
  Remove-Item $Out -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $Out | Out-Null

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 1 — CONTEXT GENERATION
# Runs before packaging so generated files are included in the bundle.
# ═══════════════════════════════════════════════════════════════════════════════

function Invoke-ContextGeneration {
  $shouldGenerate = ($Scope -eq "full" -and -not $SkipContext) -or $GenerateContext

  if (-not $shouldGenerate) {
    if ($SkipContext) {
      Write-Host "[Context] Skipped (--SkipContext passed)." -ForegroundColor DarkGray
    } else {
      Write-Host "[Context] Skipped for scope '$Scope' (pass -GenerateContext to force)." -ForegroundColor DarkGray
    }
    return
  }

  Write-Host ""
  Write-Host "── Phase 1: Context Generation ─────────────────────────────" -ForegroundColor Cyan
  Write-Host ""

  # Verify node is available
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Warning "[Context] node not found in PATH — skipping context generation."
    return
  }

  # Resolve generated schema path (output of generate-schema-inventory.mjs)
  $GeneratedSchema = Join-Path $Root ".context\schema_inventory.generated.json"

  # Schema inventory runs first and must succeed before any downstream generator.
  # If it fails (no DB connection), packaging halts immediately.
  Write-Host "  Generating: Schema Inventory (live DB)..." -ForegroundColor White
  $schemaStart = Get-Date
  try {
    $schemaResult = Invoke-Expression "cd `"$Root`" && node scripts/generate-schema-inventory.mjs" 2>&1
    if ($LASTEXITCODE -ne 0) {
      Write-Host ""
      Write-Host "ERROR: Schema inventory generation failed." -ForegroundColor Red
      Write-Host "Packaging halted. Fix the database connection and retry." -ForegroundColor Red
      Write-Host ""
      $schemaResult | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
      exit 1
    }
    $schemaElapsed = [math]::Round(((Get-Date) - $schemaStart).TotalSeconds, 1)
    Write-Host "  ✅ Schema Inventory ($($schemaElapsed)s)" -ForegroundColor Green
    $schemaResult | ForEach-Object { Write-Host "     $_" -ForegroundColor DarkGray }
  } catch {
    Write-Host ""
    Write-Host "ERROR: Schema inventory generation threw an exception: $_" -ForegroundColor Red
    Write-Host "Packaging halted." -ForegroundColor Red
    exit 1
  }

  # Downstream generators — pass the generated schema as the authoritative source.
  # If the generated schema is missing (shouldn't happen after success above), fall back
  # to the legacy schema_inventory.json path passed via -SchemaInventory.
  $schemaArg = if (Test-Path $GeneratedSchema) { $GeneratedSchema } else { $SchemaInventory }

  $scripts = @(
    @{ name = "Monorepo Context";   cmd = "node scripts/generate-monorepo-context.mjs" },
    @{ name = "Package Contexts";   cmd = "node scripts/generate-package-contexts.mjs" },
    @{ name = "Database Context";   cmd = "node scripts/generate-database-context.mjs `"$schemaArg`"" },
    @{ name = "Runtime Model";      cmd = "node scripts/generate-runtime-model.mjs `"$schemaArg`"" },
    @{ name = "System Inventory";   cmd = "node scripts/generate-system-inventory.mjs `"$schemaArg`"" },

    # P3.5 — Agenticity Infrastructure Expansion. These six do not take a
    # schema-path argument (none of them talk to the database directly —
    # table facts come from scripts/shared/table-ownership.mjs, the same
    # static map generate-database-context.mjs uses). generate-agent-entrypoints.mjs
    # is ordered last because it checks for the per-package docs the
    # "Package Contexts" step above produces (it degrades gracefully if run
    # first, but the "Read First" pointer is only populated when they exist).
    @{ name = "Architecture Graph";    cmd = "node scripts/generate-architecture-graph.mjs" },
    @{ name = "Dependency Impact";     cmd = "node scripts/generate-dependency-impact.mjs" },
    @{ name = "Behavior Contracts";    cmd = "node scripts/generate-behavior-contracts.mjs" },
    @{ name = "Runtime Trace Context"; cmd = "node scripts/generate-runtime-trace-context.mjs" },
    @{ name = "Architecture Fixes";    cmd = "node scripts/generate-architecture-fixes.mjs" },
    @{ name = "Agent Entrypoints";     cmd = "node scripts/generate-agent-entrypoints.mjs" }
  )

  foreach ($s in $scripts) {
    Write-Host "  Generating: $($s.name)..." -ForegroundColor White
    $startTime = Get-Date
    try {
      $result = Invoke-Expression "cd `"$Root`" && $($s.cmd)" 2>&1
      $elapsed = [math]::Round(((Get-Date) - $startTime).TotalSeconds, 1)
      Write-Host "  ✅ $($s.name) ($($elapsed)s)" -ForegroundColor Green
      if ($result) {
        $result | ForEach-Object { Write-Host "     $_" -ForegroundColor DarkGray }
      }
    } catch {
      Write-Warning "  ⚠ $($s.name) failed: $_"
      Write-Warning "     Bundle will continue without this context file."
    }
  }

  # Verify .context/ was created
  $contextDir = Join-Path $Root ".context"
  if (Test-Path $contextDir) {
    $contextFiles = (Get-ChildItem $contextDir -Recurse -File).Count
    Write-Host ""
    Write-Host "  Context directory: .context/ ($contextFiles files)" -ForegroundColor Cyan
  } else {
    Write-Warning "  .context/ directory was not created — check generator scripts."
  }

  # P4.2 — Generated Claude Bootstrap. Synthesizes CLAUDE_BOOTSTRAP.md from the
  # .context/ artifacts above, so it must run after every other generator in
  # this function, not alongside them in $scripts (it reads what they wrote;
  # it is not one more independent context generator).
  Write-Host ""
  Write-Host "  Generating: Claude Bootstrap..." -ForegroundColor White
  $bootstrapStart = Get-Date
  try {
    $bootstrapResult = Invoke-Expression "cd `"$Root`" && node scripts/generate-claude-bootstrap.mjs" 2>&1
    $bootstrapElapsed = [math]::Round(((Get-Date) - $bootstrapStart).TotalSeconds, 1)
    Write-Host "  ✅ Claude Bootstrap ($($bootstrapElapsed)s)" -ForegroundColor Green
    if ($bootstrapResult) {
      $bootstrapResult | ForEach-Object { Write-Host "     $_" -ForegroundColor DarkGray }
    }
  } catch {
    Write-Warning "  ⚠ Claude Bootstrap failed: $_"
    Write-Warning "     Bundle will continue without CLAUDE_BOOTSTRAP.md."
  }
}

# ═══════════════════════════════════════════════════════════════════════════════
# SHARED HELPER (unchanged from v1)
# ═══════════════════════════════════════════════════════════════════════════════

function Copy-Rel {
  param(
    [string]$Rel,
    [string]$Classification = "HARD",
    [string]$Note = ""
  )
  $src  = Join-Path $Root $Rel
  $dest = Join-Path $Out  $Rel

  if (-not (Test-Path $src)) {
    Write-Warning "[$Classification] MISSING (skipped): $Rel"
    return
  }

  $dir = Split-Path $dest -Parent
  New-Item -ItemType Directory -Force -Path $dir | Out-Null

  if (Test-Path $src -PathType Container) {
    Copy-Item $src $dest -Recurse -Force
    Write-Host "  [$Classification] $Rel\" -ForegroundColor $(if ($Classification -eq "HARD") { "White" } else { "Gray" })
  } else {
    Copy-Item $src $dest -Force
    Write-Host "  [$Classification] $Rel" -ForegroundColor $(if ($Classification -eq "HARD") { "White" } else { "Gray" })
  }

  if ($Note) { Write-Host "             → $Note" -ForegroundColor DarkGray }
}

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 2 — SOURCE PACKAGING (unchanged scope implementations from v1)
# ═══════════════════════════════════════════════════════════════════════════════

function Build-ArtifactScope {
  Write-Host ""
  Write-Host "── Phase 2: Source Packaging [artifact] ─────────────────────" -ForegroundColor Cyan
  Write-Host ""
  Write-Host "Copying HARD dependencies..." -ForegroundColor Green

  # ── Control Plane Layer ──────────────────────────────────────────────────
  Copy-Rel "packages\control-plane-layer\src\orchestrator.ts"    "HARD" "CPLOrchestrator.orchestrate() — main entry"
  Copy-Rel "packages\control-plane-layer\src\types.ts"           "HARD" "TaskType, QualityReport, BrandContext"
  Copy-Rel "packages\control-plane-layer\src\intake.ts"          "HARD" "Intent analysis → task_type detection"
  Copy-Rel "packages\control-plane-layer\src\artifact-pipeline.ts" "HARD" "executeArtifactPipeline + per-type pipelines"
  Copy-Rel "packages\control-plane-layer\src\run-control-plane.ts" "HARD" "runControlPlane() — public entry point"

  # ── Output Control Layer (restructured — nested subpaths) ───────────────
  Copy-Rel "packages\output-control-layer\src\index.ts"                                        "HARD" "OCL public index"
  Copy-Rel "packages\output-control-layer\src\output-normalizer\normalizeOutput.ts"            "HARD" "OCL entry point"
  Copy-Rel "packages\output-control-layer\src\output-normalizer\pipeline\cleanOutput.ts"       "HARD"
  Copy-Rel "packages\output-control-layer\src\output-normalizer\pipeline\extractJSON.ts"       "HARD"
  Copy-Rel "packages\output-control-layer\src\output-normalizer\pipeline\repairJSON.ts"        "HARD"
  Copy-Rel "packages\output-control-layer\src\output-normalizer\parser\parseArtifact.ts"       "HARD"
  Copy-Rel "packages\output-control-layer\src\artifact-compiler\compilers\carouselCompiler.ts" "HARD" "Reference compiler impl"
  Copy-Rel "packages\output-control-layer\src\artifact-compiler\compilers\deckCompiler.ts"     "HARD"
  Copy-Rel "packages\output-control-layer\src\artifact-compiler\compilers\reportCompiler.ts"   "HARD"
  Copy-Rel "packages\output-control-layer\src\artifact-compiler\compilers\newsletterCompiler.ts" "HARD"
  Copy-Rel "packages\output-control-layer\src\artifact-compiler\adapters\normalizeCarouselText.ts" "HARD"
  Copy-Rel "packages\output-control-layer\src\artifact-compiler\adapters\weakModelAdapter.ts"  "HARD"
  Copy-Rel "packages\output-control-layer\src\artifact-compiler\transformers\transformToCarouselSchema.ts" "HARD"
  Copy-Rel "packages\output-control-layer\src\artifact-compiler\transformers\transformToDeckSchema.ts"     "HARD"
  Copy-Rel "packages\output-control-layer\src\artifact-compiler\transformers\transformToReportSchema.ts"   "HARD"
  Copy-Rel "packages\output-control-layer\src\prompt-compiler\compilePromptFromContract.ts"    "HARD" "Prompt assembly — ARTIFACT_TASK_PROMPTS"
  Copy-Rel "packages\output-control-layer\src\contract-assembler\ContractAssemblerFactory.ts"  "HARD" "6-contributor registration"

  # ── Governance Layer ─────────────────────────────────────────────────────
  Copy-Rel "packages\governance-layer\src\contracts.ts"            "HARD" "GovernanceResult, SemanticValidationOutcome"
  Copy-Rel "packages\governance-layer\src\index.ts"                "HARD"
  Copy-Rel "packages\governance-layer\src\governanceEngine.ts"     "HARD"
  Copy-Rel "packages\governance-layer\src\carousel"                "HARD" "carousel validator + index"
  Copy-Rel "packages\governance-layer\src\deck"                    "HARD" "deck validator + index"
  Copy-Rel "packages\governance-layer\src\report"                  "HARD" "report validator + index"
  Copy-Rel "packages\governance-layer\src\newsletter"              "HARD" "newsletter validator + index"

  # ── Contracts ────────────────────────────────────────────────────────────
  Copy-Rel "packages\contracts\src"          "HARD" "Shared type contracts — single source of truth"
  Copy-Rel "packages\contracts\package.json" "HARD"

  # ── Artifact Engine Layer ────────────────────────────────────────────────
  Copy-Rel "packages\artifact-engine-layer\src\interfaces.ts"           "HARD" "ICompiler, IGovernanceAdapter, IExporter"
  Copy-Rel "packages\artifact-engine-layer\src\engine.ts"               "HARD"
  Copy-Rel "packages\artifact-engine-layer\src\registry.ts"             "HARD"
  Copy-Rel "packages\artifact-engine-layer\src\bootstrap.ts"            "HARD" "Register new artifact types here"
  Copy-Rel "packages\artifact-engine-layer\src\compiler\carousel.ts"    "HARD" "Reference ICompiler impl"
  Copy-Rel "packages\artifact-engine-layer\src\compiler\deck.ts"        "HARD"
  Copy-Rel "packages\artifact-engine-layer\src\compiler\report.ts"      "HARD"
  Copy-Rel "packages\artifact-engine-layer\src\compiler\newsletter.ts"  "HARD"
  Copy-Rel "packages\artifact-engine-layer\src\governance\carousel.ts"  "HARD" "Reference IGovernanceAdapter"
  Copy-Rel "packages\artifact-engine-layer\src\governance\deck.ts"      "HARD"
  Copy-Rel "packages\artifact-engine-layer\src\governance\report.ts"    "HARD"
  Copy-Rel "packages\artifact-engine-layer\src\governance\newsletter.ts" "HARD"

  # ── ISkill Runtime ───────────────────────────────────────────────────────
  Copy-Rel "packages\iskill-runtime\src\contracts\index.ts"         "HARD"
  Copy-Rel "packages\iskill-runtime\src\lifecycle\executor.ts"      "HARD" "6-phase lifecycle orchestrator"
  Copy-Rel "packages\iskill-runtime\src\registry\skill-registry.ts" "HARD"
  Copy-Rel "packages\iskill-runtime\src\repair\repair-registry.ts"  "HARD"
  Copy-Rel "packages\iskill-runtime\src\bootstrap.ts"               "HARD"
  Copy-Rel "packages\iskill-runtime\src\skills\carousel-founder.ts" "HARD" "Reference ISkillLifecycle impl"

  Write-Host ""
  Write-Host "Copying SOFT dependencies..." -ForegroundColor Yellow
  Copy-Rel "packages\shared-utils\src\json-utils.ts"                  "SOFT" "extractJSON, repairJSON (canonical)"
  Copy-Rel "packages\shared-utils\src\logger.ts"                      "SOFT"
  Copy-Rel "packages\shared-utils\src\resilience.ts"                  "SOFT"
  Copy-Rel "packages\iskill-runtime\src\execution\context-builder.ts" "SOFT"
  Copy-Rel "packages\iskill-runtime\src\governance\bridge.ts"         "SOFT"
  Copy-Rel "packages\governance-config\src\index.ts"                  "SOFT" "All governance thresholds"
  Copy-Rel "packages\artifact-config\src\index.ts"                    "SOFT"

  Write-Host ""
  Write-Host "Creating stubs..." -ForegroundColor Magenta
  $goldenDir = Join-Path $Out "golden-outputs"
  New-Item -ItemType Directory -Force -Path $goldenDir | Out-Null
@'
{
  "_readme": "Place reference artifact JSON files here for regression testing.",
  "_naming": "{task-type}-{id}.json  e.g. carousel-plg-failure.json"
}
'@ | Set-Content (Join-Path $goldenDir "README.json")

  $manifest = [ordered]@{
    created   = (Get-Date -Format "o")
    scope     = "artifact"
    purpose   = "Artifact quality iteration — OCL, governance, ISkill, prompt compiler"
    rootRepo  = $Root
    workspace = $Out
  }
  $manifest | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $Out "WORKSPACE_MANIFEST.json")

  Write-Host ""
  Write-Host "=== Artifact Workspace Ready ===" -ForegroundColor Green
}

function Build-RuntimeScope {
  Write-Host ""
  Write-Host "── Phase 2: Source Packaging [runtime] ──────────────────────" -ForegroundColor Cyan
  Write-Host ""
  Write-Host "Copying HARD dependencies..." -ForegroundColor Green

  Copy-Rel "packages\ai-runtime-layer\src\llmRouter.ts"          "HARD" "callWithMode() — main entry point"
  Copy-Rel "packages\ai-runtime-layer\src\AIRuntimeAdapter.ts"  "HARD"
  Copy-Rel "packages\ai-runtime-layer\src\registry.ts"          "HARD" "MODEL_REGISTRY"
  Copy-Rel "packages\ai-runtime-layer\src\generationModes.ts"   "HARD" "Runtime mode definitions (renamed from runtimeModes)"
  Copy-Rel "packages\ai-runtime-layer\src\index.ts"             "HARD"

  Copy-Rel "packages\ai-runtime-layer\src\provider-adapters\anthropic" "HARD"
  Copy-Rel "packages\ai-runtime-layer\src\provider-adapters\openai"    "HARD"
  Copy-Rel "packages\ai-runtime-layer\src\provider-adapters\google"    "HARD"
  Copy-Rel "packages\ai-runtime-layer\src\provider-adapters\ollama"    "HARD"
  Copy-Rel "packages\ai-runtime-layer\src\provider-adapters\lmstudio"  "HARD"
  Copy-Rel "packages\ai-runtime-layer\src\provider-adapters\deepseek"  "HARD"

  Copy-Rel "packages\ai-runtime-layer\src\router-engine"       "HARD"
  Copy-Rel "packages\ai-runtime-layer\src\runtime-engine"      "HARD"
  Copy-Rel "packages\ai-runtime-layer\src\config"              "HARD"
  Copy-Rel "packages\ai-runtime-layer\src\capability-registry" "HARD"

  Copy-Rel "packages\control-plane-layer\src\admin"                 "HARD"
  Copy-Rel "packages\control-plane-layer\src\types.ts"              "HARD"
  Copy-Rel "packages\control-plane-layer\src\run-control-plane.ts"  "HARD" "runControlPlane() — replaces old router.ts"
  Copy-Rel "packages\control-plane-layer\src\orchestrator.ts"       "HARD"

  Copy-Rel "apps\web\app\api\admin\providers\route.ts"     "HARD"
  Copy-Rel "apps\web\app\api\admin\settings\route.ts"      "HARD"
  Copy-Rel "apps\web\app\api\models\availability\route.ts" "HARD"

  Copy-Rel "packages\contracts\src"          "HARD"
  Copy-Rel "packages\contracts\package.json" "HARD"

  Write-Host ""
  Write-Host "Copying SOFT dependencies..." -ForegroundColor Yellow
  Copy-Rel "packages\ai-runtime-layer\src\telemetry-engine" "SOFT"
  Copy-Rel "packages\shared-utils\src\resilience.ts"        "SOFT"
  Copy-Rel "packages\shared-utils\src\logger.ts"            "SOFT"

  $manifest = [ordered]@{
    created   = (Get-Date -Format "o")
    scope     = "runtime"
    purpose   = "Runtime settings propagation and provider registration debugging"
    rootRepo  = $Root
    workspace = $Out
  }
  $manifest | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $Out "WORKSPACE_MANIFEST.json")

  Write-Host ""
  Write-Host "=== Runtime Workspace Ready ===" -ForegroundColor Green
}

function Build-FullScope {
  Write-Host ""
  Write-Host "── Phase 2: Source Packaging [full] ─────────────────────────" -ForegroundColor Cyan
  Write-Host ""

  $excludeDirs  = @("node_modules","dist",".next",".turbo","coverage",".git",".cache",".idea",".vscode",".vercel","build","out")
  $excludeFiles = @("*.tsbuildinfo",".env",".env.local",".env.production",".env.development","*.log","*.tmp","*.cache","*.lock")
  $excludeBinary = @("*.png","*.jpg","*.jpeg","*.gif","*.webp","*.mp4","*.mov","*.zip","*.tar","*.gz","*.pdf","*.pptx","*.xlsx","*.mp3")
  $allExcludedFiles = $excludeFiles + $excludeBinary

  function Copy-Canonical {
    param ([string]$Source, [string]$Destination)
    if (!(Test-Path $Source)) {
      Write-Host "  ⚠ Skipping missing: $Source" -ForegroundColor Yellow
      return
    }
    Write-Host "  Copying: $(Split-Path $Source -Leaf)"
    robocopy $Source $Destination /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP `
      /XD @excludeDirs /XF @allExcludedFiles
    if ($LASTEXITCODE -gt 7) { throw "robocopy failed for $Source (exit $LASTEXITCODE)" }
  }

  Write-Host "Copying source tree..." -ForegroundColor Green
  Copy-Canonical "$Root\apps"     "$Out\apps"
  Copy-Canonical "$Root\packages" "$Out\packages"
  Copy-Canonical "$Root\scripts"  "$Out\scripts"

  Write-Host "Copying root configs..." -ForegroundColor Green
  foreach ($f in @("package.json","turbo.json","tsconfig.json","tsconfig.base.json","README.md","pnpm-lock.yaml")) {
    if (Test-Path "$Root\$f") { Copy-Item "$Root\$f" $Out; Write-Host "  $f" }
  }

  # Safety cleanup
  Write-Host "Safety cleanup..." -ForegroundColor Yellow
  foreach ($d in $excludeDirs) {
    Get-ChildItem $Out -Recurse -Directory -Filter $d -ErrorAction SilentlyContinue |
      Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  }
  Get-ChildItem $Out -Recurse -Include "*.tsbuildinfo","*.log","*.tmp","*.cache","package-lock.json" -ErrorAction SilentlyContinue |
    Remove-Item -Force -ErrorAction SilentlyContinue

  # Verify AGENT_CONTEXT.md coverage
  Write-Host ""
  Write-Host "Verifying AGENT_CONTEXT.md coverage..." -ForegroundColor Cyan
  $contextPackages = @(
    "contracts","shared-utils","auth","ai-runtime-layer","output-control-layer",
    "governance-layer","iskill-runtime","artifact-engine-layer","brand-intelligence",
    "control-plane-layer","presentation-layer"
  )
  $missingCtx = @()
  foreach ($pkg in $contextPackages) {
    $ctxPath = "$Out\packages\$pkg\AGENT_CONTEXT.md"
    if (Test-Path $ctxPath) { Write-Host "  ✅ packages/$pkg" }
    else { Write-Host "  ❌ packages/$pkg AGENT_CONTEXT.md MISSING" -ForegroundColor Red; $missingCtx += $pkg }
  }
  if ($missingCtx.Count -gt 0) {
    Write-Host ""
    Write-Host "⚠ Missing AGENT_CONTEXT.md: $($missingCtx -join ', ')" -ForegroundColor Yellow
  }

  # Detect /dist/ leaks
  $distLeaks = Get-ChildItem "$Out\apps","$Out\packages" -Recurse -Include "*.ts","*.tsx" -ErrorAction SilentlyContinue |
    Select-String -Pattern "/dist/" -SimpleMatch | Select-Object -ExpandProperty Filename -Unique
  if ($distLeaks) {
    Write-Host ""
    Write-Host "⚠ /dist/ imports found in source:" -ForegroundColor Yellow
    $distLeaks | ForEach-Object { Write-Host "  $_" }
  } else {
    Write-Host "  ✅ No /dist/ imports in source"
  }

  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

  $auditCtx = @"
# BrandOS Claude Audit Package

Generated: $timestamp

## What's in this package

Canonical source-only package.

Included:
- apps/             (Next.js web app)
- packages/         (all @brandos/* packages)
- scripts/          (validation/bootstrap scripts)
- .context/         (generated architecture context — NEW)
- Root configs

Excluded:
- dist/, .next/, .turbo/
- node_modules/
- .env files
- transient files, binaries, caches

------------------------------------------------------------

## Start Here

0. CLAUDE_BOOTSTRAP.md (repo root) — START HERE. Generated synthesis of everything below: package/layer
                                      overview, required reading order, runtime flow highlights, critical
                                      packages, top 10 high-risk files, package ownership summary, the
                                      highest-value architectural rules, and the recommended agent workflow.
                                      Regenerated automatically by `scripts/package-workspace.ps1` via
                                      `node scripts/generate-claude-bootstrap.mjs` (P4.2). It is a synthesis,
                                      not a replacement — it cites the files below for anything beyond a summary.

Read files in this order:

1. .context/system_inventory.generated.md  — one-page system overview
2. .context/monorepo_context.generated.md  — full package inventory + rules
3. .context/runtime_model.generated.md     — generation flow + aggregate model
4. .context/database_context.generated.md  — full schema + ownership map
5. .context/packages/<pkg>.generated.md    — per-package detail

These files were auto-generated from authoritative sources immediately before
packaging. They supersede any architecture notes in CLAUDE_AUDIT_CONTEXT.md.

Agenticity layer (P3.5 — added on top of the above, derives from it, does not replace it):

6. .context/agent_entrypoints.generated.md   — START HERE if you only know which package you're
                                                touching: one block per package — read-first pointers,
                                                public API, allowed/forbidden deps, owned tables,
                                                high-risk areas, typical tasks, consumers, applicable rules
7. .context/architecture_graph.generated.json — same ownership/dependency facts as #1-2, machine-readable
8. .context/dependency_impact.generated.json  — blast-radius / risk level before modifying a package
9. .context/runtime_trace.generated.md        — actual runtime call flow, re-verified against source on
                                                every regeneration (not just a description of intent)
10. .context/behavior_contracts.generated.json — what the major cross-package calls do on success/failure
11. .context/architecture_fixes.generated.md   — live governance-script output paired with the
                                                recommended fix; advisory only, never auto-applied

------------------------------------------------------------

## Package Graph

L0  @brandos/contracts            Zero-dependency contracts and shared types
L1  @brandos/shared-utils         Shared utilities and infrastructure helpers
L2  @brandos/auth                 Authentication/session infrastructure
L3a @brandos/runtime-config       Runtime configuration schemas
L3a @brandos/governance-config    Governance configuration schemas
L3a @brandos/artifact-config      Artifact configuration schemas
L3a @brandos/ui-admin             Admin UI configuration schemas
L3b @brandos/ai-runtime-layer     Runtime execution, providers, adapters, routing
L3b @brandos/output-control-layer Output normalization and compilation
L4  @brandos/governance-layer     Validation and scoring
L4  @brandos/iskill-runtime       ISkill execution lifecycle
L5  @brandos/artifact-engine-layer Artifact generation pipeline
L6  @brandos/brand-intelligence   Brand identity accumulation and projection
L7  @brandos/control-plane-layer  Orchestration and configuration
L8  @brandos/presentation-layer   UI components and presentation shells
L9  apps/web                      Next.js application

------------------------------------------------------------


## Generation Pipeline

node scripts/generate-schema-inventory.mjs
node scripts/generate-monorepo-context.mjs
node scripts/generate-package-contexts.mjs
node scripts/generate-database-context.mjs
node scripts/generate-runtime-model.mjs
node scripts/generate-system-inventory.mjs

# P3.5 — Agenticity Infrastructure Expansion (run after the above; none of
# these take a schema-path argument — see scripts/shared/table-ownership.mjs)
node scripts/generate-architecture-graph.mjs
node scripts/generate-dependency-impact.mjs
node scripts/generate-behavior-contracts.mjs
node scripts/generate-runtime-trace-context.mjs
node scripts/generate-architecture-fixes.mjs
node scripts/generate-agent-entrypoints.mjs

# P4.2 — Generated Claude Bootstrap (run last; synthesizes the .context/
# artifacts above into CLAUDE_BOOTSTRAP.md at the repo root)
node scripts/generate-claude-bootstrap.mjs

## Validation Scripts

node scripts/check-workspace.mjs
node scripts/check-boundaries.mjs
node scripts/check-route-boundaries.mjs
node scripts/check-exports.mjs
node scripts/lint-imports.mjs
node scripts/check-circular.mjs
"@
  $auditCtx | Set-Content "$Out\CLAUDE_AUDIT_CONTEXT.md"

  $sizeMB = [math]::Round(
    (Get-ChildItem $Out -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1MB, 2)
  Write-Host ""
  Write-Host "Package size: $sizeMB MB"
  if ($sizeMB -gt 50) {
    Write-Host "⚠ Larger than expected — verify no binaries leaked" -ForegroundColor Yellow
  }

  $script:Zip = $true
}

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 3 — INCLUDE GENERATED CONTEXT IN BUNDLE
# ═══════════════════════════════════════════════════════════════════════════════

function Copy-GeneratedContext {
  $contextSrc = Join-Path $Root ".context"
  $contextDst = Join-Path $Out  ".context"

  if (-not (Test-Path $contextSrc)) {
    Write-Host ""
    Write-Host "[Context] No .context/ directory found — skipping inclusion." -ForegroundColor DarkGray
    return
  }

  Write-Host ""
  Write-Host "── Phase 3: Including Generated Context ─────────────────────" -ForegroundColor Cyan
  Write-Host ""

  if (Test-Path $contextDst) { Remove-Item $contextDst -Recurse -Force }
  Copy-Item $contextSrc $contextDst -Recurse -Force

  $files = (Get-ChildItem $contextDst -Recurse -File).Count
  Write-Host "  ✅ .context/ included ($files files)" -ForegroundColor Green

  # P4.2 — CLAUDE_BOOTSTRAP.md is generated at the repo root (it sits
  # alongside .context/, not inside it, since it's meant to be the first
  # thing opened, not one more file in a subfolder) — copy it into the
  # bundle the same way .context/ above is, so a packaged bundle (not just
  # the live repo) has it too.
  $bootstrapSrc = Join-Path $Root "CLAUDE_BOOTSTRAP.md"
  if (Test-Path $bootstrapSrc) {
    Copy-Item $bootstrapSrc (Join-Path $Out "CLAUDE_BOOTSTRAP.md") -Force
    Write-Host "  ✅ CLAUDE_BOOTSTRAP.md included" -ForegroundColor Green
  } else {
    Write-Host "  [Context] CLAUDE_BOOTSTRAP.md not found — skipping inclusion." -ForegroundColor DarkGray
  }
}

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 0 — RELEASE GATE
# Must pass before any packaging. Runs platform-verify + architecture-verify.
# Runtime verify is skipped here (no live env during packaging); it is run
# separately in CI as a prerequisite job.
# Use -SkipReleaseGate to bypass (CI only — not for production packaging).
# ═══════════════════════════════════════════════════════════════════════════════

if (-not $SkipReleaseGate) {
  Write-Host ""
  Write-Host "── Phase 0: Release Gate ─────────────────────────────────────" -ForegroundColor Cyan
  Write-Host ""

  $gateArgs = @("-SkipRuntime", "-SkipBuildCheck")
  if ($Force) {
    $gateArgs += "-Force"
    $gateArgs += "-ForceJustification"
    $gateArgs += "Invoked from package-workspace.ps1 with -Force"
  }

  & "$PSScriptRoot\release-gate.ps1" @gateArgs
  $gateExit = $LASTEXITCODE

  if ($gateExit -eq 1) {
    Write-Host ""
    Write-Host "  ❌ Release gate FAILED — packaging aborted." -ForegroundColor Red
    Write-Host "     Fix all FAIL findings before packaging." -ForegroundColor DarkGray
    Write-Host "     Run: .\scripts\release-gate.ps1 -Verbose for details." -ForegroundColor DarkGray
    exit 1
  }
  if ($gateExit -eq 2) {
    Write-Host ""
    Write-Host "  ⚠️  Release gate WARN — packaging requires sign-off." -ForegroundColor Yellow
    Write-Host "     Use -Force to override after reviewing reports/release-readiness.md" -ForegroundColor DarkGray
    exit 2
  }

  Write-Host "  ✅ Release gate passed — proceeding to packaging." -ForegroundColor Green
  Write-Host ""
}

# ═══════════════════════════════════════════════════════════════════════════════
# DISPATCH
# ═══════════════════════════════════════════════════════════════════════════════

# Phase 1 — Context generation
Invoke-ContextGeneration

# Phase 2 — Source packaging
switch ($Scope) {
  "artifact" { Build-ArtifactScope }
  "runtime"  { Build-RuntimeScope  }
  "full"     { Build-FullScope      }
}

# Phase 3 — Include .context/ in bundle
Copy-GeneratedContext

# ═══════════════════════════════════════════════════════════════════════════════
# ZIP
# ═══════════════════════════════════════════════════════════════════════════════

if ($Zip) {
  Write-Host ""
  Write-Host "── Phase 4: Creating ZIP Archive ────────────────────────────" -ForegroundColor Cyan
  Write-Host ""

  if (!(Test-Path $ZipDest)) { New-Item -ItemType Directory -Force -Path $ZipDest | Out-Null }

  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $zipName   = "brandos-$Scope-$timestamp.zip"
  $zipFile   = Join-Path $ZipDest $zipName

  if (Test-Path $zipFile) { Remove-Item $zipFile -Force }

  Compress-Archive -Path "$Out\*" -DestinationPath $zipFile -CompressionLevel Optimal -Force

  Write-Host "  ✅ $zipFile" -ForegroundColor Green
}

# ── Final summary ──────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "===============================================" -ForegroundColor Green
Write-Host "  ✅ Workspace ready  [$Scope]" -ForegroundColor Green
Write-Host "  $Out" -ForegroundColor White
Write-Host "===============================================" -ForegroundColor Green
Write-Host ""
