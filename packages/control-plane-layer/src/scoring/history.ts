/**
 * @brandos/control-plane-layer — scoring/history.ts
 *
 * SCORE HISTORY SERVICE — persistent quality score tracking
 *
 * PRIOR STATE: in-memory ring buffer only. Scores reset on every deploy.
 * Home pulse trend ("Consistency 61% ↑12% this month") was ephemeral.
 *
 * NOW: Supabase-backed with in-memory buffer as hot-path cache and fallback.
 *
 * WRITE PATH:
 *   record() → in-memory buffer (immediate, synchronous, for read-through cache)
 *            + Supabase insert (async, fire-and-forget, never blocks response)
 *
 * READ PATH:
 *   query() → Supabase (persistent, workspace-scoped)
 *            → falls back to in-memory buffer if Supabase unavailable
 *
 * SCORE ASSOCIATIONS (P1 linkage):
 *   Each entry can carry campaign_id + version so score history can be
 *   correlated with the specific version of the content that produced it.
 *   Populated by the generate route via the scoreCampaignContext option.
 *
 * PERSISTENCE: brandos_score_history (migration: supabase/migrations/20260622_score_history.sql)
 */

import type { ScoreHistoryEntry, ScoreAggregation } from '../shared/types'

// ─── In-memory ring buffer (hot-path cache + offline fallback) ────────────────
const MAX_ENTRIES = 5_000
const _memoryBuffer: ScoreHistoryEntry[] = []

// ─── Supabase client factory ──────────────────────────────────────────────────
async function _getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  const { createClient } = await import('@supabase/supabase-js')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

