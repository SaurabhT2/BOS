/**
 * apps/web — /api/assets/[id]/analyze
 *
 * P1 — Asset Vault Evolution.
 *
 * POST — Trigger VLM analysis for an image asset, or text extraction for
 *        document assets (PDF, DOCX, PPTX, TXT, MD).
 *
 * IMAGE WORKFLOW:
 *   1. Verify asset ownership (workspaceId from session)
 *   2. Download the asset from storage (admin client — bypasses storage RLS)
 *   3. Call Anthropic API directly with multimodal content (image + prompt)
 *      NOTE: CPL orchestrator is NOT used here because it does not forward
 *      imageBase64 to callWithMode, and the runtime engine drops attachments
 *      before building ProviderInvokeRequest. Direct API call is the only
 *      reliable path to actual VLM analysis.
 *   4. On success: updateAssetVlmResult() → status='indexed'
 *   5. On failure: updateAssetStatus() → status='failed'
 *
 * DOCUMENT WORKFLOW:
 *   1. Verify asset ownership
 *   2. Download asset from storage
 *   3. Extract text content (plain text/markdown read directly; others summarised)
 *   4. Call Anthropic API to summarise and extract metadata
 *   5. Persist result → status='indexed'
 *
 * AUTHENTICATION: requireUser() — workspaceId always from session.
 * STORAGE: Admin client used for download to avoid anon RLS restrictions.
 */

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/supabase-server'
import { getAsset, updateAssetVlmResult, updateAssetStatus, getDefaultPersona, updatePersona } from '@brandos/auth'
import { getSupabaseAdmin } from '@brandos/auth'
import { getProviderKey } from '@brandos/runtime-config'
import { recordBrandMemoryObservation } from '@brandos/control-plane-layer'

type Params = { params: Promise<{ id: string }> }

// ─── Anthropic direct call helper ──────────────────────────────────────────────
// The CPL orchestrator path drops image attachments before reaching the provider
// adapter. We call Anthropic directly with the multimodal messages array.

async function callAnthropicVLM(
  imageBase64: string,
  mimeType: string,
  prompt: string,
  apiKeyOverride?: string
): Promise<string> {
  // P3 — W6: prefer workspace BYOK key; fall back to platform env key
  const apiKey = apiKeyOverride ?? process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured')

  // Normalise MIME to what Anthropic accepts
  const acceptedMime = (
    ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mimeType)
      ? mimeType
      : 'image/png'
  ) as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: acceptedMime,
                data: imageBase64,
              },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Anthropic API ${res.status}: ${body}`)
  }

  const data = (await res.json()) as { content: Array<{ type: string; text: string }> }
  return data.content.filter((c) => c.type === 'text').map((c) => c.text).join('')
}

async function callAnthropicText(
  prompt: string,
  systemPrompt?: string,
  apiKeyOverride?: string
): Promise<string> {
  // P3 — W6: prefer workspace BYOK key; fall back to platform env key
  const apiKey = apiKeyOverride ?? process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Anthropic API ${res.status}: ${body}`)
  }

  const data = (await res.json()) as { content: Array<{ type: string; text: string }> }
  return data.content.filter((c) => c.type === 'text').map((c) => c.text).join('')
}

// ─── Image analysis ───────────────────────────────────────────────────────────

const IMAGE_ANALYSIS_PROMPT = `Analyze this brand asset image and return ONLY a JSON object with these exact fields:
{
  "description": "brief visual description",
  "colors": { "primary": ["#hex1", "#hex2"], "accent": ["#hex3"] },
  "typography": { "personality": "Modern/Classic/Bold/Minimal etc", "weight": "light/regular/bold" },
  "mood": "professional/playful/authoritative/innovative",
  "confidence": 80,
  "recommendations": ["rec1", "rec2"]
}
Return ONLY valid JSON, no markdown, no commentary.`

async function analyzeImage(
  imageBase64: string,
  mimeType: string,
  apiKeyOverride?: string
): Promise<Record<string, unknown>> {
  try {
    const raw = await callAnthropicVLM(imageBase64, mimeType, IMAGE_ANALYSIS_PROMPT, apiKeyOverride)
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    return JSON.parse(cleaned)
  } catch (parseErr) {
    // If we got a response but can't parse JSON, return a structured fallback
    // that at least records that analysis ran
    return {
      description: 'Image analysis completed',
      colors: { primary: [], accent: [] },
      typography: { personality: 'Unknown', weight: 'regular' },
      mood: 'professional',
      confidence: 30,
      recommendations: [],
      parse_error: true,
    }
  }
}

// ─── Document analysis ────────────────────────────────────────────────────────

