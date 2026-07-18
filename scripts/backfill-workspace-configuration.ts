/**
 * scripts/backfill-workspace-configuration.ts
 *
 * Cognitive Platform Evolution Program — Milestone 1 (Cognitive Ownership),
 * EM-1.3 (Backfill Job).
 *
 * Seeds IntelligenceOS with every existing persona's already-configured
 * brand voice, so historical configuration set before EM-1.2 shipped isn't
 * silently absent from IntelligenceOS. Idempotent — safe to re-run; only
 * personas with `synced_to_intelligence_os_at IS NULL` are touched, and a
 * later successful run of the same persona simply updates
 * `intelligence_asset_id`/timestamp again rather than creating a second
 * record (IntelligenceOS's `ingestWorkspaceConfiguration` supersedes by
 * workspaceId, per ADR-003 §2.4 — it does not append).
 *
 * Usage:
 *   pnpm backfill:workspace-configuration --dry-run   # report only, no writes
 *   pnpm backfill:workspace-configuration              # execute
 *
 * Requires INTELLIGENCE_OS_API_URL / INTELLIGENCE_OS_API_KEY (same as the
 * running server) and Supabase admin credentials (SUPABASE_SERVICE_ROLE_KEY
 * via getSupabaseAdmin()) to be set in the environment this script runs in.
 *
 * NOT YET RUN against production or any live BrandOS/IntelligenceOS
 * deployment — this sandbox has neither. Dry-run this against a staging
 * copy of the database first, per the Cognitive Platform Evolution
 * Program's Milestone 1 risk assessment (item 1: precedence conflicts
 * between explicit historical configuration and any voice IntelligenceOS
 * may have already synthesized independently).
 */

import { getSupabaseAdmin } from '@brandos/auth'
import {
  initWorkspaceConfigurationClient,
  getGlobalWorkspaceConfigurationClient,
} from '@brandos/cognition-client'

interface PersonaBackfillRow {
  id: string
  workspace_id: string
  name: string
  tone: string
  domain: string | null
  audience: string | null
  key_themes: string[]
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')

  const apiUrl = process.env.INTELLIGENCE_OS_API_URL
  const apiKey = process.env.INTELLIGENCE_OS_API_KEY
  if (!apiUrl || !apiKey) {
    console.error(
      'INTELLIGENCE_OS_API_URL / INTELLIGENCE_OS_API_KEY are required — refusing to run.',
    )
    process.exitCode = 1
    return
  }
  initWorkspaceConfigurationClient({ baseUrl: apiUrl, apiKey })
  const client = getGlobalWorkspaceConfigurationClient()
  if (!client) {
    console.error('Failed to initialize WorkspaceConfigurationClient.')
    process.exitCode = 1
    return
  }

  const admin = getSupabaseAdmin()
  const { data: rows, error } = await admin
    .from('personas')
    .select('id, workspace_id, name, tone, domain, audience, key_themes')
    .is('synced_to_intelligence_os_at', null)
    .returns<PersonaBackfillRow[]>()

  if (error) {
    console.error('Failed to load unsynced personas:', error.message)
    process.exitCode = 1
    return
  }

  console.info(
    `[backfill] ${rows?.length ?? 0} persona(s) not yet synced to IntelligenceOS.${
      dryRun ? ' (dry run — no writes will be made)' : ''
    }`,
  )

  let succeeded = 0
  let failed = 0

  for (const persona of rows ?? []) {
    if (dryRun) {
      console.info(
        `[backfill] would sync persona ${persona.id} (workspace ${persona.workspace_id}, name="${persona.name}")`,
      )
      continue
    }

    try {
      const result = await client.sync({
        workspaceId: persona.workspace_id,
        label: persona.name,
        voiceConfiguration: {
          tone: persona.tone,
          domain: persona.domain ?? undefined,
          audienceType: persona.audience ?? undefined,
          brandName: persona.name,
        },
        identityConfiguration: persona.key_themes?.length
          ? { brandName: persona.name, namedFrameworks: persona.key_themes }
          : null,
      })

      const { error: updateError } = await admin
        .from('personas')
        .update({
          intelligence_asset_id: result.assetId,
          synced_to_intelligence_os_at: new Date().toISOString(),
        })
        .eq('id', persona.id)

      if (updateError) {
        console.error(
          `[backfill] synced persona ${persona.id} but failed to record correlation:`,
          updateError.message,
        )
        failed++
        continue
      }

      succeeded++
      console.info(`[backfill] synced persona ${persona.id} -> assetId ${result.assetId}`)
    } catch (err) {
      failed++
      console.error(`[backfill] failed to sync persona ${persona.id}:`, err)
    }
  }

  if (!dryRun) {
    console.info(`[backfill] done. succeeded=${succeeded} failed=${failed}`)
    if (failed > 0) process.exitCode = 1
  }
}

main().catch((err) => {
  console.error('[backfill] unhandled error:', err)
  process.exitCode = 1
})
