# scripts/setup-runtime-workspace.ps1
#
# BrandOS — Runtime Stabilization Workspace Bootstrap — v2
#
# PURPOSE:
#   Creates and configures an isolated workspace for AI agents focused on:
#   - LLM provider reliability and adapter debugging
#   - LLM router stabilization
#   - ISkill lifecycle execution
#   - Canonical pipeline integrity (runControlPlane → executeArtifactPipeline)
#   - Resilience primitives (CircuitBreaker, RateLimiter, retry)
#   - CI/CD and observability tooling
#
# USAGE:
#   .\scripts\setup-runtime-workspace.ps1
#   .\scripts\setup-runtime-workspace.ps1 -RepoRoot "C:\path\to\brandos-platform"
#   .\scripts\setup-runtime-workspace.ps1 -Force
#   .\scripts\setup-runtime-workspace.ps1 -SkipValidation
#   .\scripts\setup-runtime-workspace.ps1 -AgentId "runtime-agent-001"
#
# IDEMPOTENT: Safe to re-run. Existing files are preserved unless -Force is used.
#
# v2 changes:
#   - Dot-sources shared/preflight.ps1 (removes 80 lines of duplicated boilerplate)
#   - AGENT_MANIFEST.json: removed @brandos/identity-layer → @brandos/brand-intelligence

param(
    [string]  $RepoRoot        = "",
    [string]  $AgentId         = "runtime-agent-001",
    [switch]  $Force,
    [switch]  $SkipValidation,
    [switch]  $SkipEnvTemplate,
    [switch]  $Verbose
)

$ErrorActionPreference = "Stop"
$ScriptVersion         = "2.0.0"
$WorkspaceName         = "runtime-stabilization"
$StartTime             = Get-Date

# ── Shared utilities ──────────────────────────────────────────────────────────
$script:AccentColor = "DarkCyan"
. "$PSScriptRoot\shared\preflight.ps1"

# ── Locate repo root ──────────────────────────────────────────────────────────
Write-Header "BrandOS Runtime Stabilization Workspace Setup v$ScriptVersion"
Write-Section "Locating Repository Root"

$RepoRoot = Resolve-RepoRoot -StartDir $PSScriptRoot -Specified $RepoRoot

$RootPkg = Join-Path $RepoRoot "package.json"
if (-not (Test-Path $RootPkg)) { Invoke-Abort "No package.json at repo root: $RootPkg" }

$WorkspacesRoot = Join-Path $RepoRoot "_workspaces"
$WorkspaceDir   = Join-Path $WorkspacesRoot $WorkspaceName
Write-Info "Workspace will be created at: $WorkspaceDir"

# ── Ecosystem detection ───────────────────────────────────────────────────────
Write-Section "Detecting Ecosystem"

$Ecosystem = @{ pnpm=$false; turbo=$false; node=$false; git=$false; pnpmVersion=""; nodeVersion="" }

try {
    $nodeOut = & node --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        $Ecosystem.node=$true; $Ecosystem.nodeVersion=$nodeOut.Trim(); Write-Ok "Node.js: $($Ecosystem.nodeVersion)"
        $nodeMaj = [int]($Ecosystem.nodeVersion -replace "v(\d+)\..*", '$1')
        if ($nodeMaj -lt 22) { Invoke-Abort "Node.js >= 22 required (24.x recommended). Found: $($Ecosystem.nodeVersion)" }
    }
} catch { Invoke-Abort "Node.js not found. Install Node.js >= 22 (24.x recommended)." }

try {
    $pnpmOut = & pnpm --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        $Ecosystem.pnpm=$true; $Ecosystem.pnpmVersion=$pnpmOut.Trim(); Write-Ok "pnpm: $($Ecosystem.pnpmVersion)"
        $pnpmMaj = [int]($Ecosystem.pnpmVersion -replace "(\d+)\..*", '$1')
        if ($pnpmMaj -lt 9) { Write-Warn "pnpm >= 9 recommended. Found: $($Ecosystem.pnpmVersion)" }
    }
} catch { Write-Warn "pnpm not found in PATH." }

try {
    $turboOut = & turbo --version 2>&1
    if ($LASTEXITCODE -eq 0) { $Ecosystem.turbo=$true; Write-Ok "Turborepo: $($turboOut.Trim())" }
} catch { Write-Warn "turbo not found — will use pnpm --filter directly." }

try {
    $gitOut = & git --version 2>&1
    if ($LASTEXITCODE -eq 0) { $Ecosystem.git=$true; Write-Ok "Git: $($gitOut.Trim())" }
} catch { Write-Warn "git not found." }

# ── Directory structure ───────────────────────────────────────────────────────
Write-Section "Creating Workspace Directory Structure"

