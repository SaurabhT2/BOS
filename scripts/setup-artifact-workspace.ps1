# scripts/setup-artifact-workspace.ps1
#
# BrandOS — Artifact Creation Workspace Bootstrap — v2
#
# PURPOSE:
#   Creates and configures an isolated workspace for AI agents focused on:
#   - OCL (Output Control Layer) compilation quality
#   - Governance scoring and validation rules
#   - Artifact type registration and pipeline expansion
#   - Prompt template engineering and quality scoring
#   - Brand memory and personalization content
#   - Carousel/deck/report artifact quality
#   - Presentation layer rendering (CarouselRenderer)
#   - Artifact export packaging
#
# USAGE:
#   .\scripts\setup-artifact-workspace.ps1
#   .\scripts\setup-artifact-workspace.ps1 -RepoRoot "C:\path\to\brandos-platform"
#   .\scripts\setup-artifact-workspace.ps1 -Force          # overwrite existing workspace
#   .\scripts\setup-artifact-workspace.ps1 -SkipValidation # skip post-setup checks
#   .\scripts\setup-artifact-workspace.ps1 -AgentId "artifact-agent-001"
#
# IDEMPOTENT: Safe to re-run. Existing files are preserved unless -Force is used.
#
# v2 changes:
#   - Dot-sources shared/preflight.ps1 for: Write-Header/Section/Step/Ok/Warn/Fail/Info/Debug2,
#     Invoke-Abort, Resolve-RepoRoot — removes 80 lines of duplicated boilerplate
#   - AGENT_MANIFEST.json: removed @brandos/identity-layer -> @brandos/brand-intelligence
#   - readOnlyPackages list corrected to canonical names

param(
    [string]  $RepoRoot        = "",
    [string]  $AgentId         = "artifact-agent-001",
    [switch]  $Force,
    [switch]  $SkipValidation,
    [switch]  $SkipEnvTemplate,
    [switch]  $Verbose
)

$ErrorActionPreference = "Stop"
$ScriptVersion         = "2.0.0"
$WorkspaceName         = "artifact-creation"
$StartTime             = Get-Date

# ── Shared utilities ──────────────────────────────────────────────────────────
$script:AccentColor = "DarkMagenta"
. "$PSScriptRoot\shared\preflight.ps1"

# ── Locate repo root ──────────────────────────────────────────────────────────
Write-Header "BrandOS Artifact Creation Workspace Setup v$ScriptVersion"
Write-Section "Locating Repository Root"

$RepoRoot = Resolve-RepoRoot -StartDir $PSScriptRoot -Specified $RepoRoot

$RootPkg = Join-Path $RepoRoot "package.json"
if (-not (Test-Path $RootPkg)) { Invoke-Abort "No package.json at repo root: $RootPkg" }
$RootPkgContent = Get-Content $RootPkg -Raw | ConvertFrom-Json
if ($RootPkgContent.name -ne "brandos-platform") {
    Write-Warn "Root package name is '$($RootPkgContent.name)' — expected 'brandos-platform'. Proceeding with caution."
}

$WorkspacesRoot = Join-Path $RepoRoot "_workspaces"
$WorkspaceDir   = Join-Path $WorkspacesRoot $WorkspaceName
Write-Info "Workspace will be created at: $WorkspaceDir"

# ── Ecosystem detection ───────────────────────────────────────────────────────
Write-Section "Detecting Ecosystem"

$Ecosystem = @{ pnpm=$false; turbo=$false; node=$false; git=$false; pnpmVersion=""; nodeVersion="" }

try {
    $nodeOut = & node --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        $Ecosystem.node = $true; $Ecosystem.nodeVersion = $nodeOut.Trim()
        Write-Ok "Node.js: $($Ecosystem.nodeVersion)"
        $nodeMaj = [int]($Ecosystem.nodeVersion -replace "v(\d+)\..*", '$1')
        if ($nodeMaj -lt 22) { Invoke-Abort "Node.js >= 22 required (24.x recommended). Found: $($Ecosystem.nodeVersion)" }
    }
} catch { Invoke-Abort "Node.js not found. Install Node.js >= 22 (24.x recommended)." }

try {
    $pnpmOut = & pnpm --version 2>&1
    if ($LASTEXITCODE -eq 0) { $Ecosystem.pnpm=$true; $Ecosystem.pnpmVersion=$pnpmOut.Trim(); Write-Ok "pnpm: $($Ecosystem.pnpmVersion)" }
} catch { Write-Warn "pnpm not found in PATH." }