async function analyzeDocument(
  fileBytes: Buffer,
  mimeType: string,
  filename: string,
  apiKeyOverride?: string
): Promise<Record<string, unknown>> {
  let textContent = ''
  const isTextType = mimeType === 'text/plain' || mimeType === 'text/markdown'
  const isPdf  = mimeType === 'application/pdf'
  const isDocx = mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
              || mimeType === 'application/msword'
  const isPptx = mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
              || mimeType === 'application/vnd.ms-powerpoint'
  const isSvg  = mimeType === 'image/svg+xml'

  if (isTextType || isSvg) {
    // SVG is XML text — read directly; it won't give a full text description
    // but the filename + XML structure is more useful than a binary placeholder.
    textContent = fileBytes.toString('utf-8').slice(0, 8000)
  } else if (isPdf) {
    try {
      // pdf-parse v2.x: pass the buffer as `data` in LoadParameters, then call
      // getText() — there is no parse() method. The constructor requires a
      // LoadParameters argument (all fields optional, but the param itself is not).
      const { PDFParse } = await import('pdf-parse')
      const parser = new PDFParse({ data: fileBytes })
      const result = await parser.getText()
      textContent = (result.text ?? '').slice(0, 8000)
      if (!textContent.trim()) {
        // Scanned PDF — no text layer; fall back to placeholder (OCR out of scope).
        textContent = `[Scanned PDF: ${filename}, ${fileBytes.length} bytes — OCR not implemented]`
      }
    } catch {
      textContent = `[PDF extraction failed: ${filename}]`
    }
  } else if (isDocx) {
    try {
      const mammoth = await import('mammoth')
      const result = await mammoth.extractRawText({ buffer: fileBytes })
      textContent = (result.value ?? '').slice(0, 8000)
    } catch {
      textContent = `[DOCX extraction failed: ${filename}]`
    }
  } else if (isPptx) {
    // PPTX is a ZIP of slide XML — basic extraction via jszip, if available.
    // For MVP treat as placeholder; text extraction added when jszip is added to deps.
    textContent = `[PPTX: ${filename}, ${fileBytes.length} bytes — text extraction not yet implemented]`
  } else {
    textContent = `[Binary document: ${filename}, ${mimeType} — format not supported for extraction]`
  }

  const isReadableText = isTextType || isSvg

  const prompt = `You are analyzing a document named "${filename}" (${mimeType}).

${isReadableText ? `Document content (first 8000 chars):\n${textContent}` : textContent}

Return ONLY a JSON object:
{
  "description": "one sentence summary of the document",
  "topics": ["topic1", "topic2"],
  "word_count_estimate": 500,
  "document_type": "report/specification/guide/presentation/etc",
  "confidence": 70,
  "recommendations": ["how this doc could be used in brand context"]
}
Return ONLY valid JSON.`

  try {
    const raw = await callAnthropicText(prompt, 'You are a document analysis assistant.', apiKeyOverride)
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    return JSON.parse(cleaned)
  } catch {
    return {
      description: `Document: ${filename}`,
      topics: [],
      word_count_estimate: 0,
      document_type: 'document',
      confidence: 0,
      recommendations: [],
    }
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const { user, workspaceId, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // ── Verify asset exists and belongs to this workspace ─────────────────────
  const { data: asset, error: assetError } = await getAsset(id, workspaceId)
  if (assetError) return NextResponse.json({ error: assetError }, { status: 500 })
  if (!asset) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!asset.storage_path) {
    return NextResponse.json({ error: 'Asset has no storage path' }, { status: 422 })
  }

  if (asset.status === 'archived') {
    return NextResponse.json({ error: 'Cannot analyze an archived asset' }, { status: 422 })
  }

  // Transition to 'processing' immediately so the UI shows the right state
  await updateAssetStatus(id, workspaceId, 'processing')

  try {
    // ── Download asset from storage (admin client — avoids anon RLS issues) ──
    // Use admin client for storage download to ensure we can always read
    // workspace assets regardless of bucket RLS policy configuration.
    const adminClient = getSupabaseAdmin()
    const { data: fileData, error: downloadError } = await adminClient.storage
      .from('brand-assets')
      .download(asset.storage_path)

    if (downloadError || !fileData) {
      await updateAssetStatus(id, workspaceId, 'failed')
      console.error('[analyze] storage download error:', downloadError?.message)
      return NextResponse.json(
        { error: `Failed to download asset from storage: ${downloadError?.message ?? 'unknown'}` },
        { status: 500 }
      )
    }

    const fileBytes = Buffer.from(await fileData.arrayBuffer())
    // SVGs are XML text — sending raw XML as image/png base64 to the VLM
    // produces garbage. Route them to document analysis instead.
    const isSvg = asset.mime_type === 'image/svg+xml'
    const isImage = asset.mime_type.startsWith('image/') && !isSvg

    // P3 — W6: resolve workspace BYOK key for Anthropic (single lookup, reused below)
    // Returns null if no workspace key configured — both helpers fall through to env key.
    const anthropicByokKey = await getProviderKey(workspaceId, 'anthropic').catch(() => null)

    // ── Run analysis ──────────────────────────────────────────────────────────
    let analysis: Record<string, unknown>

    if (isImage) {
      const imageBase64 = fileBytes.toString('base64')
      analysis = await analyzeImage(imageBase64, asset.mime_type, anthropicByokKey ?? undefined)
    } else {
      analysis = await analyzeDocument(fileBytes, asset.mime_type, asset.original_filename, anthropicByokKey ?? undefined)
    }

    // ── Persist result → status transitions to 'indexed' ─────────────────────
    const { data: updatedAsset, error: updateError } = await updateAssetVlmResult(
      id,
      workspaceId,
      analysis
    )
    if (updateError) {
      return NextResponse.json({ error: updateError }, { status: 500 })
    }

    // ── Feed brand signal learning (fire-and-forget) ──────────────────────
    // asset analysis result is now persisted in brand_assets.vlm_analysis.
    // Forward the extracted content to BrandMemoryServiceV2.learn() so that
    // StyleProjectionResolver can incorporate asset knowledge into future
    // generation prompts — closing the dead-end at brand_assets.vlm_analysis.
    //
    // Architectural rule: apps/web → CPL → BI.
    // Score gate: BrandMemoryServiceV2 skips signals below score_threshold
    // (default 40), so binary placeholder results (confidence=0) are
    // correctly blocked without reaching the DB. Non-fatal.
    try {
      const assetScore = typeof analysis.confidence === 'number'
        ? (analysis.confidence as number)
        : 0

      if (assetScore > 0) {
        // Synthesize a brand-relevant text fragment from all returned fields.
        // For images: description + mood + recommendations.
        // For documents: description + topics + recommendations.
        const signalText = [
          typeof analysis.description === 'string' ? analysis.description : null,
          ...(Array.isArray(analysis.recommendations) ? analysis.recommendations : []),
          ...(Array.isArray(analysis.topics) ? analysis.topics : []),
          typeof analysis.mood === 'string' ? `Mood: ${analysis.mood}` : null,
        ].filter(Boolean).join('\n')

        if (signalText.trim()) {
          await recordBrandMemoryObservation({
            requestId:     `asset_${id}`,
            workspaceId,
            artifactType:  isImage ? 'image_asset' : 'document_asset',
            artifactText:  signalText,
            artifactScore: assetScore,
            topic:         asset.original_filename ?? asset.name ?? id,
            wasRepaired:   false,
            observedAt:    new Date().toISOString(),
          })
        }
      }
    } catch (biErr: any) {
      // Non-fatal: asset analysis persisted successfully above.
      console.warn('[analyze] brand signal learning failed (non-fatal):', biErr?.message)
    }

    // ── Merge image analysis into the workspace's default persona ────────────
    // Ported from the prior duplicate implementation in /api/assets/[id]/route.ts
    // during the redesign consolidation (analyze logic now lives only here).
    // When a brand-asset image analysis comes back with reasonable confidence,
    // fold its color palette and typography personality into the default
    // persona's visual_style, so future generation prompts that read
    // persona.visual_style pick it up. Confined to images only — document
    // analysis has no comparable visual fields. Best-effort: failure here must
    // not fail the analyze request, since the VLM result has already been
    // persisted successfully above.
    if (isImage && typeof analysis.confidence === 'number' && analysis.confidence > 50 && user) {
      try {
        const { data: persona } = await getDefaultPersona(user.id)
        if (persona) {
          const existingStyle = (persona.visual_style as any) ?? {}
          const newColors = (analysis as any).colors?.primary ?? []
          const mergedPalette = [
            ...new Set([...newColors, ...(existingStyle?.visualStyle?.palette ?? [])]),
          ].slice(0, 6)

          await updatePersona(persona.id, {
            visual_style: {
              ...existingStyle,
              visualStyle: {
                ...(existingStyle.visualStyle ?? {}),
                palette: mergedPalette,
                vlm_confidence: analysis.confidence,
                last_vlm_analysis: new Date().toISOString(),
              },
              design_profile: {
                ...(existingStyle.design_profile ?? {}),
                brand_colors: mergedPalette,
                typography: (analysis as any).typography?.personality,
              },
            },
          })
        }
      } catch (mergeErr) {
        // Non-fatal — the asset analysis itself already succeeded and was persisted.
        console.error('[analyze] persona visual_style merge failed (non-fatal):', mergeErr)
      }
    }

    return NextResponse.json({
      success: true,
      asset: updatedAsset,
      analysis,
    })
  } catch (err: any) {
    await updateAssetStatus(id, workspaceId, 'failed').catch(() => {})
    console.error('[POST /api/assets/:id/analyze]', err)
    return NextResponse.json(
      { error: err?.message ?? 'Analysis failed' },
      { status: 500 }
    )
  }
}