$Directories = @(
    $WorkspacesRoot, $WorkspaceDir,
    (Join-Path $WorkspaceDir ".agent"),
    (Join-Path $WorkspaceDir ".env"),
    (Join-Path $WorkspaceDir "cache"),
    (Join-Path $WorkspaceDir "cache\turbo"),
    (Join-Path $WorkspaceDir "logs"),
    (Join-Path $WorkspaceDir "logs\test-runs"),
    (Join-Path $WorkspaceDir "logs\provider-health"),
    (Join-Path $WorkspaceDir "reports"),
    (Join-Path $WorkspaceDir "reports\validation-runs"),
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
!.env/runtime.env.template
!.agent/
!test-harness/
!reports/.gitkeep
"@ | Set-Content -Path $GitignorePath -Encoding UTF8
    Write-Ok "Created: .gitignore"
}
foreach ($subdir in @("validation-runs")) {
    $keepPath = Join-Path $WorkspaceDir "reports\$subdir\.gitkeep"
    if (-not (Test-Path $keepPath)) { New-Item -ItemType File -Path $keepPath -Force | Out-Null }
}

# ── Environment configuration ─────────────────────────────────────────────────
Write-Section "Configuring Environment"

$EnvTemplatePath = Join-Path $WorkspaceDir ".env\runtime.env.template"
$EnvActivePath   = Join-Path $WorkspaceDir ".env\runtime.env"

