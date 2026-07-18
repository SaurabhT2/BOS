/**
 * @brandos/control-plane-layer — workspace-configuration/service.ts
 *
 * Cognitive Platform Evolution Program, Milestone 1 (Cognitive Ownership),
 * EM-1.2.
 *
 * CPL proxy for WorkspaceConfigurationClient.sync() — same
 * apps/web → CPL → cognition-client routing rule as brand-memory/service.ts
 * enforces for the CognitionProvider client: apps/web must NOT import
 * @brandos/cognition-client directly.
 *
 * Called from @brandos/auth's persona write path indirectly — auth cannot
 * import control-plane-layer either (auth sits below CPL in the dependency
 * graph; CPL depends on auth, not the reverse), so the actual call site is
 * in apps/web's persona route, calling both `updatePersona()`
 * (@brandos/auth, local write) and `syncWorkspaceConfiguration()` (this
 * file, IntelligenceOS write) — see apps/web/app/api/persona/route.ts.
 *
 * Exported from @brandos/control-plane-layer/src/index.ts:
 *   syncWorkspaceConfiguration
 */

import { getGlobalWorkspaceConfigurationClient } from '@brandos/cognition-client'
import type { PersonaTone } from '@brandos/contracts'

/**
 * The subset of a persona row this program's Milestone 1 knows how to map
 * onto WorkspaceConfigurationInput. Deliberately narrower than PersonaRow
 * (no id/timestamps/is_default — those are BrandOS-local bookkeeping
 * IntelligenceOS has no use for).
 */
export interface WorkspaceConfigurationSyncRequest {
  readonly workspaceId: string
  readonly name?: string | null
  readonly tone?: PersonaTone | null
  readonly domain?: string | null
  readonly audience?: string | null
  readonly keyThemes?: string[] | null
}

/**
 * syncWorkspaceConfiguration — push explicit, user-set brand configuration
 * to IntelligenceOS as Knowledge (ADR-003 §2.4).
 * Proxy for: WorkspaceConfigurationClient.sync()
 *
 * Returns null (rather than throwing) when the client isn't configured or
 * the call fails — matches getGlobalWorkspaceConfigurationClient()'s own
 * "degrade to local-only" contract (see that file's docblock) and
 * KnowledgeIngestClient's established fire-and-forget-tolerant pattern in
 * this codebase. Callers that persist this call's result (e.g. to record
 * `intelligence_asset_id` on the local persona row) must handle null.
 */
export async function syncWorkspaceConfiguration(
  request: WorkspaceConfigurationSyncRequest,
): Promise<{ assetId: string } | null> {
  const client = getGlobalWorkspaceConfigurationClient()
  if (!client) {
    console.warn(
      '[control-plane-layer] syncWorkspaceConfiguration: no WorkspaceConfigurationClient configured — skipping (persona edit stays local)',
    )
    return null
  }

  try {
    // Bug found via a live end-to-end run: IdentityConfiguration was
    // previously sent as `null` whenever keyThemes was empty — which it
    // always is for a freshly-created persona (see
    // apps/web/app/api/persona/route.ts's 'create' branch, `key_themes: []`
    // by default). IntelligenceOS's `applyIdentityConfiguration()` only
    // returns null when NONE of brandName/narrativeArcs/argumentationStyle/
    // namedFrameworks/preferredLength are defined — `brandName` alone is
    // sufficient for it to populate a real identity. Gating the whole
    // object behind keyThemes.length meant `identity` stayed null (and the
    // logs showed `hasIdentity=false`) for every workspace's first
    // generation, and for any workspace whose persona never accumulated
    // key themes at all — not the intended behavior; explicit
    // configuration is supposed to populate identity even with zero
    // learnings (see IntelligenceOS's own
    // "D-3 closure: explicit identity configuration populates identity
    // even with zero identity-relevant learnings" test).
    //
    // Now sends identityConfiguration whenever there is a name to report,
    // and includes namedFrameworks only when keyThemes actually has
    // content — matching what applyIdentityConfiguration() actually reads
    // field-by-field, instead of an all-or-nothing gate this file invented.
    const hasIdentityContent = Boolean(request.name) || Boolean(request.keyThemes?.length)

    return await client.sync({
      workspaceId: request.workspaceId,
      label: request.name ?? null,
      voiceConfiguration: {
        tone: request.tone ?? undefined,
        domain: request.domain ?? undefined,
        audienceType: request.audience ?? undefined,
        brandName: request.name ?? undefined,
      },
      identityConfiguration: hasIdentityContent
        ? {
            brandName: request.name ?? undefined,
            namedFrameworks: request.keyThemes?.length ? request.keyThemes : undefined,
          }
        : null,
    })
  } catch (err) {
    // Same degrade-don't-fail posture as recordBrandMemoryObservation():
    // a workspace-configuration sync failure must never fail the user's
    // persona edit, which has already succeeded locally by the time this
    // is called (see apps/web/app/api/persona/route.ts's call order).
    console.error('[control-plane-layer] syncWorkspaceConfiguration failed:', err)
    return null
  }
}
