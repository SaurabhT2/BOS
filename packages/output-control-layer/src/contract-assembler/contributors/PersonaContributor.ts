/**
 * @brandos/output-control-layer — contract/contributors/PersonaContributor.ts
 *
 * PersonaContributor owns persona-to-contribution assembly directly (Fix G2).
 *
 * IntelligenceOS's role is cognition and memory — resolving brand signals
 * into a CognitionContext. Once resolved, the context flows to OCL for
 * prompt assembly. Persona field interpretation (voice -> IPersonaContribution)
 * is prompt assembly and lives here.
 *
 * RESPONSIBILITIES:
 *   1. Read voice fields from ContributorContext.cognitionContext
 *   2. Map them to IPersonaContribution (tone, voice, audiencePositioning, etc.)
 *   3. Apply brand memory gate
 *   4. Return null gracefully if voice is absent
 *
 * INVARIANTS:
 *   - No import from @brandos/cognition-client or @platform/cognition-contract
 *   - No LLM calls — pure field mapping
 *   - No delegation back into IntelligenceOS
 */

import type {
  IContractContributor,
  ContributorContext,
  IPersonaContribution,
} from '@brandos/contracts';

export class PersonaContributor implements IContractContributor<IPersonaContribution> {
  readonly contributorId = 'persona';

  async contribute(context: ContributorContext): Promise<IPersonaContribution | null> {
    // Brand Memory gate — when explicitly disabled, skip all persona injection
    if (context.applyBrandMemory === false) {
      return null;
    }

    // PLATFORM SPLIT: Read brand voice from cognitionContext.voice (primary path).
    // CPLOrchestrator populates context.cognitionContext from
    // @brandos/cognition-client's resolveCognitionContext() call.
    // ContributorContext.persona is the raw DB persona record forwarded from
    // the route handler — it is the fallback for callers that do not go
    // through the cognition resolution pipeline (e.g. tests, admin tooling).
    //
    // Resolution order:
    //   1. context.cognitionContext.voice  ← IntelligenceOS-resolved, preferred
    //   2. context.persona                 ← raw DB row, legacy / fallback
    const brandVoiceSource: unknown =
      context.cognitionContext?.voice ??
      context.persona;

    return this._assembleFromPersona(brandVoiceSource);
  }

  /**
   * Map a brandVoice object (or legacy persona DB row) to IPersonaContribution.
   *
   * Accepts:
   *   - Flat brandVoice object: { tone, voice, audienceType, ... }  ← BI-resolved primary
   *   - Legacy persona row: { brandVoice: { ... } } or { brand_voice: { ... } }
   *   - Legacy flat persona: { tone, ... }  ← same shape as brandVoice
   */
  private _assembleFromPersona(persona: unknown): IPersonaContribution | null {
    if (!persona) return null;

    // Support nested brandVoice (new format) or flat persona (legacy format)
    const brandVoice =
      (persona as Record<string, unknown>)?.['brandVoice'] ??
      (persona as Record<string, unknown>)?.['brand_voice'] ??
      persona;

    if (!brandVoice || typeof brandVoice !== 'object') return null;

    const bv = brandVoice as Record<string, unknown>;

    const tone                = bv['tone']                as string | undefined;
    const voice               = (bv['voice'] ?? bv['tone']) as string | undefined;
    const audiencePositioning = (bv['audiencePositioning'] ?? bv['audienceType']) as string | undefined;
    const brandName           = bv['brandName']           as string | undefined;
    const bannedPhrases       = bv['bannedPhrases']       as string[] | undefined;
    const executiveLevel      = bv['executiveLevel']      as string | undefined;
    const domain              = bv['domain']              as string | undefined;

    // Return null if there is no meaningful signal — avoids injecting an empty contribution
    if (!tone && !voice && !audiencePositioning && !brandName) return null;

    return {
      tone,
      voice,
      audiencePositioning,
      brandName,
      bannedPhrases,
      executiveLevel,
      domain,
    } as IPersonaContribution;
  }
}