try {
    $turboOut = & turbo --version 2>&1
    if ($LASTEXITCODE -eq 0) { $Ecosystem.turbo=$true; Write-Ok "Turborepo: $($turboOut.Trim())" }
} catch { Write-Warn "turbo not found — will use pnpm --filter directly." }

try {
    $gitOut = & git --version 2>&1
    if ($LASTEXITCODE -eq 0) { $Ecosystem.git=$true; Write-Ok "Git: $($gitOut.Trim())" }
} catch { Write-Warn "git not found." }

# Verify required packages exist (from canonical registry)
$requiredPkgsJson = node --input-type=module --eval `
    "import{KNOWN_PACKAGES}from'$($PSScriptRoot.Replace('\','/'))/shared/package-registry.mjs';process.stdout.write(JSON.stringify(KNOWN_PACKAGES.map(p=>p.dir)));"
$requiredPkgs = $requiredPkgsJson | ConvertFrom-Json
foreach ($pkg in $requiredPkgs) {
    if (Test-Path (Join-Path $RepoRoot $pkg)) { Write-Debug2 "Found: $pkg" }
    else { Write-Warn "Package not found: $pkg" }
}

# ── Directory structure ───────────────────────────────────────────────────────
Write-Section "Creating Workspace Directory Structure"

$Directories = @(
    $WorkspacesRoot, $WorkspaceDir,
    (Join-Path $WorkspaceDir ".agent"),
    (Join-Path $WorkspaceDir ".env"),
    (Join-Path $WorkspaceDir "cache"),
    (Join-Path $WorkspaceDir "cache\turbo"),
    (Join-Path $WorkspaceDir "cache\render"),
    (Join-Path $WorkspaceDir "logs"),
    (Join-Path $WorkspaceDir "logs\eval-runs"),
    (Join-Path $WorkspaceDir "logs\governance-scores"),
    (Join-Path $WorkspaceDir "logs\render-diffs"),
    (Join-Path $WorkspaceDir "reports"),
    (Join-Path $WorkspaceDir "reports\artifact-quality"),
    (Join-Path $WorkspaceDir "reports\governance-pass-rate"),
    (Join-Path $WorkspaceDir "reports\prompt-eval"),
    (Join-Path $WorkspaceDir "temp"),
    (Join-Path $WorkspaceDir "test-harness")
)

foreach ($dir in $Directories) {
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null; Write-Ok "Created: $dir" }
    else { Write-Debug2 "Exists:  $dir" }
}

$GitignorePath = Join-Path $WorkspaceDir ".gitignore"
if (-not (Test-Path $GitignorePath) -or $Force) {
    @"
temp/
logs/
cache/
workspace.lock
!cache/render/baselines/
!.env/artifact.env.template
!.agent/
!test-harness/
!reports/.gitkeep
"@ | Set-Content -Path $GitignorePath -Encoding UTF8
    Write-Ok "Created: .gitignore"
}

$BaselineDir = Join-Path $WorkspaceDir "cache\render\baselines"
if (-not (Test-Path $BaselineDir)) {
    New-Item -ItemType Directory -Path $BaselineDir -Force | Out-Null
    @"
# Render Baselines
Golden-set ArtifactV2 outputs for regression detection.
Format: `<hash>.json` where hash = sha256(prompt + personaId + runtimeMode)
Update explicitly after manual review — do not auto-overwrite.
"@ | Set-Content -Path (Join-Path $BaselineDir "README.md") -Encoding UTF8
    Write-Ok "Created: cache/render/baselines/"
}
foreach ($subdir in @("artifact-quality","governance-pass-rate","prompt-eval")) {
    $keepPath = Join-Path $WorkspaceDir "reports\$subdir\.gitkeep"
    if (-not (Test-Path $keepPath)) { New-Item -ItemType File -Path $keepPath -Force | Out-Null }
}

# ── Environment configuration ─────────────────────────────────────────────────
Write-Section "Configuring Environment"

$EnvTemplatePath = Join-Path $WorkspaceDir ".env\artifact.env.template"
$EnvActivePath   = Join-Path $WorkspaceDir ".env\artifact.env"

if (-not (Test-Path $EnvTemplatePath) -or $Force) {
    @"
# BrandOS — Artifact Creation Workspace Environment
# Copy to artifact.env and fill in values. This template is safe to commit.

# AI Provider Keys
ANTHROPIC_API_KEY=
OPENAI_API_KEY=

# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Workspace Identity (do not change)
BRANDOS_WORKSPACE=artifact-creation
BRANDOS_WORKSPACE_AGENT_ID=__AGENT_ID__

# Turbo Cache Isolation
TURBO_CACHE_DIR=__WORKSPACE_DIR__\cache\turbo
TURBO_TEAM=artifact-creation

# Artifact Quality Thresholds
ARTIFACT_GOVERNANCE_PASS_RATE_THRESHOLD=0.85
ARTIFACT_QUALITY_SCORE_THRESHOLD=72
ARTIFACT_REPAIR_RATE_THRESHOLD=0.15

# Eval Settings
ARTIFACT_EVAL_BATCH_SIZE=20
ARTIFACT_COMPARE_TO_BASELINE=1
ARTIFACT_AUTO_SAVE_BASELINE=0

# Render Cache
ARTIFACT_RENDER_CACHE_DIR=__WORKSPACE_DIR__\cache\render
"@ -replace "__AGENT_ID__", $AgentId `
   -replace "__WORKSPACE_DIR__", $WorkspaceDir `
| Set-Content -Path $EnvTemplatePath -Encoding UTF8
    Write-Ok "Created: .env/artifact.env.template"
}

if (-not (Test-Path $EnvActivePath)) {
    Copy-Item $EnvTemplatePath $EnvActivePath
    Write-Ok "Created: .env/artifact.env (from template — fill in API keys)"
} else { Write-Debug2 "Exists: .env/artifact.env (not overwritten)" }

# ── Agent manifest ────────────────────────────────────────────────────────────
Write-Section "Writing Agent Manifest and Instructions"

$ManifestPath = Join-Path $WorkspaceDir ".agent\AGENT_MANIFEST.json"
if (-not (Test-Path $ManifestPath) -or $Force) {
    @{
        workspaceId   = $WorkspaceName
        workspaceType = "artifact-creation"
        agentId       = $AgentId
        version       = $ScriptVersion
        createdAt     = (Get-Date -Format "o")
        repoRoot      = $RepoRoot
        workspaceDir  = $WorkspaceDir
        ownedPackages = @(
            "@brandos/output-control-layer",
            "@brandos/governance-layer",
            "@brandos/artifact-engine-layer"
        )
        ownedPresentationSubsets = @("presentation-layer/src/renderers/")
        ownedControlPlaneSubcontexts = @("brand-memory/","prompt-library/","scoring/","experiments/","webhooks/")
        ownedRoutes = @(
            "apps/web/app/api/artifact/",
            "apps/web/app/api/carousel/",
            "apps/web/app/api/export/",
            "apps/web/app/api/transform/"
        )
        readOnlyPackages = @(
            "@brandos/contracts",
            "@brandos/shared-utils",
            "@brandos/auth",
            "@brandos/brand-intelligence"       # corrected: was identity-layer
        )
        forbiddenPackages = @("@brandos/ai-runtime-layer","@brandos/iskill-runtime")
        forbiddenControlPlaneFiles = @("orchestrator.ts","router.ts","init.ts","policy/","admin/","identity/")
        pipelineInvariants = @(
            "normalizeOutput() ALWAYS runs before governance.validate()",
            "ArtifactV2 objects MUST have dollar-schema set before governance receives them",
            "JSON repair must not produce hallucinated content — only structural repair",
            "Never call governance with raw LLM output",
            "Governance validation bounded: max 2 repair attempts"
        )
        qualityThresholds = @{ governancePassRate=0.85; averageQualityScore=72; repairRateMax=0.15 }
        branchPrefixes    = @("feat/artifact/","fix/ocl/","improve/governance/","prompt/library/")
        testCommand       = "pnpm --filter @brandos/output-control-layer --filter @brandos/governance-layer --filter @brandos/artifact-engine-layer test"
        buildCommand      = "pnpm --filter @brandos/contracts --filter @brandos/shared-utils --filter @brandos/output-control-layer --filter @brandos/governance-layer --filter @brandos/artifact-engine-layer build"
        telemetryNamespace = "artifact-creation"
        setupScriptVersion = $ScriptVersion
    } | ConvertTo-Json -Depth 10 | Set-Content -Path $ManifestPath -Encoding UTF8
    Write-Ok "Created: .agent/AGENT_MANIFEST.json"
}

# ── Workspace lock ────────────────────────────────────────────────────────────
Write-Section "Creating Workspace Lock"
$LockPath = Join-Path $WorkspaceDir "workspace.lock"
if (-not (Test-Path $LockPath) -or $Force) {
    @{
        workspaceId    = $WorkspaceName; agentId = $AgentId
        lockedAt       = (Get-Date -Format "o"); status = "idle"
        lockedPackages = @("@brandos/output-control-layer","@brandos/governance-layer","@brandos/artifact-engine-layer")
        note = "Set status to 'active' when agent begins work. Set to 'idle' when done."
    } | ConvertTo-Json -Depth 5 | Set-Content -Path $LockPath -Encoding UTF8
    Write-Ok "Created: workspace.lock"
}

# ── Workspace manifest ────────────────────────────────────────────────────────
$WsManifestPath = Join-Path $WorkspaceDir "WORKSPACE_MANIFEST.json"
if (-not (Test-Path $WsManifestPath) -or $Force) {
    @{
        created            = (Get-Date -Format "o")
        workspaceId        = $WorkspaceName
        purpose            = "Artifact Creation — OCL quality, governance scoring, artifact type pipeline, prompt engineering, rendering"
        repoRoot           = $RepoRoot
        workspacePath      = $WorkspaceDir
        agentId            = $AgentId
        setupScriptVersion = $ScriptVersion
        turboCacheDir      = (Join-Path $WorkspaceDir "cache\turbo")
        turboTeam          = "artifact-creation"
        renderCacheDir     = (Join-Path $WorkspaceDir "cache\render")
        qualityThresholds  = @{ governancePassRate=0.85; averageQualityScore=72; repairRateMax=0.15 }
        ownedPackages = @(
            "packages/output-control-layer",
            "packages/governance-layer",
            "packages/artifact-engine-layer",
            "packages/presentation-layer/src/renderers/",
            "packages/control-plane-layer/src/brand-memory/",
            "packages/control-plane-layer/src/prompt-library/",
            "packages/control-plane-layer/src/scoring/",
            "packages/control-plane-layer/src/experiments/",
            "packages/control-plane-layer/src/webhooks/"
        )
        buildCommand = "pnpm --filter @brandos/contracts --filter @brandos/shared-utils --filter @brandos/output-control-layer --filter @brandos/governance-layer --filter @brandos/artifact-engine-layer build"
        validationCommands = @("node scripts/check-boundaries.mjs","node scripts/lint-imports.mjs","node scripts/check-circular.mjs")
    } | ConvertTo-Json -Depth 10 | Set-Content -Path $WsManifestPath -Encoding UTF8
    Write-Ok "Created: WORKSPACE_MANIFEST.json"
}

# ── Validation ────────────────────────────────────────────────────────────────
if (-not $SkipValidation) {
    Write-Section "Validating Setup"
    $ValidationErrors = @()
    $RequiredFiles = @(
        (Join-Path $WorkspaceDir ".agent\AGENT_MANIFEST.json"),
        (Join-Path $WorkspaceDir ".env\artifact.env.template"),
        (Join-Path $WorkspaceDir ".env\artifact.env"),
        (Join-Path $WorkspaceDir "workspace.lock"),
        (Join-Path $WorkspaceDir "WORKSPACE_MANIFEST.json")
    )
    foreach ($f in $RequiredFiles) {
        if (Test-Path $f) { Write-Ok "File exists: $(Split-Path $f -Leaf)" }
        else { $ValidationErrors += "Missing file: $f" }
    }
    if ($ValidationErrors.Count -gt 0) {
        foreach ($e in $ValidationErrors) { Write-Fail $e }
        Invoke-Abort "$($ValidationErrors.Count) validation error(s) found."
    }
}

# ── Summary ───────────────────────────────────────────────────────────────────
$Elapsed = (Get-Date) - $StartTime
Write-Host ""
Write-Header "ARTIFACT WORKSPACE SETUP COMPLETE"
Write-Host "  Workspace     : $WorkspaceDir" -ForegroundColor White
Write-Host "  Agent ID      : $AgentId" -ForegroundColor White
Write-Host "  Elapsed       : $([math]::Round($Elapsed.TotalSeconds, 1))s" -ForegroundColor White
Write-Host ""
Write-Host "  Next: fill .env\artifact.env API keys, then run:" -ForegroundColor Cyan
Write-Host "    .\test-harness\run-artifact-tests.ps1 -BuildFirst -GovernanceEval" -ForegroundColor Gray
Write-Host ""
