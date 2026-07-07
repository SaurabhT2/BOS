# @brandos/iskill-runtime — Migration & Integration Guide

**Version:** 1.0.0  
**Status:** Week 1–4 Implementation  
**Authority:** Supersedes all prior ISkill runtime discussions

---

## 1. What This Package Resolves

From the Master Architecture Direction (Finding 1):

> **ISkill is an empty contract. Zero concrete ISkill.execute() implementations exist.**  
> The ISkill system is an interface contract without a runtime.

`@brandos/iskill-runtime` provides the missing runtime. After migration:

- `CarouselFounderSkill` is the first concrete governed skill execution
- Identity flows into every skill execution via `ISkillPersonalizationContext`
- Governance runs on every artifact via the `IGovernanceCaller` bridge
- ICP bundles are registered, not scattered

---

## 2. Current State vs Target State

| Concern | Current State | Target State (after migration) |
|---|---|---|
| ISkill execution | Empty interface, no implementations | CarouselFounderLifecycle running full 6-phase lifecycle |
| Identity injection | `IdentityResolver.resolve()` called but output discarded | `buildPersonalizationContext()` → `ISkillExecutionContext.personalization` → every skill |
| Artifact compilation | `artifact-pipeline.ts` directly imports OCL + governance | `compileCarousel` injected into context.metadata; engine governs via bridge |
| Bundle system | No bundle type, no registration, no runtime | `IBundleDefinition` + `AI_FOUNDER_GTM_BUNDLE` + `BundleRegistry` |
| Repair system | Hardcoded inline repair prompts in governance adapter | `RepairPromptRegistry` keyed by `(artifactType, violationReason)` |

---

## 3. Dependency Rule (MUST NOT VIOLATE)

```
@brandos/contracts        ← foundation (imports nothing)
@brandos/shared-utils     ← utilities (imports contracts only)
@brandos/iskill-runtime   ← skill runtime (imports ONLY contracts + shared-utils)
    ↑ consumes via injected IGovernanceCaller bridge
@brandos/artifact-engine-layer  ← NOT imported by iskill-runtime
@brandos/control-plane-layer    ← NOT imported by iskill-runtime
```

`@brandos/iskill-runtime` **never imports from artifact-engine-layer or control-plane-layer**.  
All integration happens through injected interfaces.

---

## 4. Integration Points

### 4.1 Governance Bridge (in `apps/web/instrumentation.ts`)

```typescript
import { bootstrapArtifactEngine, globalArtifactEngine } from '@brandos/artifact-engine-layer'
import { bootstrapSkillRuntime, createGovernanceBridge } from '@brandos/iskill-runtime'

// Existing bootstrap (already there):
bootstrapArtifactEngine()

// ADD: Bootstrap ISkill Runtime
const bridge = createGovernanceBridge(globalArtifactEngine)
bootstrapSkillRuntime({ governanceCaller: bridge })
```

### 4.2 Compile Carousel Injection

`CarouselFounderLifecycle.execute()` requires `context.metadata.compileCarousel` to be set.  
This is injected by the caller before executing a carousel skill.

```typescript
// In control-plane or API route:
import { compileCarouselArtifact } from '@brandos/output-control-layer'
import { getGlobalSkillRuntime, buildPersonalizationContext } from '@brandos/iskill-runtime'

const runtime = getGlobalSkillRuntime()

// Build personalization from brand memory
const personalization = buildPersonalizationContext(
  workspaceId,
  brandMemoryEntries,   // from BrandMemoryRepository
  personaId,
)

// Build context with compile injection
const context = await runtime.buildExecutionContext({
  requestId, userId, workspaceId,
  runtimeMode: 'cloud_pro',
  personalization,
  bundleId: 'ai-founder-gtm',
  metadata: {
    // Inject OCL compiler — keeps iskill-runtime decoupled from OCL
    compileCarousel: (raw: string, topic: string, tone?: string) =>
      compileCarouselArtifact(raw, { topic, tone }),
  },
})

// Execute
const output = await runtime.executeSkill(
  'carousel-founder',
  { topic, tone },
  context,
  async (prompt) => {
    // callLLM — call ai-runtime-layer
    const result = await aiRuntime.invoke({ prompt, mode: 'cloud_pro' })
    return result.output
  },
)
```

### 4.3 Identity Wiring (fixes Finding 2)

Replace the current discarded identity resolve:

```typescript
// BEFORE (resolver.ts result never used):
const identity = await identityResolver.resolve(workspaceId, personaId)
// identity never reaches compilePrompt()

// AFTER:
const entries = await brandMemoryRepository.getEntries(workspaceId, personaId)
const personalization = buildPersonalizationContext(workspaceId, entries, personaId)
// personalization flows into ISkillExecutionContext → every lifecycle phase
```