// ─── Table existence guard ────────────────────────────────────────────────────
let _tableWarnedOnce = false
function _isTableMissing(error: any): boolean {
  return (
    error?.code === '42P01' ||
    error?.message?.includes('does not exist') ||
    error?.message?.includes('relation') ||
    error?.details?.includes('42P01')
  )
}
function _warnTableMissingOnce(): void {
  if (!_tableWarnedOnce) {
    _tableWarnedOnce = true
    console.debug(
      '[ScoreHistory] brandos_score_history table not found. ' +
      'Apply supabase/migrations/20260622_score_history.sql to enable persistence. ' +
      'Falling back to in-memory buffer.'
    )
  }
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class ScoreHistoryService {
  /**
   * Record a quality score snapshot.
   *
   * @param entry     - Score data (id will be auto-generated if not provided)
   * @param context   - Optional campaign/version linkage for P1 correlation
   */
  record(
    entry: Omit<ScoreHistoryEntry, 'id'>,
    context?: { campaignId?: string; artifactType?: string; version?: number }
  ): ScoreHistoryEntry {
    const record: ScoreHistoryEntry = {
      ...entry,
      id: `sh_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    }

    // Write to in-memory buffer immediately (synchronous — never blocks)
    _memoryBuffer.push(record)
    if (_memoryBuffer.length > MAX_ENTRIES) {
      _memoryBuffer.splice(0, _memoryBuffer.length - MAX_ENTRIES)
    }

    // Persist to Supabase (async, fire-and-forget)
    void this._persistToSupabase(record, context)

    return record
  }

  /**
   * Query score history for a workspace.
   * Reads from Supabase first; falls back to in-memory buffer.
   */
  async queryAsync(filters: {
    user_id?:     string
    workspace_id?: string
    task_type?:   string
    model_id?:    string
    from?:        string
    to?:          string
    limit?:       number
  }): Promise<{ entries: ScoreHistoryEntry[]; source: 'supabase' | 'memory' }> {
    try {
      const supabase = await _getSupabase()
      if (!supabase) {
        return { entries: this._queryMemory(filters), source: 'memory' }
      }

      let q = supabase
        .from('brandos_score_history')
        .select('id, workspace_id, user_id, task_type, model_id, score, retries, latency_ms, approved, timestamp, campaign_id, artifact_type, version')
        .order('timestamp', { ascending: false })

      if (filters.workspace_id) q = q.eq('workspace_id', filters.workspace_id)
      if (filters.user_id)      q = q.eq('user_id', filters.user_id)
      if (filters.task_type)    q = q.eq('task_type', filters.task_type)
      if (filters.model_id)     q = q.eq('model_id', filters.model_id)
      if (filters.from)         q = q.gte('timestamp', filters.from)
      if (filters.to)           q = q.lte('timestamp', filters.to)
      q = q.limit(filters.limit ?? 500)

      const { data, error } = await q

      if (error) {
        if (_isTableMissing(error)) {
          _warnTableMissingOnce()
          return { entries: this._queryMemory(filters), source: 'memory' }
        }
        console.warn('[ScoreHistory] Supabase query failed, falling back to memory:', error.message)
        return { entries: this._queryMemory(filters), source: 'memory' }
      }

      // Map DB columns to ScoreHistoryEntry shape
      const entries: ScoreHistoryEntry[] = (data ?? []).map((row: any) => ({
        id:           row.id,
        request_id:   row.request_id ?? '',
        user_id:      row.user_id ?? '',
        workspace_id: row.workspace_id,
        task_type:    row.task_type,
        model_id:     row.model_id,
        provider:     row.provider ?? '',
        score:        Number(row.score),
        retries:      row.retries,
        latency_ms:   row.latency_ms,
        approved:     row.approved,
        timestamp:    typeof row.timestamp === 'string'
                        ? row.timestamp
                        : new Date(row.timestamp).toISOString(),
      }))

      return { entries, source: 'supabase' }
    } catch (err: any) {
      console.warn('[ScoreHistory] queryAsync error, falling back to memory:', err?.message)
      return { entries: this._queryMemory(filters), source: 'memory' }
    }
  }

  /**
   * Synchronous query (in-memory only).
   * Used by existing synchronous callers that haven't been updated to async yet.
   */
  query(filters: {
    user_id?:     string
    workspace_id?: string
    task_type?:   string
    model_id?:    string
    from?:        string
    to?:          string
    limit?:       number
  }): ScoreHistoryEntry[] {
    return this._queryMemory(filters)
  }

  aggregate(entries: ScoreHistoryEntry[], granularity: 'day' | 'week' | 'month' = 'day'): ScoreAggregation[] {
    const buckets = new Map<string, ScoreHistoryEntry[]>()

    for (const entry of entries) {
      const key = this._bucketKey(entry.timestamp, granularity)
      if (!buckets.has(key)) buckets.set(key, [])
      buckets.get(key)!.push(entry)
    }

    return Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, rows]) => {
        const scores  = rows.map(r => r.score)
        const approved = rows.filter(r => r.approved === true).length

        const byTask:  Record<string, { avg: number; count: number }> = {}
        const byModel: Record<string, { avg: number; count: number }> = {}

        for (const row of rows) {
          if (!byTask[row.task_type])  byTask[row.task_type]  = { avg: 0, count: 0 }
          if (!byModel[row.model_id]) byModel[row.model_id] = { avg: 0, count: 0 }
          byTask[row.task_type]!.count++
          byTask[row.task_type]!.avg += row.score
          byModel[row.model_id]!.count++
          byModel[row.model_id]!.avg += row.score
        }

        for (const k of Object.keys(byTask))  byTask[k]!.avg  /= byTask[k]!.count
        for (const k of Object.keys(byModel)) byModel[k]!.avg /= byModel[k]!.count

        return {
          period,
          avg_score:             scores.reduce((a, b) => a + b, 0) / scores.length,
          min_score:             Math.min(...scores),
          max_score:             Math.max(...scores),
          total_requests:        rows.length,
          avg_retries:           rows.reduce((s, r) => s + r.retries, 0) / rows.length,
          avg_latency_ms:        rows.reduce((s, r) => s + r.latency_ms, 0) / rows.length,
          approval_rate:         rows.length > 0 ? approved / rows.length : 0,
          by_task:               byTask,
          by_model:              byModel,
        }
      })
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private _queryMemory(filters: {
    user_id?:     string
    workspace_id?: string
    task_type?:   string
    model_id?:    string
    from?:        string
    to?:          string
    limit?:       number
  }): ScoreHistoryEntry[] {
    let results = [..._memoryBuffer]
    if (filters.user_id)      results = results.filter(r => r.user_id === filters.user_id)
    if (filters.workspace_id) results = results.filter(r => r.workspace_id === filters.workspace_id)
    if (filters.task_type)    results = results.filter(r => r.task_type === filters.task_type)
    if (filters.model_id)     results = results.filter(r => r.model_id === filters.model_id)
    if (filters.from)         results = results.filter(r => r.timestamp >= filters.from!)
    if (filters.to)           results = results.filter(r => r.timestamp <= filters.to!)
    results.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    return results.slice(0, filters.limit ?? 500)
  }

  private async _persistToSupabase(
    entry: ScoreHistoryEntry,
    context?: { campaignId?: string; artifactType?: string; version?: number }
  ): Promise<void> {
    try {
      const supabase = await _getSupabase()
      if (!supabase) return

      const { error } = await supabase.from('brandos_score_history').insert({
        id:            entry.id,
        workspace_id:  entry.workspace_id,
        user_id:       entry.user_id,
        task_type:     entry.task_type,
        model_id:      entry.model_id,
        score:         entry.score,
        retries:       entry.retries,
        latency_ms:    entry.latency_ms,
        approved:      entry.approved,
        timestamp:     entry.timestamp,
        campaign_id:   context?.campaignId ?? null,
        artifact_type: context?.artifactType ?? null,
        version:       context?.version ?? null,
      })

      if (error) {
        if (_isTableMissing(error)) { _warnTableMissingOnce(); return }
        console.warn('[ScoreHistory] Supabase insert failed (non-critical):', error.message)
      }
    } catch (err: any) {
      console.warn('[ScoreHistory] _persistToSupabase error (non-critical):', err?.message)
    }
  }

  private _bucketKey(isoTimestamp: string, granularity: 'day' | 'week' | 'month'): string {
    const d = new Date(isoTimestamp)
    if (granularity === 'month') {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    }
    if (granularity === 'week') {
      const day = d.getDay()
      const diff = d.getDate() - day + (day === 0 ? -6 : 1)
      const mon = new Date(new Date(isoTimestamp).setDate(diff))
      return mon.toISOString().slice(0, 10)
    }
    return isoTimestamp.slice(0, 10)
  }
}

export const globalScoreHistory = new ScoreHistoryService()
