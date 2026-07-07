// ============================================================
// @brandos/output-control-layer — tests/unit/cognitionPropagation.test.ts
//
// REGRESSION TEST — platform split
//
// Replaces intelligencePropagation.test.ts / contractAssembly.test.ts
// (deleted), which regression-tested FIX-INTEL-001 through FIX-INTEL-005
// against the now-deleted BrandIntelligenceRuntime.resolveIdentityContribution()
// delegation path.
//
// This test guards the platform-split equivalent concern: that
// ContributorContext.cognitionContext.identity actually reaches the final
// compiled prompt, and is not silently dropped anywhere between
// IdentityContributor -> ContractAssembler -> compilePromptFromContract.
// ============================================================

import { describe, it, expect } from 'vitest';
import { IdentityContributor } from '../../src/contract-assembler/contributors/IdentityContributor';
import { PersonaContributor } from '../../src/contract-assembler/contributors/PersonaContributor';
import { compilePromptFromContract } from '../../src/prompt-compiler/compilePromptFromContract';
import { MINIMAL_CONTRIBUTOR_CONTEXT, CONTRIBUTOR_CONTEXT_WITH_BRAND } from '../fixtures';

describe('CognitionContext propagation (platform split)', () => {
  it('IdentityContributor returns null when cognitionContext.identity is absent', async () => {
    const contributor = new IdentityContributor();
    const result = await contributor.contribute(MINIMAL_CONTRIBUTOR_CONTEXT);
    expect(result).toBeNull();
  });

  it('IdentityContributor surfaces cognitionContext.identity fields unchanged', async () => {
    const contributor = new IdentityContributor();
    const result = await contributor.contribute(CONTRIBUTOR_CONTEXT_WITH_BRAND);
    expect(result).not.toBeNull();
    expect(result?.hookStyle).toBe('question');
    expect(result?.ctaIntent).toBe('Start today');
    expect(result?.preferredLength).toBe('medium');
  });

  it('PersonaContributor surfaces cognitionContext.voice fields unchanged', async () => {
    const contributor = new PersonaContributor();
    const result = await contributor.contribute(CONTRIBUTOR_CONTEXT_WITH_BRAND);
    expect(result).not.toBeNull();
    expect(result?.tone).toBe('confident');
    expect(result?.domain).toBe('saas');
  });

  it('identity data reaches the final compiled prompt (not silently dropped)', async () => {
    const identity = await new IdentityContributor().contribute(CONTRIBUTOR_CONTEXT_WITH_BRAND);
    const persona = await new PersonaContributor().contribute(CONTRIBUTOR_CONTEXT_WITH_BRAND);

    const compiled = compilePromptFromContract({
      intent: {
        taskType: 'post',
        topic: CONTRIBUTOR_CONTEXT_WITH_BRAND.userPrompt,
        confidence: 1,
        ambiguityLevel: 'none',
        userPrompt: CONTRIBUTOR_CONTEXT_WITH_BRAND.userPrompt,
      },
      runtime: { qualityThreshold: 65, maxAttempts: 3, autoRegenerate: false, attempt: 1 },
      identity: identity ?? undefined,
      persona: persona ?? undefined,
      artifact: undefined,
    } as any);

    // The compiled system prompt must actually contain the resolved identity
    // signal — this is the exact regression the deleted FIX-INTEL tests
    // guarded against (identity resolved but never reaching the LLM prompt).
    expect(compiled.system).toContain('question');
  });
});
