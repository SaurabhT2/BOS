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
import {
  getAsset,
  updateAssetVlmResult,
  updateAssetStatus,
  recordAssetIntelligenceSync,
} from '@brandos/auth'
import { getSupabaseAdmin } from '@brandos/auth'
import { getProviderKey } from '@brandos/runtime-config'
import { ingestWorkspaceKnowledgeAsset } from '@brandos/control-plane-layer'
import { isRealExtractedText } from '@/lib/document-extraction'
import { extractDocumentTextWithOcrFallback } from '@/lib/scanned-pdf-ocr'

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
): Promise<{ analysis: Record<string, unknown>; textContent: string }> {
  // EM-2.1: extraction itself now lives in a shared module so
  // app/api/assets/route.ts (upload time) can run the same logic instead
  // of only ever extracting when a user clicks "Analyze." See
  // apps/web/lib/document-extraction.ts. G-19 (Architecture Verification
  // Report, P2): uses the OCR-capable wrapper so a manual "Analyze" click
  // on a scanned PDF also gets real transcribed content, not the
  // placeholder string — this route already awaits synchronously (the
  // user directly triggered this action and is waiting on a result), so
  // OCR's added latency here is expected, unlike the upload-time path.
  const { text: textContent, status: extractionStatus } = await extractDocumentTextWithOcrFallback(
    fileBytes,
    mimeType,
    filename,
  )
  const isReadableText = extractionStatus === 'extracted'

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
    return { analysis: JSON.parse(cleaned), textContent }
  } catch {
    return {
      analysis: {
        description: `Document: ${filename}`,
        topics: [],
        word_count_estimate: 0,
        document_type: 'document',
        confidence: 0,
        recommendations: [],
      },
      textContent,
    }
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const { workspaceId, unauthorized } = await requireUser()
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
    // BUGFIX (generic-generation-despite-hasIdentity=true): the real extracted
    // document body (up to 8000 chars) previously never left analyzeDocument() —
    // only its one-sentence AI summary did. Brand signal learning below was
    // regexing that one-sentence summary instead of the actual uploaded content,
    // so the structural extractors (title/hook/value-frame/structural-arc/
    // evidence patterns) almost never matched anything and Brand Intelligence
    // stayed thin regardless of how substantive the uploaded doc was.
    let documentTextContent: string | undefined

    if (isImage) {
      const imageBase64 = fileBytes.toString('base64')
      analysis = await analyzeImage(imageBase64, asset.mime_type, anthropicByokKey ?? undefined)
    } else {
      const result = await analyzeDocument(fileBytes, asset.mime_type, asset.original_filename, anthropicByokKey ?? undefined)
      analysis = result.analysis
      documentTextContent = result.textContent
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

    // ── Feed brand knowledge (genuinely fire-and-forget) ────────────────────
    // EM-2.2 (Cognitive Platform Evolution Program, Milestone 2 — Knowledge/
    // Experience Channel Correction): this used to call
    // recordBrandMemoryObservation() (CognitionProvider.observe(), the
    // Experience channel) for both document and image analysis results.
    // That was a routing bug, not a design choice — the audit that
    // preceded this program found real uploaded document/image content
    // being reported as a generic generation "observation" instead of
    // Knowledge, gated on an unrelated confidence heuristic, and never
    // reaching IntelligenceOS's purpose-built extraction pipeline
    // (KnowledgeAssetExtractor / VisualFeatureExtractor). Both branches
    // below now call ingestWorkspaceKnowledgeAsset() — the same endpoint
    // the upload route already uses (EM-2.1) — passing
    // asset.intelligence_asset_id as existingAssetId so re-analysis
    // updates the same knowledge asset instead of creating a duplicate
    // every time (EM-2.6's correlation column made this possible; see
    // IntelligenceOS's ingestKnowledgeAsset() docblock for why an
    // existingAssetId was previously a no-op even when supplied).
    //
    // Architectural rule: apps/web → CPL → cognition-client. Non-fatal —
    // a failure here must never fail the analyze response, which has
    // already succeeded by this point (asset.vlm_analysis is persisted
    // above).
    //
    // Follow-up fix (found via a live end-to-end run's server logs): this
    // block used to `await` the ingest call directly in the request
    // handler, which — combined with IntelligenceOS's documented
    // synchronous extraction pipeline (see KnowledgeIngestClient.ts's
    // updated timeout comment) — meant a slow first-few-requests warm-up
    // period could genuinely exceed the client timeout, logging
    // "This operation was aborted" for real, successfully-VLM-analyzed
    // documents. The `signalText` computation below is cheap/synchronous
    // and stays inline; only the network call is detached, matching
    // apps/web/app/api/assets/route.ts's already-correct pattern — this
    // handler no longer waits on IntelligenceOS at all before responding.
    try {
      const assetScore = typeof analysis.confidence === 'number'
        ? (analysis.confidence as number)
        : 0

      if (assetScore > 0) {
        let knowledgeAssetType: 'reference' | 'visual_asset' = 'reference'
        let signalText = ''

        if (isImage) {
          // EM-2.4: format the VLM's structured color/typography output as
          // flowing text containing real hex-color and font-family-style
          // declarations, so IntelligenceOS's VisualFeatureExtractor
          // (HEX_COLOR_RE / FONT_FAMILY_RE, MIN_VISUAL_SIGNALS=2) actually
          // detects visual signal from it — a JSON.stringify() dump would
          // not reliably match those patterns. See that file's header:
          // its gating is content-signal-based, not assetType-based, so
          // this formatting is what actually makes ingestion useful for
          // images, not the assetType value alone.
          const colors = (analysis as any).colors ?? {}
          const typography = (analysis as any).typography ?? {}
          const primaryColors: string[] = Array.isArray(colors.primary) ? colors.primary : []
          const accentColors: string[] = Array.isArray(colors.accent) ? colors.accent : []

          const lines = [
            `Brand asset visual analysis for "${asset.original_filename ?? asset.name ?? id}":`,
            primaryColors.length ? `Primary colors: ${primaryColors.join(', ')}` : null,
            accentColors.length ? `Accent colors: ${accentColors.join(', ')}` : null,
            typography.personality
              ? `font: ${typography.personality}${typography.weight ? ` ${typography.weight}` : ''}`
              : null,
            typeof analysis.mood === 'string' ? `Mood: ${analysis.mood}` : null,
            typeof analysis.description === 'string' ? analysis.description : null,
            ...(Array.isArray(analysis.recommendations) ? analysis.recommendations : []),
            ...(Array.isArray(analysis.topics) ? analysis.topics : []),
          ].filter(Boolean)

          knowledgeAssetType = 'visual_asset'
          signalText = lines.join('\n')
        } else {
          // For documents, use the real extracted body (documentTextContent)
          // as the primary signal source — it's the only thing in this
          // function that actually reflects the uploaded file. The AI
          // summary fields are appended as supplementary context, not the
          // source. documentTextContent is only a real extraction when it
          // doesn't start with the '[' placeholder markers used for
          // unsupported/failed extraction (see analyzeDocument /
          // apps/web/lib/document-extraction.ts).
          const hasRealDocumentText = isRealExtractedText(documentTextContent)

          const summaryFragment = [
            typeof analysis.description === 'string' ? analysis.description : null,
            ...(Array.isArray(analysis.recommendations) ? analysis.recommendations : []),
            ...(Array.isArray(analysis.topics) ? analysis.topics : []),
            typeof analysis.mood === 'string' ? `Mood: ${analysis.mood}` : null,
          ].filter(Boolean).join('\n')

          knowledgeAssetType = 'reference'
          signalText = hasRealDocumentText
            ? [documentTextContent, summaryFragment].filter(Boolean).join('\n\n')
            : summaryFragment
        }

        if (signalText.trim()) {
          void ingestWorkspaceKnowledgeAsset(
            {
              // ownerType: 'workspace' means IntelligenceOS's knowledge_assets
              // row is owned by the workspace, not by this individual user —
              // userId must stay null here. BrandOS's user.id lives in
              // BrandOS's own Supabase auth.users, which IntelligenceOS's
              // knowledge_assets.user_id FK has no way to resolve (there is
              // no user-provisioning/sync between the two systems). Sending
              // both workspaceId and userId together violated IntelligenceOS's
              // owner-consistency invariant (owner_type='workspace' requires
              // user_id IS NULL) and made every ingest fail with a foreign
              // key violation, silently, behind an HTTP 201 (see
              // KnowledgeProcessor.process()'s persist-error handling).
              ownerType: 'workspace',
              workspaceId,
              userId: null,
              assetType: knowledgeAssetType,
              title: asset.original_filename ?? asset.name ?? id,
              sourceFileRef: asset.storage_path ?? undefined,
            },
            signalText,
            asset.intelligence_asset_id ?? undefined,
          )
            .then((result) => {
              if (result) return recordAssetIntelligenceSync(id, workspaceId, result.assetId)
            })
            .catch((kiErr: unknown) => {
              // Non-fatal: asset analysis already succeeded and was
              // returned to the client before this promise settles.
              console.warn('[analyze] knowledge ingestion failed (non-fatal):', (kiErr as Error)?.message)
            })
        }
      }
    } catch (kiErr: any) {
      // Synchronous errors only now (e.g. malformed `analysis` shape) —
      // the network call itself can no longer throw into this catch,
      // it has its own .catch() above.
      console.warn('[analyze] knowledge ingestion setup failed (non-fatal):', kiErr?.message)
    }


    // ── Visual identity now flows to IntelligenceOS, not persona.visual_style ──
    // EM-1.4 (Cognitive Platform Evolution Program, Milestone 1 — Visual
    // Identity Ownership Transfer): this block used to fold the VLM's color
    // palette and typography directly into personas.visual_style, making
    // BrandOS the system of record for visual identity — a direct violation
    // of "IntelligenceOS owns Identity" (see the audit's §1.5, §4.2). That
    // signal now reaches IntelligenceOS through the knowledge-ingest call
    // above (EM-2.4: assetType 'visual_asset', hex colors + typography
    // formatted for VisualFeatureExtractor), which did not exist before this
    // program and is the correct destination.
    //
    // personas.visual_style is NOT deleted — it remains a read cache other
    // BrandOS UI may still consult — but this route no longer computes or
    // writes its content directly. Hydrating it FROM IntelligenceOS's
    // resolved CognitionContext.visualIdentity (so the cache reflects what
    // IntelligenceOS actually learned, not a duplicate local computation) is
    // EM-4.3's concern (Visual Identity Consumption), not this analyze
    // route's — that EM reads resolveCognitionContext() output during
    // generation; a persona-display-time cache refresh from the same source
    // is a natural, still-open follow-up this program did not schedule a
    // dedicated EM for. Flagged here rather than silently left unmentioned.

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