if (-not (Test-Path $EnvTemplatePath) -or $Force) {
    @"
# BrandOS — Runtime Stabilization Workspace Environment
# Copy to runtime.env and fill in values. This template is safe to commit.

# AI Provider Keys
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GROQ_API_KEY=
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3

# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Workspace Identity (do not change)
BRANDOS_WORKSPACE=runtime-stabilization
BRANDOS_WORKSPACE_AGENT_ID=__AGENT_ID__

# Turbo Cache Isolation
TURBO_CACHE_DIR=__WORKSPACE_DIR__\cache\turbo
TURBO_TEAM=runtime-stabilization

# Runtime Testing
RUNTIME_DRY_RUN=0
NEXT_PUBLIC_APP_URL=http://localhost:3000
"@ -replace "__AGENT_ID__", $AgentId `
   -replace "__WORKSPACE_DIR__", $WorkspaceDir `
| Set-Content -Path $EnvTemplatePath -Encoding UTF8
    Write-Ok "Created: .env/runtime.env.template"
}

if (-not (Test-Path $EnvActivePath)) {
    Copy-Item $EnvTemplatePath $EnvActivePath
    Write-Ok "Created: .env/runtime.env (from template — fill in API keys)"
} else { Write-Debug2 "Exists: .env/runtime.env (not overwritten)" }

# ── Agent manifest ────────────────────────────────────────────────────────────
Write-Section "Writing Agent Manifest"

$ManifestPath = Join-Path $WorkspaceDir ".agent\AGENT_MANIFEST.json"
if (-not (Test-Path $ManifestPath) -or $Force) {
    @{
        workspaceId   = $WorkspaceName
        workspaceType = "runtime-stabilization"
        agentId       = $AgentId
        version       = $ScriptVersion
        createdAt     = (Get-Date -Format "o")
        repoRoot      = $RepoRoot
        workspaceDir  = $WorkspaceDir
        ownedPackages = @("@brandos/ai-runtime-layer","@brandos/iskill-runtime","@brandos/shared-utils")
        ownedControlPlaneSubcontexts = @("orchestrator.ts","router.ts","init.ts","policy/","admin/","identity/")
        ownedRoutes = @(
            "apps/web/app/api/generate/",
            "apps/web/app/api/generate-with-progress/",
            "apps/web/app/api/health/",
            "apps/web/app/api/admin/",
            "apps/web/app/api/models/"
        )
        readOnlyPackages = @(
            "@brandos/contracts",
            "@brandos/auth",
            "@brandos/brand-intelligence"         # corrected: was identity-layer
        )
        forbiddenPackages = @(
            "@brandos/output-control-layer",
            "@brandos/governance-layer",
            "@brandos/artifact-engine-layer",
            "@brandos/presentation-layer"
        )
        pipelineInvariants = @(
            "normalizeOutput() ALWAYS runs before governance.validate()",
            "executeArtifactPipeline() is the ONLY structured artifact entry point",
            "governance.validate() NEVER receives raw LLM output",
            "presentation-layer NEVER imported from control-plane-layer"
        )
        branchPrefixes    = @("fix/runtime/","stabilize/runtime/","chore/runtime/")
        testCommand       = "pnpm --filter @brandos/ai-runtime-layer --filter @brandos/iskill-runtime --filter @brandos/shared-utils test"
        buildCommand      = "pnpm --filter @brandos/contracts --filter @brandos/shared-utils --filter @brandos/ai-runtime-layer --filter @brandos/output-control-layer --filter @brandos/governance-layer --filter @brandos/iskill-runtime --filter @brandos/control-plane-layer build"
        telemetryNamespace = "runtime-stabilization"
        setupScriptVersion = $ScriptVersion
    } | ConvertTo-Json -Depth 10 | Set-Content -Path $ManifestPath -Encoding UTF8
    Write-Ok "Created: .agent/AGENT_MANIFEST.json"
}

# ── Workspace lock ────────────────────────────────────────────────────────────
Write-Section "Creating Workspace Lock"
$LockPath = Join-Path $WorkspaceDir "workspace.lock"
if (-not (Test-Path $LockPath) -or $Force) {
    @{
        workspaceId   = $WorkspaceName; agentId = $AgentId
        lockedAt      = (Get-Date -Format "o"); status = "idle"
        lockedPackages = @("@brandos/ai-runtime-layer","@brandos/iskill-runtime","@brandos/shared-utils")
        note = "Set status to 'active' when agent begins work. Set to 'idle' when done."
    } | ConvertTo-Json -Depth 5 | Set-Content -Path $LockPath -Encoding UTF8
    Write-Ok "Created: workspace.lock"
}

# ── Workspace manifest ────────────────────────────────────────────────────────
$WsManifestPath = Join-Path $WorkspaceDir "WORKSPACE_MANIFEST.json"
if (-not (Test-Path $WsManifestPath) -or $Force) {
    @{
        created           = (Get-Date -Format "o")
        workspaceId       = $WorkspaceName
        purpose           = "Runtime Stabilization — provider reliability, pipeline integrity, ISkill execution, resilience"
        repoRoot          = $RepoRoot
        workspacePath     = $WorkspaceDir
        agentId           = $AgentId
        setupScriptVersion = $ScriptVersion
        turboCacheDir     = (Join-Path $WorkspaceDir "cache\turbo")
        turboTeam         = "runtime-stabilization"
        ownedPackages     = @(
            "packages/ai-runtime-layer",
            "packages/iskill-runtime",
            "packages/shared-utils",
            "packages/control-plane-layer/src/orchestrator.ts",
            "packages/control-plane-layer/src/router.ts",
            "packages/control-plane-layer/src/init.ts",
            "packages/control-plane-layer/src/policy/",
            "packages/control-plane-layer/src/admin/",
            "packages/control-plane-layer/src/identity/"
        )
        criticalGaps      = @(
            "forceProvider missing from RoutingHint — needed for direct provider targeting",
            "No /api/admin/runtime-debug endpoint — cannot verify settings reach adapter",
            "CANONICAL_MODE_TO_PROVIDER in settings-service.ts and MODE_MAP in llmRouter.ts can diverge silently",
            "DeepSeek adapter is a stub — 4 activation steps required"
        )
        testCommands      = @{
            unit           = "pnpm --filter @brandos/ai-runtime-layer --filter @brandos/iskill-runtime --filter @brandos/shared-utils test"
            integration    = ".\test-harness\run-runtime-tests.ps1 -BuildFirst -ProviderHealth -PipelineE2E"
            providerHealth = "npx tsx test-harness\provider-health-check.ts"
        }
        buildCommand      = "pnpm --filter @brandos/contracts --filter @brandos/shared-utils --filter @brandos/ai-runtime-layer --filter @brandos/output-control-layer --filter @brandos/governance-layer --filter @brandos/iskill-runtime --filter @brandos/control-plane-layer build"
        validationCommands = @(
            "node scripts/check-boundaries.mjs",
            "node scripts/check-route-boundaries.mjs",
            "node scripts/lint-imports.mjs",
            "node scripts/check-circular.mjs"
        )
    } | ConvertTo-Json -Depth 10 | Set-Content -Path $WsManifestPath -Encoding UTF8
    Write-Ok "Created: WORKSPACE_MANIFEST.json"
}

# ── Validation ────────────────────────────────────────────────────────────────
if (-not $SkipValidation) {
    Write-Section "Validating Setup"
    $ValidationErrors = @()
    $RequiredFiles = @(
        (Join-Path $WorkspaceDir ".agent\AGENT_MANIFEST.json"),
        (Join-Path $WorkspaceDir ".env\runtime.env.template"),
        (Join-Path $WorkspaceDir ".env\runtime.env"),
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
Write-Header "RUNTIME WORKSPACE SETUP COMPLETE"
Write-Host "  Workspace     : $WorkspaceDir" -ForegroundColor White
Write-Host "  Agent ID      : $AgentId" -ForegroundColor White
Write-Host "  Elapsed       : $([math]::Round($Elapsed.TotalSeconds, 1))s" -ForegroundColor White
Write-Host ""
Write-Host "  Next: fill .env\runtime.env API keys, then run:" -ForegroundColor Cyan
Write-Host "    .\test-harness\run-runtime-tests.ps1 -BuildFirst -ProviderHealth" -ForegroundColor Gray
Write-Host ""
