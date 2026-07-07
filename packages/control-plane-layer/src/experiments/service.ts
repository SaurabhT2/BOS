/**
 * ExperimentService — in-memory experiment runner.
 * Persists to Supabase in a future @brandos/telemetry-store migration.
 */

import type { Experiment } from '../shared/types'

export class ExperimentService {
  private experiments = new Map<string, Experiment>()
  private stats = new Map<string, Map<string, { samples: number; score: number }>>()

  createExperiment(
    input: Omit<Experiment, 'id' | 'created_at' | 'total_samples'>
  ): Experiment {
    const id = `exp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const exp: Experiment = {
      ...input,
      id,
      created_at: new Date().toISOString(),
      total_samples: 0,
    }
    this.experiments.set(id, exp)
    return exp
  }

  getExperiment(id: string): Experiment | undefined {
    return this.experiments.get(id)
  }

  listExperiments(workspaceId?: string): Experiment[] {
    const all = [...this.experiments.values()]
    return workspaceId ? all.filter((e) => e.workspace_id === workspaceId) : all
  }

  updateExperiment(id: string, patch: Partial<Omit<Experiment, 'id'>>): Experiment | undefined {
    const exp = this.experiments.get(id)
    if (!exp) return undefined
    const updated: Experiment = { ...exp, ...patch, id }
    this.experiments.set(id, updated)
    return updated
  }

  startExperiment(id: string): Experiment | undefined {
    return this.updateExperiment(id, { status: 'running', started_at: new Date().toISOString() })
  }

  stopExperiment(id: string): Experiment | undefined {
    return this.updateExperiment(id, { status: 'paused', ended_at: new Date().toISOString() })
  }

  recordSample(experimentId: string, variantId: string, score: number): void {
    if (!this.stats.has(experimentId)) {
      this.stats.set(experimentId, new Map())
    }
    const variantStats = this.stats.get(experimentId)!
    const current = variantStats.get(variantId) ?? { samples: 0, score: 0 }
    variantStats.set(variantId, {
      samples: current.samples + 1,
      score: current.score + score,
    })
    const exp = this.experiments.get(experimentId)
    if (exp) {
      this.experiments.set(experimentId, { ...exp, total_samples: exp.total_samples + 1 })
    }
  }

  getStats(experimentId: string): Map<string, { samples: number; score: number; avgScore: number }> {
    const raw = this.stats.get(experimentId) ?? new Map<string, { samples: number; score: number }>()
    const result = new Map<string, { samples: number; score: number; avgScore: number }>()
    raw.forEach((v, k) => {
      result.set(k, { ...v, avgScore: v.samples > 0 ? v.score / v.samples : 0 })
    })
    return result
  }

  recommendWinner(experimentId: string): string | null {
    const stats = this.getStats(experimentId)
    let best: string | null = null
    let bestScore = -Infinity
    stats.forEach((v, variantId) => {
      if (v.samples >= 10 && v.avgScore > bestScore) {
        bestScore = v.avgScore
        best = variantId
      }
    })
    return best
  }
}

export const globalExperimentService = new ExperimentService()