---

## 5. Phased Migration Plan

### Phase 1 — Week 1–2: Bootstrap (Zero Breakage)

**Goal:** Get iskill-runtime running alongside existing pipeline. Dual-registration mode.

**Changes:**
- Add `bootstrapSkillRuntime()` call to `apps/web/instrumentation.ts`
- Register `CarouselFounderSkill` in iskill-runtime
- Register `AI_FOUNDER_GTM_BUNDLE`
- No changes to existing `/api/carousel` or `/api/generate` routes yet

**Verification:**
```bash
# Server starts without errors
# /api/health returns 200
# globalSkillRuntime.listSkills() returns ['carousel-founder']
```

### Phase 2 — Week 2–3: Wire Identity

**Goal:** Fix Finding 2 — identity resolves AND enters execution.

**Files to modify:**
- `packages/control-plane-layer/src/orchestrator.ts`  
  - Call `identityResolver.resolve()` at the top of `runControlPlane()`
  - Map resolved identity to `IRawBrandMemoryEntry[]`
  - Call `buildPersonalizationContext()`
  - Pass personalization into `ISkillExecutionContext`

**Files to NOT modify yet:**
- `artifact-pipeline.ts` — leave this intact for now

**Verification:**
- Log `context.personalization.toSnapshot()` on every request
- Confirm `highConfidenceDimensions` grows as brand memory fills

### Phase 3 — Week 3–4: Route First Skill Through Runtime

**Goal:** `/api/carousel` calls `runtime.executeSkill('carousel-founder')` instead of `executeArtifactPipeline()`.

**Files to modify:**
- `apps/web/app/api/carousel/route.ts`
  - Replace `executeArtifactPipeline()` call with `runtime.executeSkill()`
  - Inject `compileCarousel` into context.metadata

**Files NOT yet changed:**
- `apps/web/app/api/generate/route.ts` — migrate in Phase 4

**Verification:**
- Carousel generation returns governed artifact
- Repair loop triggers and succeeds on low-richness output
- Identity context appears in `output.personalizationSnapshot`

### Phase 4 — Week 4–5: Migrate /api/generate

**Goal:** `/api/generate` also routes through ISkill runtime for carousel task type.

**Migration decision per taskType:**
- `carousel` → `runtime.executeSkill('carousel-founder')`
- `chat`, `transform`, etc. → remain in current control-plane path

**Files to modify:**
- `apps/web/app/api/generate/route.ts`

### Phase 5 — Month 2: Remove artifact-pipeline.ts

**Goal:** Delete `artifact-pipeline.ts` from control-plane. Resolves Finding 3 and removes the two-pipeline problem.

**Prerequisites:**
- Phases 1–4 complete and stable in production
- Zero routes importing from `artifact-pipeline.ts` directly

**Files to remove:**
```
packages/control-plane-layer/src/artifact-pipeline.ts
```

**Files to modify:**
- `packages/control-plane-layer/src/index.ts` — remove `artifact-pipeline` exports
- Any remaining routes still importing `executeArtifactPipeline` — replace with `runtime.executeSkill()`

**Verification:**
- Build succeeds with artifact-pipeline.ts deleted
- All carousel routes return governed artifacts
- `artifact-engine-layer`'s `globalArtifactEngine.compileAndGovern()` is the only carousel execution path

### Phase 6 — Month 2–3: Skill Expansion

Add `PostFounderSkill` as the second concrete skill:

```typescript
// packages/iskill-runtime/src/skills/post-founder.ts
// Register in bootstrap.ts
// Add to AI_FOUNDER_GTM_BUNDLE.skillIds
```

### Phase 7 — Month 3: Activate B2B SaaS Launch Bundle

- Register `DeckArtifact` compiler + governance in `artifact-engine-layer`
- Create `DeckFounderLifecycle` in `iskill-runtime`
- Set `B2B_SAAS_LAUNCH_BUNDLE.active = true`

---

## 6. Code to Remove (After Full Migration)

| File | Reason | When |
|---|---|---|
| `control-plane-layer/src/artifact-pipeline.ts` | Duplicates artifact-engine logic; two-pipeline problem | Month 2 (Phase 5) |
| `artifact-engine-layer/src/skill-registry.ts` duplicate export | SkillRuntime owns skill registration now | Month 2 |
| Hardcoded repair prompt strings in `governance/carousel.ts` | Replaced by `RepairPromptRegistry` | Month 2 |

## 7. Code to Modify

