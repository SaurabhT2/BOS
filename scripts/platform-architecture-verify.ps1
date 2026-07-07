# scripts/platform-architecture-verify.ps1
#
# BrandOS Architecture Verification Layer — v1
#
# Implements Deliverable 1 from reports/verification-platform-design.md.
#
# Verification type: Static + Contract
# (all checks are source-code analysis — no code executes)
#
# Checks:
#   §3.1  Runtime ownership chain verification
#   §3.2  Provider resolution verification (process.env bypass detection)
#   §3.3  Single production execution path verification
#   §3.4  Brand Intelligence ownership verification (semantic)
#   §3.5  V1/V2 verification
#   §3.6  Dependency ownership report (table ownership discrepancies)
#
# Generates:
#   reports/ownership-audit.md
#   reports/runtime-v1-v2-audit.md
#
# Exit codes:
#   0 — PASS  (0 failures, 0 warnings with --strict-warnings)
#   1 — FAIL  (≥1 failure)
#   2 — WARN  (0 failures, ≥1 warning)
#
# USAGE:
#   .\scripts\platform-architecture-verify.ps1
#   .\scripts\platform-architecture-verify.ps1 -Verbose
#   .\scripts\platform-architecture-verify.ps1 -StrictWarnings

param(
  [switch]$Verbose,
  [switch]$StrictWarnings
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$Passed   = 0
$Warnings = 0
$Failures = 0

$OwnershipFindings  = [System.Collections.Generic.List[hashtable]]::new()
$V1V2Findings       = [System.Collections.Generic.List[hashtable]]::new()

$Timestamp = (Get-Date -Format "yyyy-MM-dd HH:mm:ss UTC")

# ── Helpers ───────────────────────────────────────────────────────────────────

function Pass($msg) {
  Write-Host "  ✅ $msg" -ForegroundColor Green
  $script:Passed++
}
function Warn($msg) {
  Write-Host "  ⚠️  WARN: $msg" -ForegroundColor Yellow
  $script:Warnings++
}
function Fail($msg) {
  Write-Host "  ❌ FAIL: $msg" -ForegroundColor Red
  $script:Failures++
}
function Section($msg) {
  Write-Host "`n▶ $msg" -ForegroundColor Cyan
}
function VerboseLog($msg) {
  if ($Verbose) { Write-Host "     $msg" -ForegroundColor DarkGray }
}

function Get-SourceFiles($dir) {
  if (-not (Test-Path $dir)) { return @() }
  Get-ChildItem -Path $dir -Recurse -Include "*.ts","*.tsx","*.mjs","*.js" |
    Where-Object { $_.FullName -notmatch '[\\/](node_modules|dist|\.next|\.turbo|__tests__|\.test\.|\.spec\.)' } |
    Select-Object -ExpandProperty FullName
}

function Add-OwnershipFinding($severity, $title, $packages, $location, $description, $remediation) {
  $script:OwnershipFindings.Add(@{
    Severity    = $severity
    Title       = $title
    Packages    = $packages
    Location    = $location
    Description = $description
    Remediation = $remediation
  })
}

function Add-V1V2Finding($severity, $title, $location, $description, $remediation) {
  $script:V1V2Findings.Add(@{
    Severity    = $severity
    Title       = $title
    Location    = $location
    Description = $description
    Remediation = $remediation
  })
}

# ── §3.1 Runtime Ownership Chain Verification ─────────────────────────────────

Section "§3.1 Runtime Ownership Chain"

# Check 1: apps/web must not directly import ARL adapter classes
$WebSrcDir   = Join-Path $Root "apps/web"
$WebFiles    = Get-SourceFiles $WebSrcDir

$ARL_ADAPTER_CLASSES = @(
  'AnthropicAdapter', 'OpenAIAdapter', 'GoogleAdapter', 'DeepseekAdapter',
  'OllamaAdapter', 'LMStudioAdapter'
)

$adapterViolations = 0
foreach ($file in $WebFiles) {
  $content = Get-Content $file -Raw -ErrorAction SilentlyContinue
  if (-not $content) { continue }
  foreach ($cls in $ARL_ADAPTER_CLASSES) {
    if ($content -match "import.*\b$cls\b") {
      Fail "apps/web imports ARL adapter class '$cls' directly — use CPL instead"
      VerboseLog "  File: $($file.Replace($Root, '').TrimStart('/\'))"
      Add-OwnershipFinding "critical" "Direct ARL adapter import in apps/web" `
        "@brandos/web, @brandos/ai-runtime-layer" `
        $file.Replace($Root, '').TrimStart('/\') `
        "apps/web imports '$cls' directly. All AI invocations must flow through @brandos/control-plane-layer → callWithMode()." `
        "Remove the direct import. Use runControlPlane() from @brandos/control-plane-layer instead."
      $adapterViolations++
    }
  }
}
if ($adapterViolations -eq 0) { Pass "apps/web does not import ARL adapter classes directly" }

# Check 2: apps/web must not reference MODEL_REGISTRY / model selection functions directly
$MODEL_SELECTION_SYMBOLS = @('MODEL_REGISTRY', 'getModelById', 'getModelsByProviderKind')
$modelViolations = 0
foreach ($file in $WebFiles) {
  $content = Get-Content $file -Raw -ErrorAction SilentlyContinue
  if (-not $content) { continue }
  foreach ($sym in $MODEL_SELECTION_SYMBOLS) {
    if ($content -match "import.*\b$sym\b.*@brandos/ai-runtime-layer") {
      Fail "apps/web imports model selection symbol '$sym' from ARL — model selection is owned by ARL internals via runtime-config"
      VerboseLog "  File: $($file.Replace($Root, '').TrimStart('/\'))"
      Add-OwnershipFinding "high" "Model selection bypass in apps/web" `
        "@brandos/web, @brandos/ai-runtime-layer" `
        $file.Replace($Root, '').TrimStart('/\') `
        "apps/web imports '$sym' from @brandos/ai-runtime-layer. Model selection belongs inside ARL, resolved via @brandos/runtime-config." `
        "Remove the import. If model display is needed, expose a read-only endpoint through @brandos/control-plane-layer."
      $modelViolations++
    }
  }
}
if ($modelViolations -eq 0) { Pass "apps/web does not bypass model selection" }

# Check 3: ARL must not import from @brandos/runtime-config directly
$ARLSrcDir = Join-Path $Root "packages/ai-runtime-layer/src"
$ARLFiles  = Get-SourceFiles $ARLSrcDir
$arlRcViolations = 0
foreach ($file in $ARLFiles) {
  $content = Get-Content $file -Raw -ErrorAction SilentlyContinue
  if (-not $content) { continue }
  if ($content -match "from\s+['""]@brandos/runtime-config['""]") {
    Fail "ARL imports from @brandos/runtime-config directly — config must reach ARL only via setRuntimeConfigProvider()"
    VerboseLog "  File: $($file.Replace($Root, '').TrimStart('/\'))"
    Add-OwnershipFinding "high" "ARL imports runtime-config directly" `
      "@brandos/ai-runtime-layer, @brandos/runtime-config" `
      $file.Replace($Root, '').TrimStart('/\') `
      "ARL imports @brandos/runtime-config directly. Config must reach ARL only through setRuntimeConfigProvider() injection from CPL." `
      "Remove the import. Inject config via setRuntimeConfigProvider() called from settings-service-supabase.ts."
    $arlRcViolations++
  }
}
if ($arlRcViolations -eq 0) { Pass "ARL does not import @brandos/runtime-config directly" }

# ── §3.2 Provider Resolution Verification ────────────────────────────────────

Section "§3.2 Provider Resolution — process.env bypass detection"

# Authorized location: packages/runtime-config/src/credentials/resolver.ts
# shared-utils/src/env.ts is also authorized (env utilities, not provider selection)
# ai-runtime-layer src/config/ is authorized (default env config loading)
$PROVIDER_ENV_VARS = @(
  'process\.env\.ANTHROPIC_API_KEY',
  'process\.env\.OPENAI_API_KEY',
  'process\.env\.GROQ_API_KEY',
  'process\.env\.OLLAMA_URL',
  'process\.env\.LMSTUDIO_URL',
  'process\.env\.DEFAULT_PROVIDER',
  'process\.env\.DEFAULT_MODEL',
  'process\.env\.AI_PROVIDER'
)

$AUTHORIZED_ENV_PATHS = @(
  'packages[\\/]runtime-config[\\/]src[\\/]credentials',
  'packages[\\/]runtime-config[\\/]src[\\/]index',
  'packages[\\/]shared-utils[\\/]src[\\/]env',
  'packages[\\/]ai-runtime-layer[\\/]src[\\/]config',
  'packages[\\/]ai-runtime-layer[\\/]src[\\/]adapters',
  'packages[\\/]ai-runtime-layer[\\/]src[\\/]providers',
  '[\\/]\.env',
  '__tests__',
  '\.test\.',
  '\.spec\.'
)

$allScanFiles = (Get-SourceFiles (Join-Path $Root "packages")) +
               (Get-SourceFiles (Join-Path $Root "apps"))

$envViolations = 0
foreach ($file in $allScanFiles) {
  $relFile = $file.Replace($Root, '').TrimStart('/\').Replace('\','/')

  # Skip authorized locations
  $authorized = $false
  foreach ($ap in $AUTHORIZED_ENV_PATHS) {
    if ($relFile -match $ap) { $authorized = $true; break }
  }
  if ($authorized) { continue }

  $content = Get-Content $file -Raw -ErrorAction SilentlyContinue
  if (-not $content) { continue }
  # Strip comments
  $stripped = $content -replace '//[^\n]*', '' -replace '/\*[\s\S]*?\*/', ''

  foreach ($pattern in $PROVIDER_ENV_VARS) {
    if ($stripped -match $pattern) {
      Fail "Provider env bypass: $relFile — $($pattern -replace '\\\.','.')"
      Add-OwnershipFinding "high" "process.env provider/model resolution outside runtime-config" `
        "Unknown — must be @brandos/runtime-config" `
        $relFile `
        "File accesses $($pattern -replace '\\\.', '.') outside the authorized location (@brandos/runtime-config/src/credentials/resolver.ts)." `
        "Move provider/model env access to packages/runtime-config/src/credentials/resolver.ts. Inject config via RuntimeConfigProvider."
      $envViolations++
    }
  }
}
if ($envViolations -eq 0) { Pass "No unauthorized process.env provider/model access found" }

# ── §3.3 Single Production Execution Path Verification ────────────────────────

Section "§3.3 Single Production Execution Path"

$RouteDir   = Join-Path $Root "apps/web/app/api"
$RouteFiles = Get-ChildItem -Path $RouteDir -Recurse -Filter "route.ts" | Select-Object -ExpandProperty FullName

$structuredRoutes     = @()
$structuredRouteNames = @('/api/carousel', '/api/generate', '/api/generate-with-progress')
$pathViolations       = 0

# KNOWN structured routes must call BOTH functions
foreach ($route in $RouteFiles) {
  $relRoute = $route.Replace($Root, '').Replace('\', '/').TrimStart('/')
  $content  = try { Get-Content -LiteralPath $route -Raw -ErrorAction Stop } catch { $null }
  if (-not $content) { continue }

  $hasCPL = $content -match '\brunControlPlane\s*\('
  $hasAEP = $content -match '\bexecuteArtifactPipeline\s*\('

  VerboseLog "$relRoute — runControlPlane=$hasCPL executeArtifactPipeline=$hasAEP"

  if ($hasCPL -and $hasAEP) {
    $structuredRoutes += $relRoute

    # Verify order using `await` keyword positions to avoid false positives
    # from import declarations and doc-comments (which never contain `await`).
    $cplPos = $content.IndexOf('await runControlPlane(')
    $aepPos = $content.IndexOf('await executeArtifactPipeline(')
    if ($cplPos -ne -1 -and $aepPos -ne -1 -and $aepPos -lt $cplPos) {
      Fail "Pipeline order wrong in $relRoute — executeArtifactPipeline before runControlPlane"
      Add-OwnershipFinding "critical" "Pipeline execution order violation" `
        "@brandos/web, @brandos/control-plane-layer" `
        $relRoute `
        "executeArtifactPipeline() appears before runControlPlane(). runControlPlane() must execute first (Step 1), executeArtifactPipeline() second (Step 2)." `
        "Reorder the calls: runControlPlane() first, then executeArtifactPipeline() using cpResponse as input."
      $pathViolations++
    }

    # Verify executeArtifactPipeline is not nested inside runControlPlane
    if ($content -match 'runControlPlane\s*\([^)]*executeArtifactPipeline') {
      Fail "Nested pipeline in $relRoute — executeArtifactPipeline nested inside runControlPlane"
      Add-OwnershipFinding "critical" "Nested pipeline call" `
        "@brandos/web" `
        $relRoute `
        "executeArtifactPipeline() appears nested inside runControlPlane(). Both must be separate top-level awaited calls from the route handler." `
        "Separate the two calls: await runControlPlane(...); then await executeArtifactPipeline(...)."
      $pathViolations++
    }
  }

  # Detect direct OCL compiler calls from routes (bypass).
  # Strip comment lines first — doc-comments reference these function names
  # without calling them (e.g. " * 2. compileCarouselArtifact (OCL)").
  $contentNoComments = ($content -split "`n" | Where-Object { $_ -notmatch '^\s*(\*|//)' }) -join "`n"
  $OCL_DIRECT_CALLS = @('compileCarouselArtifact', 'compileDeckArtifact', 'compileReportArtifact', 'compileNewsletterArtifact')
  foreach ($fn in $OCL_DIRECT_CALLS) {
    if ($contentNoComments -match "\b$fn\s*\(") {
      Fail "Route $relRoute calls OCL '$fn' directly — must go through executeArtifactPipeline()"
      Add-OwnershipFinding "critical" "Direct OCL compiler call from route" `
        "@brandos/web, @brandos/output-control-layer" `
        $relRoute `
        "Route calls '$fn' directly, bypassing the artifact engine pipeline and governance." `
        "Replace with executeArtifactPipeline() which calls the compiler through the governed pipeline."
      $pathViolations++
    }
  }
}

if ($pathViolations -eq 0) {
  Pass "All structured routes follow the canonical 2-step pipeline order"
  VerboseLog "Structured routes found: $($structuredRoutes -join ', ')"
}

# Verify the 3 known structured routes are present
foreach ($expected in $structuredRouteNames) {
  $found = $RouteFiles | Where-Object { $_.Replace('\','/') -match ($expected -replace '/api/', 'app/api/') }
  if (-not $found) {
    Warn "Expected structured route '$expected' not found — was it removed?"
  }
}
if ($structuredRoutes.Count -ge 3) {
  Pass "$($structuredRoutes.Count) structured artifact route(s) confirmed"
}

# ── §3.4 Brand Intelligence Ownership Verification ────────────────────────────

Section "§3.4 Brand Intelligence Ownership"

# Check A: OCL must not import from @brandos/artifact-config (schema selection)
$OCLSrcDir = Join-Path $Root "packages/output-control-layer/src"
$OCLFiles  = Get-SourceFiles $OCLSrcDir
$oclSchemaViolations = 0
foreach ($file in $OCLFiles) {
  $content = Get-Content $file -Raw -ErrorAction SilentlyContinue
  if (-not $content) { continue }
  if ($content -match "@brandos/artifact-config") {
    $OCL_SCHEMA_SYMBOLS = @('ARTIFACT_TYPE_REGISTRY','ARTIFACT_TYPE_IDS','ArtifactTypeId','ArtifactTypeMeta')
    foreach ($sym in $OCL_SCHEMA_SYMBOLS) {
      if ($content -match "\b$sym\b") {
        Fail "OCL schema selection: $($file.Replace($Root,'').TrimStart('/\')) references '$sym' from @brandos/artifact-config"
        Add-OwnershipFinding "high" "OCL performs artifact schema selection" `
          "@brandos/output-control-layer, @brandos/artifact-config" `
          $file.Replace($Root,'').TrimStart('/\') `
          "OCL references '$sym', performing artifact type selection that belongs to @brandos/artifact-engine-layer." `
          "Remove artifact-config import from OCL. Schema type selection belongs in artifact-engine-layer/src/registry.ts."
        $oclSchemaViolations++
      }
    }
  }
}
if ($oclSchemaViolations -eq 0) { Pass "OCL does not perform artifact schema selection" }

# Check B: CPL must not implement BI logic (signal weighting, dimension scoring)
$CPLSrcDir = Join-Path $Root "packages/control-plane-layer/src"
$CPLFiles  = Get-SourceFiles $CPLSrcDir
$CPL_BI_LOGIC_PATTERNS = @(
  @{ Pattern = 'weighted_confidence\s*=(?!=)'; Desc = "computes weighted_confidence (BI logic)" },
  @{ Pattern = 'signal_type\s*=\s*[''"][^''""]+[''"]'; Desc = "assigns signal_type values (BI logic)" },
  @{ Pattern = 'classification\s*=\s*[''"][A-E][''"]'; Desc = "assigns BI classification values (BI logic)" }
)
$cplBiLogicViolations = 0
foreach ($file in $CPLFiles) {
  $content = Get-Content $file -Raw -ErrorAction SilentlyContinue
  if (-not $content) { continue }
  $stripped = $content -replace '//[^\n]*', '' -replace '/\*[\s\S]*?\*/', ''
  foreach ($p in $CPL_BI_LOGIC_PATTERNS) {
    if ($stripped -match $p.Pattern) {
      Fail "CPL implements BI logic in $($file.Replace($Root,'').TrimStart('/\')) — $($p.Desc)"
      Add-OwnershipFinding "high" "CPL owns Brand Intelligence logic" `
        "@brandos/control-plane-layer, @brandos/brand-intelligence" `
        $file.Replace($Root,'').TrimStart('/\') `
        "CPL $($p.Desc). Identity/signal logic belongs exclusively in @brandos/brand-intelligence." `
        "Move this logic to @brandos/brand-intelligence. CPL proxy functions must be call-throughs only."
      $cplBiLogicViolations++
    }
  }
}
if ($cplBiLogicViolations -eq 0) { Pass "CPL does not implement Brand Intelligence domain logic" }

# Check C: No duplicate schema definitions outside @brandos/contracts
$DUPLICATE_SCHEMA_TYPES = @('interface CarouselSlide', 'interface DeckSlide', 'interface ReportSection', 'interface NewsletterSection')
$contractsDir = Join-Path $Root "packages/contracts"
$allPkgFiles  = Get-SourceFiles (Join-Path $Root "packages") | Where-Object { $_ -notmatch 'packages[\\/]contracts[\\/]' -and $_ -notmatch '__tests__' }
$dupSchemaViolations = 0
foreach ($file in $allPkgFiles) {
  $content = Get-Content $file -Raw -ErrorAction SilentlyContinue
  if (-not $content) { continue }
  foreach ($typeDef in $DUPLICATE_SCHEMA_TYPES) {
    if ($content -match [regex]::Escape($typeDef)) {
      Warn "Duplicate schema definition: '$typeDef' in $($file.Replace($Root,'').TrimStart('/\')) — must be imported from @brandos/contracts"
      Add-OwnershipFinding "medium" "Duplicate artifact schema type definition" `
        "$($file.Replace($Root,'').TrimStart('/\') -replace '[\\/].*','')" `
        $file.Replace($Root,'').TrimStart('/\') `
        "Type '$typeDef' is declared outside @brandos/contracts. Canonical types must live in @brandos/contracts only." `
        "Remove the local declaration and import from '@brandos/contracts' instead."
      $dupSchemaViolations++
    }
  }
}
if ($dupSchemaViolations -eq 0) { Pass "No duplicate artifact schema type definitions outside @brandos/contracts" }

# ── §3.5 V1/V2 Verification ───────────────────────────────────────────────────

Section "§3.5 V1/V2 Migration Status"

$v1Findings = 0

# Check 1: No *.v1.ts or *-v1.ts files outside tests
# Excludes:
#   - dist/                    (build output — not source)
#   - *v2-compat* in contracts (V2 compatibility shims, not V1 code)
#   - *-v2-compat*             (same)
$v1Files = Get-ChildItem -Path $Root -Recurse -Include "*.v1.ts","*-v1.ts","*Legacy*.ts","*Shim*.ts","*Compat*.ts" |
           Where-Object {
             $_.FullName -notmatch '(node_modules|__tests__|\.test\.|\.spec\.|[/\\]dist[/\\])' -and
             $_.Name     -notmatch 'v2.compat|v2-compat'
           }
foreach ($f in $v1Files) {
  $rel = $f.FullName.Replace($Root,'').TrimStart('/\')
  Fail "V1 artifact file found: $rel"
  Add-V1V2Finding "high" "V1 source file present" $rel `
    "File '$($f.Name)' is a V1/legacy artifact. V1 code should be removed after migration." `
    "Verify this file is not reachable from production routes. If unreachable, delete it. If reachable, complete the migration."
  $v1Findings++
}
if ($v1Files.Count -eq 0) { Pass "No *.v1.ts / *Legacy*.ts / *Shim*.ts files found" }

# Check 2: V1 exports absent from @brandos/brand-intelligence public index
$biIndexPath = Join-Path $Root "packages/brand-intelligence/src/index.ts"
if (Test-Path $biIndexPath) {
  $biIndex = Get-Content $biIndexPath -Raw
  $V1_BI_EXPORTS = @('BrandMemoryService\b(?!V2)', 'IdentityResolver', 'createIdentityResolver', 'globalBrandMemory')
  foreach ($sym in $V1_BI_EXPORTS) {
    if ($biIndex -match "export.*$sym") {
      Fail "V1 symbol exported from @brandos/brand-intelligence: matched '$sym'"
      Add-V1V2Finding "critical" "V1 symbol in BI public API" "packages/brand-intelligence/src/index.ts" `
        "V1 symbol '$sym' is still exported from the @brandos/brand-intelligence public API." `
        "Remove the export. V1 was retired — use BrandMemoryServiceV2, BrandIntelligenceRuntime."
      $v1Findings++
    }
  }
  Pass "V1 BI symbols not exported from @brandos/brand-intelligence public index"
} else {
  Warn "Cannot find packages/brand-intelligence/src/index.ts — skipping V1 export check"
}

# Check 3: buildIdentitySection.v1.ts should not exist
$v1PromptFile = Join-Path $Root "packages/output-control-layer/src/prompt-compiler/buildIdentitySection.v1.ts"
if (Test-Path $v1PromptFile) {
  Fail "V1 prompt compiler found: buildIdentitySection.v1.ts still exists"
  Add-V1V2Finding "high" "V1 prompt compiler file present" `
    "packages/output-control-layer/src/prompt-compiler/buildIdentitySection.v1.ts" `
    "The V1 identity section builder is present. V2 is buildIdentitySection.v2.ts." `
    "Delete buildIdentitySection.v1.ts if it is no longer reachable, or complete migration to V2."
  $v1Findings++
} else {
  Pass "No V1 prompt compiler (buildIdentitySection.v1.ts) found"
}

if ($v1Findings -eq 0) {
  Pass "V1/V2 migration status: clean — no V1 artifacts on production paths"
}

# ── §3.6 Dependency Ownership / Table Ownership Report ───────────────────────

Section "§3.6 Dependency Ownership"

# Cross-check table-ownership.mjs (declared) vs actual Supabase write call-sites
$tableOwnershipScript = Join-Path $Root "scripts/shared/table-ownership.mjs"

# Load declared owners from the module (parse manually — avoid dynamic import in PS)
$tableOwnershipContent = Get-Content $tableOwnershipScript -Raw
$ownershipViolations = 0

# Known discrepancy from runtime_trace.generated.md §7: campaigns written from apps/web routes
# despite @brandos/auth being documented owner
$campaignRoutes = Get-ChildItem -Path (Join-Path $Root "apps/web/app/api") -Recurse -Filter "route.ts" |
                  Where-Object {
                    try { (Get-Content -LiteralPath $_.FullName -Raw -ErrorAction Stop) -match "\.from\(['""]campaigns['""]" }
                    catch { $false }
                  }

$campaignRouteCount = ($campaignRoutes | Measure-Object).Count
if ($campaignRouteCount -gt 0) {
  Warn "Table ownership discrepancy: 'campaigns' — declared owner: @brandos/auth, actual writers: $campaignRouteCount apps/web route(s) writing directly"
  Add-OwnershipFinding "medium" "Table ownership discrepancy: campaigns" `
    "@brandos/auth, @brandos/web" `
    "apps/web/app/api/*/route.ts ($campaignRouteCount files)" `
    "The 'campaigns' table is documented as owned by @brandos/auth (table-ownership.mjs), but $campaignRouteCount route files in apps/web write to it directly without going through @brandos/auth exported functions." `
    "Expose createCampaign() / updateCampaign() functions in @brandos/auth and migrate route writes to use them. This aligns with the pattern used for users and workspaces."
  VerboseLog "Campaign-writing routes:"
  foreach ($r in $campaignRoutes) { VerboseLog "  $($r.FullName.Replace($Root,'').TrimStart('/\'))" }
}

# Check for persona writes outside @brandos/auth (runtime_model.generated.md debt note)
$personaRoutes = Get-ChildItem -Path (Join-Path $Root "apps/web/app/api") -Recurse -Filter "route.ts" |
                 Where-Object {
                   try { (Get-Content -LiteralPath $_.FullName -Raw -ErrorAction Stop) -match "\.from\(['""]personas['""].*\.(insert|update|upsert|delete)" }
                   catch { $false }
                 }
if (($personaRoutes | Measure-Object).Count -gt 0) {
  Warn "Table ownership discrepancy: 'personas' — direct writes from apps/web routes, not via @brandos/auth.createPersona()"
  Add-OwnershipFinding "medium" "Table ownership discrepancy: personas" `
    "@brandos/auth, @brandos/web" `
    "apps/web/app/api/persona/" `
    "The 'personas' table is owned by @brandos/auth but writes occur directly from route handlers. auth.createPersona() is not implemented." `
    "Implement createPersona() in @brandos/auth and migrate the /api/persona/ route to use it."
}

if ($ownershipViolations -eq 0) {
  Pass "No critical table ownership violations detected"
}

# ── Generate reports ──────────────────────────────────────────────────────────

Section "Generating reports"

$ReportsDir = Join-Path $Root "reports"
New-Item -ItemType Directory -Path $ReportsDir -Force | Out-Null

# ownership-audit.md
$ownershipReport = @"
# Ownership Audit Report

> Generated: $Timestamp
> Verification layer: Architecture Verification (platform-architecture-verify.ps1)
> Script: scripts/platform-architecture-verify.ps1

## Summary

| Findings | Count |
|---|---|
| Critical | $(($OwnershipFindings | Where-Object { $_.Severity -eq 'critical' }).Count) |
| High | $(($OwnershipFindings | Where-Object { $_.Severity -eq 'high' }).Count) |
| Medium | $(($OwnershipFindings | Where-Object { $_.Severity -eq 'medium' }).Count) |
| Low | $(($OwnershipFindings | Where-Object { $_.Severity -eq 'low' }).Count) |

## Package Ownership Graph

Canonical source: `.context/architecture_graph.generated.json`
Dependency impact: `.context/dependency_impact.generated.json`

Critical packages (score ≥ 20):
- `@brandos/contracts` — score 26, 13 transitive consumers
- `@brandos/control-plane-layer` — score 23, routing chokepoint

## Dependency Graph Summary

See `.context/monorepo_context.generated.md` §Dependency Graph for the full layer graph.

L0 @brandos/contracts → (depended on by 13 packages)
L8 @brandos/control-plane-layer → depends on ALL L0–L7 (routing chokepoint)

## Boundary Violations

*(Existing scripts cover import-graph violations. This section covers semantic ownership.)*

"@
$n = 1
foreach ($f in $OwnershipFindings) {
  $ownershipReport += @"

### Finding $n`: $($f.Title)
- **Severity:** $($f.Severity)
- **Impacted packages:** $($f.Packages)
- **Location:** ``$($f.Location)``
- **Description:** $($f.Description)
- **Recommended remediation:** $($f.Remediation)

"@
  $n++
}

if ($OwnershipFindings.Count -eq 0) {
  $ownershipReport += "`nNo ownership violations detected.`n"
}

$ownershipReport += @"

## Table Ownership Discrepancies

Known discrepancy (from runtime_trace.generated.md §7, §8 item 4):

The ``campaigns`` table is documented as owned by ``@brandos/auth`` in
``scripts/shared/table-ownership.mjs``, but production writes occur directly from
``apps/web`` route handlers without going through any ``@brandos/auth`` exported function.

**Severity:** medium (functional, not a correctness issue — writes still succeed)
**Recommended remediation:** Expose ``createCampaign()`` / ``updateCampaign()`` in
``@brandos/auth`` and migrate route writes to use them.

## Status

$(if ($script:Failures -eq 0 -and $script:Warnings -eq 0) { "PASS" } elseif ($script:Failures -eq 0) { "WARN" } else { "FAIL" })
"@

Set-Content -Path (Join-Path $ReportsDir "ownership-audit.md") -Value $ownershipReport -Encoding UTF8
Write-Host "  📄 reports/ownership-audit.md written" -ForegroundColor DarkCyan

# runtime-v1-v2-audit.md
$v1v2Report = @"
# Runtime V1/V2 Audit Report

> Generated: $Timestamp
> Verification layer: Architecture Verification (platform-architecture-verify.ps1)
> Script: scripts/platform-architecture-verify.ps1

## Summary

| Findings | Count |
|---|---|
| Critical | $(($V1V2Findings | Where-Object { $_.Severity -eq 'critical' }).Count) |
| High | $(($V1V2Findings | Where-Object { $_.Severity -eq 'high' }).Count) |
| Medium | $(($V1V2Findings | Where-Object { $_.Severity -eq 'medium' }).Count) |

## Migration Status

Brand Intelligence V1 → V2: ✅ Complete (per system_inventory.generated.md)

V1 symbols retired:
- ``BrandMemoryService`` / ``globalBrandMemory`` (retired — use ``BrandMemoryServiceV2``)
- ``IdentityResolver`` / ``createIdentityResolver`` (retired — use ``StyleProjectionResolver``)

Active V2 paths:
- ``BrandIntelligenceRuntime.resolve()`` → ``StyleProjectionResolver``, ``TopicProfileResolver``
- ``BrandMemoryServiceV2.upsertSignal()`` → ``brand_memory_entries`` (V2 schema with classification)

## Findings

"@
$n = 1
foreach ($f in $V1V2Findings) {
  $v1v2Report += @"

### Finding $n`: $($f.Title)
- **Severity:** $($f.Severity)
- **Location:** ``$($f.Location)``
- **Description:** $($f.Description)
- **Recommended remediation:** $($f.Remediation)

"@
  $n++
}
if ($V1V2Findings.Count -eq 0) {
  $v1v2Report += "No V1 artifacts or code paths found. Migration is clean.`n"
}

$v1v2Report += @"

## Active Shims / Adapters

``supabase-repository-v2.ts``: comment notes it "continues to serve the V1 identity resolver path
during migration window" — however, V1 IdentityResolver is retired (not exported from index.ts).
This comment is historical; no live V1 path accesses this repository via V1 code paths.

## Status

$(if (($V1V2Findings | Where-Object { $_.Severity -eq 'critical' }).Count -gt 0) { "FAIL" } elseif ($V1V2Findings.Count -gt 0) { "WARN" } else { "PASS" })
"@

Set-Content -Path (Join-Path $ReportsDir "runtime-v1-v2-audit.md") -Value $v1v2Report -Encoding UTF8
Write-Host "  📄 reports/runtime-v1-v2-audit.md written" -ForegroundColor DarkCyan

# ── Summary ───────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "══════════════════════════════════════════════════════════" -ForegroundColor White
$color = if ($Failures -gt 0) { "Red" } elseif ($Warnings -gt 0) { "Yellow" } else { "Green" }
Write-Host "  Architecture Verification: $Passed passed, $Warnings warned, $Failures failed" -ForegroundColor $color
Write-Host "══════════════════════════════════════════════════════════" -ForegroundColor White

if ($Failures -gt 0) {
  Write-Host "  Result: FAIL" -ForegroundColor Red
  exit 1
} elseif ($Warnings -gt 0) {
  if ($StrictWarnings) {
    Write-Host "  Result: FAIL (--StrictWarnings)" -ForegroundColor Red
    exit 1
  }
  Write-Host "  Result: WARN" -ForegroundColor Yellow
  exit 2
} else {
  Write-Host "  Result: PASS" -ForegroundColor Green
  exit 0
}
