/**
 * BrandOS — Prompt Library Service
 *
 * GOVERNANCE MIGRATION:
 *   RECOMMENDED_SCORE threshold (previously hardcoded 90) is now sourced from
 *   @brandos/governance-config.PROMPT_LIBRARY_RECOMMENDED_SCORE so it is
 *   auditable and co-located with all other quality policy constants.
 */

import type { PromptLibraryEntry } from '../shared/types'
import { PROMPT_LIBRARY_RECOMMENDED_SCORE } from '@brandos/governance-config'

// ─── In-memory store ──────────────────────────────────────────────────────────

const promptStore = new Map<string, PromptLibraryEntry>()

// ─── Service ──────────────────────────────────────────────────────────────────

export class PromptLibraryService {
  save(entry: Omit<PromptLibraryEntry, 'id' | 'usage_count' | 'success_rate' | 'updated_at' | 'version'>): PromptLibraryEntry {
    const prompt: PromptLibraryEntry = {
      ...entry,
      id:            `pl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      usage_count:   0,
      success_rate:  0,
      version:       1,
      updated_at:    entry.created_at,
      // Threshold sourced from governance-config
      is_recommended: entry.score_achieved >= PROMPT_LIBRARY_RECOMMENDED_SCORE,
    }
    promptStore.set(prompt.id, prompt)
    return prompt
  }

  get(id: string): PromptLibraryEntry | null {
    return promptStore.get(id) ?? null
  }

  list(filters: {
    workspace_id?: string
    task_type?: string
    tags?: string[]
    search?: string
    recommended_only?: boolean
    min_score?: number
  }): PromptLibraryEntry[] {
    let results = Array.from(promptStore.values())

    if (filters.workspace_id)   results = results.filter(p => p.workspace_id === filters.workspace_id)
    if (filters.task_type)      results = results.filter(p => p.task_type === filters.task_type)
    if (filters.tags?.length)   results = results.filter(p => filters.tags!.some(t => p.tags.includes(t)))
    if (filters.search) {
      const q = filters.search.toLowerCase()
      results = results.filter(p =>
        p.title.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.prompt_text.toLowerCase().includes(q) ||
        p.tags.some(t => t.toLowerCase().includes(q))
      )
    }
    if (filters.recommended_only) results = results.filter(p => p.is_recommended)
    if (filters.min_score !== undefined) results = results.filter(p => p.score_achieved >= filters.min_score!)

    return results.sort((a, b) => b.score_achieved - a.score_achieved)
  }

  update(id: string, patch: Partial<Pick<PromptLibraryEntry, 'title' | 'description' | 'tags' | 'system_context'>>): PromptLibraryEntry | null {
    const existing = promptStore.get(id)
    if (!existing) return null
    const updated = { ...existing, ...patch, updated_at: new Date().toISOString(), version: existing.version + 1 }
    promptStore.set(id, updated)
    return updated
  }

  recordUsage(id: string, score: number, thresholdForSuccess: number): void {
    const entry = promptStore.get(id)
    if (!entry) return
    const newCount   = entry.usage_count + 1
    const successes  = Math.round(entry.success_rate * entry.usage_count) + (score >= thresholdForSuccess ? 1 : 0)
    const updated: PromptLibraryEntry = {
      ...entry,
      usage_count:  newCount,
      success_rate: newCount > 0 ? successes / newCount : 0,
      updated_at:   new Date().toISOString(),
    }
    promptStore.set(id, updated)
  }

  clone(id: string, createdBy: string): PromptLibraryEntry | null {
    const original = promptStore.get(id)
    if (!original) return null
    return this.save({
      ...original,
      title:      `${original.title} (copy)`,
      created_by: createdBy,
      created_at: new Date().toISOString(),
      parent_id:  original.id,
    })
  }

  delete(id: string): boolean {
    return promptStore.delete(id)
  }
}

export const globalPromptLibrary = new PromptLibraryService()


