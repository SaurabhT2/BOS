// ============================================================
// packages/ai-runtime-layer/src/telemetry-engine/index.ts
//
// TELEMETRY ENGINE — Snapshot Recording + Stats Aggregation
//
// Multi-sink fan-out architecture. Failures in one sink never
// affect other sinks or the runtime execution path.
//
// DESIGN:
//   - TelemetryEngine holds an in-memory history of TelemetrySnapshots.
//   - Each snapshot corresponds to one provider invocation attempt.
//   - stats() computes aggregate metrics from the in-memory history.
//   - Sinks receive snapshots asynchronously via Promise.allSettled.
//   - Sink errors are logged at warn level and swallowed — non-blocking.
//
// BUILT-IN SINKS:
//   ConsoleTelemetrySink  — JSON logs to console. Use in development.
//   NoopTelemetrySink     — Captures in memory. Use in tests to inspect snapshots.
//   HttpTelemetrySink     — POSTs JSON to an HTTP endpoint. Use in production.
//
// CUSTOM SINKS:
//   Implement TelemetrySink from @brandos/contracts and inject via:
//     new TelemetryEngine([customSink], logger)
//     or dynamically: engine.addSink(customSink)
//
// HISTORY BOUNDS:
//   History is unbounded (grows with every request). In long-running
//   processes, consider a bounded buffer or periodic flush.
//   History is cleared when the runtime is rebuilt (AIRuntimeAdapter.invalidate()).
// ============================================================

import {
  ITelemetryEngine,
  TelemetrySink,
  TelemetrySnapshot,
  TelemetryStats,
} from '@brandos/contracts'
import { Logger } from '../runtime-engine/logger'

export class TelemetryEngine implements ITelemetryEngine {
  private readonly history: TelemetrySnapshot[] = []
  private readonly sinks:   TelemetrySink[]
  private readonly logger:  Logger

  constructor(sinks: TelemetrySink[] = [], logger?: Logger) {
    this.sinks  = sinks
    this.logger = (logger ?? new Logger('info')).child('TelemetryEngine')
  }

  /**
   * Record a telemetry snapshot and fan out to all registered sinks.
   *
   * - Appends the snapshot to the in-memory history.
   * - Fans out to all sinks via Promise.allSettled (non-blocking, non-throwing).
   * - Sink failures are logged at warn level and do not affect the runtime.
   *
   * @param snapshot - The telemetry snapshot from ExecutionEngine.
   */
  async record(snapshot: TelemetrySnapshot): Promise<void> {
    this.history.push(snapshot)
    this.logger.debug('Snapshot', snapshot)

    // Fan out to all sinks. Use allSettled so one sink failure doesn't block others.
    await Promise.allSettled(
      this.sinks.map((sink) =>
        Promise.resolve(sink.emit(snapshot)).catch((err) => {
          this.logger.warn('Sink failed', { err: (err as Error).message })
        })
      )
    )
  }

  /**
   * Return a copy of the in-memory snapshot history.
   * Ordered by insertion order (effectively by timestamp ascending).
   */
  getHistory(): TelemetrySnapshot[] {
    return [...this.history]
  }

  /**
   * Compute aggregate statistics from the in-memory history.
   *
   * METRICS:
   *   total_requests  — total number of recorded snapshots
   *   success_rate    — fraction of snapshots with success: true
   *   avg_latency_ms  — mean latency across all snapshots (rounded)
   *   fallback_rate   — fraction of snapshots with fallback_count > 0
   *   by_provider     — per-provider count and mean latency
   *
   * Returns zeroed stats when history is empty.
   */
  stats(): TelemetryStats {
    const total = this.history.length

    if (total === 0) {
      return {
        total_requests: 0,
        success_rate:   0,
        avg_latency_ms: 0,
        fallback_rate:  0,
        by_provider:    {},
      }
    }

    const successes = this.history.filter(s => s.success).length
    const fallbacks = this.history.filter(s => s.fallback_count > 0).length
    const avgLatency = this.history.reduce((sum, s) => sum + s.latency_ms, 0) / total

    // Compute per-provider stats using an incremental mean to avoid
    // accumulating all values then dividing (avoids large intermediate arrays).
    const byProvider: TelemetryStats['by_provider'] = {}
    for (const s of this.history) {
      const current   = byProvider[s.provider_used] ?? { count: 0, avg_latency_ms: 0 }
      const newCount  = current.count + 1
      byProvider[s.provider_used] = {
        count:          newCount,
        avg_latency_ms: Math.round(
          (current.avg_latency_ms * current.count + s.latency_ms) / newCount
        ),
      }
    }

    return {
      total_requests: total,
      success_rate:   successes / total,
      avg_latency_ms: Math.round(avgLatency),
      fallback_rate:  fallbacks / total,
      by_provider:    byProvider,
    }
  }

  /**
   * Add a sink at runtime (e.g. from a plugin or admin configuration change).
   * The sink will receive all future snapshots.
   *
   * @param sink - Any object implementing TelemetrySink.emit().
   */
  addSink(sink: TelemetrySink): void {
    this.sinks.push(sink)
  }
}

// ─────────────────────────────────────────────────────────────
// Built-in Telemetry Sinks
// ─────────────────────────────────────────────────────────────

/**
 * ConsoleTelemetrySink — logs each snapshot as a JSON line to console.
 * Use in development and staging environments.
 * NOT recommended for production (high log volume).
 */
export class ConsoleTelemetrySink implements TelemetrySink {
  async emit(snapshot: TelemetrySnapshot): Promise<void> {
    console.log('[Telemetry]', JSON.stringify(snapshot))
  }
}

/**
 * NoopTelemetrySink — captures snapshots in memory without side effects.
 *
 * Use in tests to:
 *   - Verify that snapshots are recorded after each invocation.
 *   - Inspect provider, latency, and quality_flags for correctness.
 *   - Count retry and fallback occurrences.
 *
 * Example:
 *   const sink = new NoopTelemetrySink()
 *   const engine = new TelemetryEngine([sink], logger)
 *   await runtime.run(request)
 *   expect(sink.snapshots[0].success).toBe(true)
 */
export class NoopTelemetrySink implements TelemetrySink {
  private readonly captured: TelemetrySnapshot[] = []

  async emit(snapshot: TelemetrySnapshot): Promise<void> {
    this.captured.push(snapshot)
  }

  /** All captured snapshots in insertion order. */
  get snapshots(): TelemetrySnapshot[] {
    return [...this.captured]
  }
}

/**
 * HttpTelemetrySink — POSTs each snapshot as JSON to an HTTP endpoint.
 *
 * Use in production to forward telemetry to:
 *   - A time-series database (e.g. InfluxDB, Prometheus remote write)
 *   - An analytics platform (e.g. PostHog, Mixpanel event ingestion)
 *   - A logging aggregator (e.g. Datadog, Splunk HEC)
 *
 * Failures (network errors, non-2xx responses) are caught by the
 * TelemetryEngine's allSettled wrapper and logged at warn level.
 * They do not affect runtime operation.
 *
 * @param endpoint - Full URL for the HTTP POST.
 * @param headers  - Optional extra headers (e.g. Authorization, X-API-Key).
 */
export class HttpTelemetrySink implements TelemetrySink {
  constructor(
    private readonly endpoint: string,
    private readonly headers:  Record<string, string> = {},
  ) {}

  async emit(snapshot: TelemetrySnapshot): Promise<void> {
    await fetch(this.endpoint, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.headers,
      },
      body: JSON.stringify(snapshot),
    })
  }
}


