'use client'
/**
 * @brandos/ui-admin — hooks.ts
 *
 * React hooks for admin UI patterns.
 */

import * as React from 'react'

// ─── useAdminSave ─────────────────────────────────────────────────────────────

export interface AdminSaveResult {
  save:   (data: unknown) => Promise<void>
  saving: boolean
  saved:  boolean
  error:  string | null
}

/**
 * Fetch-based save state hook.
 *
 * Accepts saveUrl and section. POSTs { section, data } to saveUrl.
 * Provides { save, saving, saved, error } state.
 *
 * Usage:
 *   const { save, saving, saved, error } = useAdminSave('/api/admin/settings', 'aiRuntime')
 *   <SaveButton onClick={() => save(localState)} saving={saving} saved={saved} />
 *
 * @param saveUrl  The API endpoint to POST to.
 * @param section  The settings section key sent in the request body.
 */
export function useAdminSave(saveUrl: string, section: string): AdminSaveResult {
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved]   = React.useState(false)
  const [error, setError]   = React.useState<string | null>(null)

  const save = React.useCallback(async (data: unknown) => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(saveUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section, data }),
      })
      const json = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? 'Save failed')
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setSaving(false)
    }
  }, [saveUrl, section])

  return { save, saving, saved, error }
}


