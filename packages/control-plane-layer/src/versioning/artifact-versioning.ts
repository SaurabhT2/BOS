/**
 * @brandos/control-plane-layer — versioning/artifact-versioning.ts
 *
 * ARTIFACT VERSIONING SERVICE
 *
 * Every artifact produced by the governed pipeline receives a version stamp.
 * Each version stores the full artifact snapshot so users can view and compare
 * any prior version of a piece of content.
 *
 * VERSION LINEAGE MODEL:
 *   - Lineage key: campaign_id (the persisted identity of a piece of content)
 *   - Version N: created when a user regenerates or edits an existing campaign
 *   - Version 1: always the first generation for a campaign_id
 *   - stamp() writes a provisional row (campaign_id=null, version=1) before the
 *     campaign row exists; linkAndFinalizeVersion() resolves the real version
 *     once the owning campaign is inserted (two-phase commit pattern)
 *   - For regeneration (future): pass campaignId to stamp() — version is resolved
 *     immediately as COUNT(existing)+1 with no provisional row needed
 *
 * STORED ARTIFACT:
 *   Every version now stores a snapshot of the ArtifactV2 payload in
 *   stored_artifact (jsonb). This enables:
 *     - "Show me version 2 of this carousel" — retrieve exact prior content
 *     - Diff/compare views (future) — compare two stored_artifact payloads
 *     - Rollback — re-generate from a prior version's stored content
 *
 * PERSISTENCE:
 *   brandos_artifact_versions (migration: supabase/migrations/20260621_artifact_versions.sql)
 *   stored_artifact column added in the same migration.
 */

import type { ArtifactV2 } from '@brandos/contracts'

export interface VersionStampOptions {
  requestId:    string
  workspaceId:  string
  score:        number
  artifactType?: string
  /**
   * Pass when REGENERATING an existing campaign (future regenerate/edit flows).
   * When provided, the row is inserted already linked — linkAndFinalizeVersion()
   * does not need to be called separately, and the version number is resolved
   * immediately via COUNT(*)+1.
   *
   * Omit for brand-new generations (the common case) — the route calls
   * linkAndFinalizeVersion() after the campaigns row exists.
   */
  campaignId?: string
}

export interface ArtifactVersion {
  version:      number
  requestId:    string
  workspaceId:  string
  score:        number
  stampedAt:    string
  artifactType?: string
  campaignId?:  string | null
  /** Full artifact snapshot stored at version stamp time */
  storedArtifact?: ArtifactV2 | null
}

export class ArtifactVersioningService {
  /**
   * Stamp an artifact with version metadata and store its full snapshot.
   *
   * Returns the artifact with version data embedded in generation_trace.
   * The original artifact is not mutated — a new object is returned.
   *
   * Fast path — does not block on a DB read. If opts.campaignId is not
   * provided (the common case), the persisted row starts as version 1
   * with campaign_id = null; call linkAndFinalizeVersion() once the owning
   * campaign is known to resolve the real version number.
   */
  stamp<T extends ArtifactV2>(artifact: T, opts: VersionStampOptions): T {
    const stampedAt = new Date().toISOString()
    const versionStamp: ArtifactVersion = {
      version:       1, // Provisional — resolved by linkAndFinalizeVersion()
      requestId:     opts.requestId,
      workspaceId:   opts.workspaceId,
      score:         opts.score,
      stampedAt,
      artifactType:  opts.artifactType,
      campaignId:    opts.campaignId ?? null,
      storedArtifact: artifact,
    }

    const existingTrace = (artifact as any).generation_trace ?? {}
    const stamped = {
      ...artifact,
      generation_trace: {
        ...existingTrace,
        version_stamp: versionStamp,
        generated_at:  existingTrace.generated_at ?? stampedAt,
        request_id:    opts.requestId,
        workspace_id:  opts.workspaceId,
      },
    } as T

    // Persist fire-and-forget
    if (opts.campaignId) {
      void this._insertLinkedVersion(versionStamp, opts.campaignId, artifact)
    } else {
      void this._persistVersionStamp(versionStamp, artifact)
    }

    return stamped
  }

