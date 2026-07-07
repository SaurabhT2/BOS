/**
 * /workspace/settings/providers — REDIRECTS to /workspace/settings/ai
 *
 * brandos_redesign_strategic_completion.md Polish Items: "Settings →
 * Providers already exists as its own live route today and needs to be
 * folded into the new Settings → AI rather than left as a forgotten path."
 *
 * The full BYOK key-management UI that used to live at this route (add /
 * rotate / revoke / revalidate, usage & health table) is now the
 * "Providers (BYOK)" section of /workspace/settings/ai — same components,
 * same /api/workspace/providers contract, unchanged behavior. This file
 * is kept as a server-side redirect rather than deleted outright so any
 * existing bookmarks or internal links to this path don't 404.
 *
 * (Original implementation backed up to notes/providers-page-ORIGINAL-
 * backup.tsx outside apps/web for reference during this migration.)
 */

import { redirect } from 'next/navigation'

export default function ProvidersSettingsRedirect() {
  redirect('/workspace/settings/ai')
}
