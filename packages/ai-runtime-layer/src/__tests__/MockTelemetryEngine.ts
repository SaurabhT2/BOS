// packages/ai-runtime-layer/src/__tests__/mocks/MockTelemetryEngine.ts

import type { ITelemetryEngine, TelemetrySnapshot, TelemetryStats } from '@brandos/contracts'

export class MockTelemetryEngine implements ITelemetryEngine {
  public snapshots: TelemetrySnapshot[] = []

  async record(snapshot: TelemetrySnapshot): Promise<void> {
    this.snapshots.push(snapshot)
  }

  stats(): TelemetryStats {
    const total = this.snapshots.length
    const successes = this.snapshots.filter(s => s.success).length
    const totalLatency = this.snapshots.reduce((sum, s) => sum + s.latency_ms, 0)
    const fallbacks = this.snapshots.filter(s => s.fallback_count > 0).length

    return {
      total_requests: total,
      success_rate:   total > 0 ? successes / total : 0,
      avg_latency_ms: total > 0 ? totalLatency / total : 0,
      fallback_rate:  total > 0 ? fallbacks / total : 0,
      by_provider:    {},
    }
  }

  getHistory(): TelemetrySnapshot[] {
    return [...this.snapshots]
  }

  reset(): void {
    this.snapshots = []
  }
}