  /**
   * Link a provisional version stamp (written by stamp() without a campaignId)
   * to its now-known campaign and resolve the real version number.
   *
   * Call this from the route immediately after inserting the campaigns row.
   * Returns the resolved version number, or null if linking did not occur.
   *
   * Best-effort — never throws.
   */
  async linkAndFinalizeVersion(
    requestId:    string,
    workspaceId:  string,
    campaignId:   string
  ): Promise<number | null> {
    try {
      const supabase = await this._getSupabase()
      if (!supabase) return null

      // Real version = COUNT(existing linked versions for this campaign) + 1
      // On first link this is 0 + 1 = 1 — a genuine count, not a hardcoded literal.
      const { count, error: countError } = await supabase
        .from('brandos_artifact_versions')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaignId)

      if (countError) {
        if (this._isTableMissing(countError)) { this._warnTableMissingOnce(); return null }
        console.warn('[ArtifactVersioning] linkAndFinalizeVersion count failed:', countError.message)
        return null
      }

      const resolvedVersion = (count ?? 0) + 1

      const { error: updateError } = await supabase
        .from('brandos_artifact_versions')
        .update({ campaign_id: campaignId, version: resolvedVersion })
        .eq('request_id', requestId)
        .eq('workspace_id', workspaceId)
        .is('campaign_id', null)

      if (updateError) {
        if (this._isTableMissing(updateError)) { this._warnTableMissingOnce(); return null }
        console.warn('[ArtifactVersioning] linkAndFinalizeVersion update failed:', updateError.message)
        return null
      }

      return resolvedVersion
    } catch (err: any) {
      console.warn('[ArtifactVersioning] linkAndFinalizeVersion error:', err?.message)
      return null
    }
  }

  /**
   * Retrieve all versions of a campaign, oldest first.
   * Workspace-isolated — campaignId alone is not sufficient.
   */
  async getVersions(
    campaignId:  string,
    workspaceId: string
  ): Promise<{ versions: ArtifactVersion[]; source: 'supabase' | 'unavailable' }> {
    try {
      const supabase = await this._getSupabase()
      if (!supabase) return { versions: [], source: 'unavailable' }

      const { data, error } = await supabase
        .from('brandos_artifact_versions')
        .select('request_id, workspace_id, campaign_id, artifact_type, version, score, stamped_at, stored_artifact')
        .eq('campaign_id', campaignId)
        .eq('workspace_id', workspaceId)
        .order('version', { ascending: true })

      if (error) {
        if (this._isTableMissing(error)) { this._warnTableMissingOnce(); return { versions: [], source: 'unavailable' } }
        console.warn('[ArtifactVersioning] getVersions failed:', error.message)
        return { versions: [], source: 'unavailable' }
      }

      return {
        versions: (data ?? []).map((row: any) => ({
          version:        row.version,
          requestId:      row.request_id,
          workspaceId:    row.workspace_id,
          score:          row.score,
          stampedAt:      row.stamped_at,
          artifactType:   row.artifact_type,
          campaignId:     row.campaign_id,
          storedArtifact: row.stored_artifact ?? null,
        })),
        source: 'supabase',
      }
    } catch (err: any) {
      console.warn('[ArtifactVersioning] getVersions error:', err?.message)
      return { versions: [], source: 'unavailable' }
    }
  }

  /**
   * Retrieve a single version's stored artifact.
   * Used to restore or preview a specific version.
   */
  async getVersionArtifact(
    campaignId:  string,
    version:     number,
    workspaceId: string
  ): Promise<{ artifact: ArtifactV2 | null; source: 'supabase' | 'unavailable' }> {
    try {
      const supabase = await this._getSupabase()
      if (!supabase) return { artifact: null, source: 'unavailable' }

      const { data, error } = await supabase
        .from('brandos_artifact_versions')
        .select('stored_artifact')
        .eq('campaign_id', campaignId)
        .eq('workspace_id', workspaceId)
        .eq('version', version)
        .single()

      if (error) {
        if (this._isTableMissing(error)) { this._warnTableMissingOnce(); return { artifact: null, source: 'unavailable' } }
        return { artifact: null, source: 'unavailable' }
      }

      return { artifact: (data as any)?.stored_artifact ?? null, source: 'supabase' }
    } catch (err: any) {
      console.warn('[ArtifactVersioning] getVersionArtifact error:', err?.message)
      return { artifact: null, source: 'unavailable' }
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private async _insertLinkedVersion(stamp: ArtifactVersion, campaignId: string, artifact: ArtifactV2): Promise<void> {
    try {
      const supabase = await this._getSupabase()
      if (!supabase) return

      const { count, error: countError } = await supabase
        .from('brandos_artifact_versions')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaignId)

      if (countError) {
        if (this._isTableMissing(countError)) { this._warnTableMissingOnce(); return }
        console.warn('[ArtifactVersioning] _insertLinkedVersion count failed:', countError.message)
        return
      }

      const resolvedVersion = (count ?? 0) + 1

      const { error } = await supabase.from('brandos_artifact_versions').insert({
        request_id:       stamp.requestId,
        workspace_id:     stamp.workspaceId,
        campaign_id:      campaignId,
        artifact_type:    stamp.artifactType ?? null,
        version:          resolvedVersion,
        score:            stamp.score,
        stamped_at:       stamp.stampedAt,
        stored_artifact:  artifact,
      })

      if (error && !this._isTableMissing(error)) {
        console.warn('[ArtifactVersioning] _insertLinkedVersion failed:', error.message)
      } else if (error) {
        this._warnTableMissingOnce()
      }
    } catch (err: any) {
      console.warn('[ArtifactVersioning] _insertLinkedVersion error:', err?.message)
    }
  }

  private async _persistVersionStamp(stamp: ArtifactVersion, artifact: ArtifactV2): Promise<void> {
    try {
      const supabase = await this._getSupabase()
      if (!supabase) return

      const { error } = await supabase.from('brandos_artifact_versions').insert({
        request_id:       stamp.requestId,
        workspace_id:     stamp.workspaceId,
        campaign_id:      null,  // provisional — linked later via linkAndFinalizeVersion()
        artifact_type:    stamp.artifactType ?? null,
        version:          stamp.version,
        score:            stamp.score,
        stamped_at:       stamp.stampedAt,
        stored_artifact:  artifact,
      })

      if (error) {
        if (this._isTableMissing(error)) { this._warnTableMissingOnce(); return }
        console.warn('[ArtifactVersioning] Supabase persist failed:', error.message)
      }
    } catch (err: any) {
      console.warn('[ArtifactVersioning] Supabase persist error:', err?.message)
    }
  }

  private async _getSupabase() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) return null
    const { createClient } = await import('@supabase/supabase-js')
    return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  }

  private _isTableMissing(error: any): boolean {
    return (
      error?.code === '42P01' ||
      error?.message?.includes('does not exist') ||
      error?.message?.includes('relation') ||
      error?.details?.includes('42P01')
    )
  }

  private _warnTableMissingOnce(): void {
    if (!ArtifactVersioningService._tableWarnedOnce) {
      ArtifactVersioningService._tableWarnedOnce = true
      console.debug(
        '[ArtifactVersioning] brandos_artifact_versions table not found. ' +
        'Apply supabase/migrations/20260621_artifact_versions.sql to enable.'
      )
    }
  }

  private static _tableWarnedOnce = false
}

export const globalArtifactVersioning = new ArtifactVersioningService()
