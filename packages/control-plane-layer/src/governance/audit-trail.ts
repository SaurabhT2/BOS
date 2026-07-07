/**
 * @brandos/control-plane-layer — governance/audit-trail.ts
 *
 * PHASE C: Governance Audit Trail
 *
 * Persistent, queryable record of every governance decision made during
 * artifact generation. Enterprise requirement: governance actions must be
 * auditable for compliance and debugging.
 *
 * Storage: Supabase table `brandos_governance_audit` (in-memory fallback for dev).
 * Schema:
 *   CREATE TABLE brandos_governance_audit (
 *     id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *     request_id   text NOT NULL,
 *     workspace_id text NOT NULL,
 *     artifact_type text NOT NULL,
 *     score        float NOT NULL,
 *     passed       boolean NOT NULL,
 *     violations   jsonb NOT NULL DEFAULT '[]',
 *     repaired     boolean NOT NULL DEFAULT false,
 *     repair_attempts int NOT NULL DEFAULT 0,
 *     timestamp    timestamptz NOT NULL DEFAULT now(),
 *     created_at   timestamptz DEFAULT now()
 *   );
 *   CREATE INDEX ON brandos_governance_audit (workspace_id, created_at DESC);
 */

export interface GovernanceAuditEntry {
  requestId:       string
  workspaceId:     string
  artifactType:    string
  score:           number
  passed:          boolean
  violations:      string[]
  repaired:        boolean
  repairAttempts:  number
  timestamp:       string
}

export class AuditTrailService {
  /** In-memory fallback buffer — capped at 500 entries */
  private readonly buffer: GovernanceAuditEntry[] = []
  private readonly MAX_BUFFER = 500

  /**
   * Record a governance decision. Fire-and-forget pattern — never throws.
   * Writes to Supabase if available, always writes to in-memory buffer.
   */
  async record(entry: GovernanceAuditEntry): Promise<void> {
    try {
      // In-memory buffer (always — fast read path)
      this.buffer.push(entry)
      if (this.buffer.length > this.MAX_BUFFER) {
        this.buffer.shift()
      }

      // Persistent write via Supabase if env is available
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY
      if (url && key) {
        const { createClient } = await import('@supabase/supabase-js')
        const supabase = createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
        await supabase.from('brandos_governance_audit').insert({
          request_id:      entry.requestId,
          workspace_id:    entry.workspaceId,
          artifact_type:   entry.artifactType,
          score:           entry.score,
          passed:          entry.passed,
          violations:      entry.violations,
          repaired:        entry.repaired,
          repair_attempts: entry.repairAttempts,
          timestamp:       entry.timestamp,
        })
      }
    } catch (err) {
      // Never block generation on audit failures
      console.warn('[AuditTrail] record failed (non-critical):', (err as Error).message)
    }
  }

  /**
   * Query recent audit entries for a workspace.
   * Returns in-memory buffer entries filtered by workspaceId.
   * For full history, query Supabase directly.
   */
  getRecent(workspaceId: string, limit = 50): GovernanceAuditEntry[] {
    return this.buffer
      .filter(e => e.workspaceId === workspaceId)
      .slice(-limit)
      .reverse()
  }

  /**
   * GTM Critical Item 5 (2026-06-21): Query persisted audit entries from
   * Supabase, with pagination and optional filters. This is the real read
   * path for GET /api/governance/audit — getRecent() above only sees the
   * current process's in-memory buffer (capped at 500, lost on restart,
   * and not shared across server instances), which is unusable as a
   * compliance/audit surface in production.
   *
   * Falls back to the in-memory buffer (best-effort, current process only)
   * when Supabase env vars are not configured, matching record()'s existing
   * dev-mode fallback behavior — never throws.
   */
  async queryPersisted(opts: {
    workspaceId: string
    limit?: number
    offset?: number
    passed?: boolean
    artifactType?: string
  }): Promise<{ entries: GovernanceAuditEntry[]; total: number; source: 'supabase' | 'memory' }> {
    const { workspaceId, limit = 50, offset = 0, passed, artifactType } = opts
    const cappedLimit = Math.min(Math.max(limit, 1), 200)

    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY
      if (url && key) {
        const { createClient } = await import('@supabase/supabase-js')
        const supabase = createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false },
        })

        let query = supabase
          .from('brandos_governance_audit')
          .select(
            'request_id, workspace_id, artifact_type, score, passed, violations, repaired, repair_attempts, timestamp',
            { count: 'exact' }
          )
          .eq('workspace_id', workspaceId)
          .order('timestamp', { ascending: false })
          .range(offset, offset + cappedLimit - 1)

        if (typeof passed === 'boolean') query = query.eq('passed', passed)
        if (artifactType) query = query.eq('artifact_type', artifactType)

        const { data, error, count } = await query

        // PGRST116 / 42P01 = table does not exist — migration not applied yet.
        // Fall through to in-memory buffer rather than surfacing a 500.
        const isTableMissing =
          !!error &&
          (error.code === '42P01' ||
            error.message?.includes('does not exist') ||
            error.message?.includes('relation'))

        if (!error) {
          return {
            entries: (data ?? []).map((row: any) => ({
              requestId:      row.request_id,
              workspaceId:    row.workspace_id,
              artifactType:   row.artifact_type,
              score:          row.score,
              passed:         row.passed,
              violations:     row.violations ?? [],
              repaired:       row.repaired,
              repairAttempts: row.repair_attempts,
              timestamp:      row.timestamp,
            })),
            total: count ?? 0,
            source: 'supabase',
          }
        }

        if (!isTableMissing) {
          console.warn('[AuditTrail] queryPersisted Supabase error (falling back to memory):', error.message)
        }
      }
    } catch (err: any) {
      console.warn('[AuditTrail] queryPersisted error (falling back to memory):', err?.message)
    }

    // Fallback: in-memory buffer, filtered/paginated to match the Supabase contract.
    let entries = this.buffer.filter(e => e.workspaceId === workspaceId)
    if (typeof passed === 'boolean') entries = entries.filter(e => e.passed === passed)
    if (artifactType) entries = entries.filter(e => e.artifactType === artifactType)
    entries = entries.slice().reverse()

    return {
      entries: entries.slice(offset, offset + cappedLimit),
      total: entries.length,
      source: 'memory',
    }
  }

  /**
   * Get aggregate stats from in-memory buffer.
   */
  getStats(workspaceId?: string): {
    totalDecisions: number
    passRate:       number
    repairRate:     number
    avgScore:       number
  } {
    const entries = workspaceId
      ? this.buffer.filter(e => e.workspaceId === workspaceId)
      : this.buffer

    if (entries.length === 0) {
      return { totalDecisions: 0, passRate: 0, repairRate: 0, avgScore: 0 }
    }

    const passed    = entries.filter(e => e.passed).length
    const repaired  = entries.filter(e => e.repaired).length
    const avgScore  = entries.reduce((s, e) => s + e.score, 0) / entries.length

    return {
      totalDecisions: entries.length,
      passRate:       Math.round((passed  / entries.length) * 100),
      repairRate:     Math.round((repaired / entries.length) * 100),
      avgScore:       Math.round(avgScore * 10) / 10,
    }
  }
}

/** Global singleton */
export const globalAuditTrail = new AuditTrailService()


