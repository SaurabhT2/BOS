/**
 * @brandos/control-plane-layer — telemetry/persistent-telemetry.ts
 *
 * PHASE C: Persistent Telemetry
 *
 * The existing TelemetryEngine in @brandos/ai-runtime-layer stores snapshots
 * in an in-memory circular buffer. Process restarts wipe all history.
 *
 * This service wraps the runtime telemetry and persists snapshots to Supabase
 * so that /api/v2/telemetry/stats returns durable data across deployments.
 *
 * Schema:
 *   CREATE TABLE brandos_telemetry_snapshots (
 *     id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *     request_id    text,
 *     workspace_id  text,
 *     provider      text NOT NULL,
 *     model_id      text,
 *     latency_ms    int NOT NULL,
 *     tokens_used   int,
 *     cost_usd      float,
 *     success       boolean NOT NULL,
 *     task_type     text,
 *     runtime_mode  text,
 *     created_at    timestamptz DEFAULT now()
 *   );
 *   CREATE INDEX ON brandos_telemetry_snapshots (workspace_id, created_at DESC);
 *   CREATE INDEX ON brandos_telemetry_snapshots (created_at DESC);
 *
 * PATTERN:
 *   - Writes are fire-and-forget (never block generation)
 *   - Reads query Supabase for persistent history
 *   - In-memory buffer provides sub-ms reads for the live stats dashboard
 */

export interface TelemetrySnapshot {
  requestId?:   string
  workspaceId?: string
  provider:     string
  modelId?:     string
  latencyMs:    number
  tokensUsed?:  number
  costUsd?:     number
  success:      boolean
  taskType?:    string
  runtimeMode?: string
  timestamp:    string
}

export interface TelemetryStats {
  totalRequests:    number
  successRate:      number
  avgLatencyMs:     number
  p95LatencyMs:     number
  totalTokens:      number
  totalCostUsd:     number
  byProvider:       Record<string, { requests: number; avgLatency: number; successRate: number }>
  windowHours:      number
}

export class PersistentTelemetryService {
  private readonly buffer: TelemetrySnapshot[] = []
  private readonly MAX_BUFFER = 1000

  /**
   * Record a telemetry snapshot. Fire-and-forget — never throws.
   */
  async record(snapshot: TelemetrySnapshot): Promise<void> {
    try {
      // In-memory buffer
      this.buffer.push(snapshot)
      if (this.buffer.length > this.MAX_BUFFER) this.buffer.shift()

      // Persist to Supabase
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY
      if (url && key) {
        const { createClient } = await import('@supabase/supabase-js')
        const supabase = createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
        await supabase.from('brandos_telemetry_snapshots').insert({
          request_id:   snapshot.requestId ?? null,
          workspace_id: snapshot.workspaceId ?? null,
          provider:     snapshot.provider,
          model_id:     snapshot.modelId ?? null,
          latency_ms:   snapshot.latencyMs,
          tokens_used:  snapshot.tokensUsed ?? null,
          cost_usd:     snapshot.costUsd ?? null,
          success:      snapshot.success,
          task_type:    snapshot.taskType ?? null,
          runtime_mode: snapshot.runtimeMode ?? null,
        })
      }
    } catch (err) {
      console.warn('[PersistentTelemetry] record failed (non-critical):', (err as Error).message)
    }
  }

  /**
   * Get stats from in-memory buffer. Fast — no DB round-trip.
   * For full historical stats, use queryPersistent().
   */
  getStats(windowHours = 1): TelemetryStats {
    const cutoff = Date.now() - windowHours * 60 * 60 * 1000
    const entries = this.buffer.filter(
      e => new Date(e.timestamp).getTime() >= cutoff
    )

    if (entries.length === 0) {
      return {
        totalRequests: 0, successRate: 0, avgLatencyMs: 0,
        p95LatencyMs: 0, totalTokens: 0, totalCostUsd: 0,
        byProvider: {}, windowHours,
      }
    }

    const successes    = entries.filter(e => e.success).length
    const latencies    = entries.map(e => e.latencyMs).sort((a, b) => a - b)
    const totalTokens  = entries.reduce((s, e) => s + (e.tokensUsed ?? 0), 0)
    const totalCost    = entries.reduce((s, e) => s + (e.costUsd ?? 0), 0)
    const avgLatency   = latencies.reduce((s, v) => s + v, 0) / latencies.length
    const p95Idx       = Math.floor(latencies.length * 0.95)
    const p95Latency   = latencies[p95Idx] ?? latencies[latencies.length - 1] ?? 0

    // By-provider breakdown
    const byProvider: TelemetryStats['byProvider'] = {}
    for (const e of entries) {
      if (!byProvider[e.provider]) {
        byProvider[e.provider] = { requests: 0, avgLatency: 0, successRate: 0 }
      }
      byProvider[e.provider].requests++
    }
    for (const [provider, stats] of Object.entries(byProvider)) {
      const provEntries = entries.filter(e => e.provider === provider)
      stats.avgLatency   = provEntries.reduce((s, e) => s + e.latencyMs, 0) / provEntries.length
      stats.successRate  = Math.round(
        (provEntries.filter(e => e.success).length / provEntries.length) * 100
      )
    }

    return {
      totalRequests: entries.length,
      successRate:   Math.round((successes / entries.length) * 100),
      avgLatencyMs:  Math.round(avgLatency),
      p95LatencyMs:  Math.round(p95Latency),
      totalTokens,
      totalCostUsd:  Math.round(totalCost * 10000) / 10000,
      byProvider,
      windowHours,
    }
  }

  /**
   * Query persistent telemetry from Supabase for a workspace.
   * Returns most recent N snapshots.
   */
  async queryPersistent(workspaceId: string, limit = 100): Promise<TelemetrySnapshot[]> {
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY
      if (!url || !key) return this.buffer.filter(e => e.workspaceId === workspaceId).slice(-limit)

      const { createClient } = await import('@supabase/supabase-js')
      const supabase = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      const { data } = await supabase
        .from('brandos_telemetry_snapshots')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(limit)

      if (!data) return []
      return data.map((row: any): TelemetrySnapshot => ({
        requestId:   row.request_id,
        workspaceId: row.workspace_id,
        provider:    row.provider,
        modelId:     row.model_id,
        latencyMs:   row.latency_ms,
        tokensUsed:  row.tokens_used,
        costUsd:     row.cost_usd,
        success:     row.success,
        taskType:    row.task_type,
        runtimeMode: row.runtime_mode,
        timestamp:   row.created_at,
      }))
    } catch (err) {
      console.warn('[PersistentTelemetry] query failed:', (err as Error).message)
      return []
    }
  }
}

/** Global singleton */
export const globalPersistentTelemetry = new PersistentTelemetryService()