| File | Change |
|---|---|
| `apps/web/instrumentation.ts` | Add `bootstrapSkillRuntime()` |
| `control-plane-layer/src/orchestrator.ts` | Wire `identityResolver.resolve()` into personalization context |
| `apps/web/app/api/carousel/route.ts` | Route through `runtime.executeSkill()` |
| `apps/web/app/api/generate/route.ts` | Route carousel task through `runtime.executeSkill()` |
| `artifact-engine-layer/src/bootstrap.ts` | No change needed — engine bootstrap is separate |

## 8. Contracts NOT Changed

These contracts remain canonical in `@brandos/contracts`:
- `ISkill` — unchanged; iskill-runtime's `ISkillLifecycle` supplements it
- `SkillContext` — unchanged; `toSkillContext()` adapter produces it from `ISkillExecutionContext`
- `SkillMetadata` — unchanged; `ISkillRuntimeMetadata` extends it
- `IGovernanceResult` — unchanged; governance bridge returns it

---

## 9. Verification Plan

### A. Unit Tests

```bash
cd packages/iskill-runtime
npx vitest run
```

Expected: All tests in `__tests__/` pass:
- `personalization.test.ts` — 8 tests
- `registry.test.ts` — 12 tests
- `skill-runtime.test.ts` — 20 tests

### B. Integration Verification (after Phase 3)

```bash
# 1. Server starts clean
curl http://localhost:3000/api/health

# 2. Carousel generation returns governed artifact
curl -X POST http://localhost:3000/api/carousel \
  -H "Content-Type: application/json" \
  -d '{"topic":"Why B2B founders fail at content"}'
# Expect: artifact.artifact_type === 'carousel', generation_trace.skill_id === 'carousel-founder'

# 3. Skill runtime reports personalization
# Check server logs for:
# [SkillRegistry] Registered: carousel-founder v1.0.0 [carousel] dims:[hookStyle, ctaPatterns, tonePatterns, phraseLibrary]
# [BundleRegistry] Registered bundle: ai-founder-gtm
```

### C. Governance Verification

```typescript
// Test that governance runs (not bypassed)
// Add test brand memory with known hookStyle
// Generate carousel
// Verify output.artifact.slides[0].headline reflects hookStyle
// Verify output.repaired === false (clean first-pass generation)
```

### D. Repair Loop Verification

```typescript
// Force a governance failure by setting minRichnessScore very high
const ctx = await runtime.buildExecutionContext({
  ...params,
  governanceOverrides: { minRichnessScore: 0.99 }  // near-impossible threshold
})
const output = await runtime.executeSkill('carousel-founder', { topic: 'test' }, ctx, callLLM)
// Expect: output.repaired === true, output.repairAttempts > 0
// OR: output.error.code === 'REPAIR_EXHAUSTED' (if repair also fails)
```

### E. Bundle Capability Verification

```typescript
const caps = runtime.resolveBundleCapabilities('ai-founder-gtm')
// Expect: caps.availableSkills.length === 1
// Expect: caps.missingSkills.length === 0
// Expect: caps.governanceOverrides.minRichnessScore === 0.65
```

---

## 10. Rollback Strategy

**If iskill-runtime causes production issues:**

1. Remove `bootstrapSkillRuntime()` from `instrumentation.ts`
2. Revert `/api/carousel` and `/api/generate` to call `executeArtifactPipeline()` directly
3. `artifact-pipeline.ts` is NOT deleted until Phase 5 — it's the rollback target

The dual-registration approach in Phases 1–4 means the existing pipeline is always available as rollback.  
`artifact-pipeline.ts` must NOT be deleted before Phase 3 is stable in production.

---

## 11. Adding New Skills (Template)

```typescript
// 1. Create packages/iskill-runtime/src/skills/post-founder.ts
export interface PostFounderInput { topic: string; tone?: string }

export class PostFounderLifecycle implements ISkillLifecycle<PostFounderInput, PostArtifact> {
  readonly artifactContract = { artifactType: 'post' as ArtifactType, supportedFormats: ['json'] }
  readonly consumedDimensions: IdentityDimension[] = ['hookStyle', 'tonePatterns', 'ctaPatterns']
  readonly repairContract = { ... }

  validate(input: PostFounderInput): ISkillValidationResult { ... }
  async prepare(input, ctx): Promise<ISkillExecutionPlan<PostFounderInput>> { ... }
  async execute(plan, ctx, callLLM): Promise<ISkillExecutionResult<PostArtifact>> { ... }
}

// 2. In bootstrap.ts, add:
runtime.registerSkill(PostFounderSkillDef, new PostFounderLifecycle())

// 3. Add to AI_FOUNDER_GTM_BUNDLE.skillIds:
skillIds: ['carousel-founder', 'post-founder'],
```


