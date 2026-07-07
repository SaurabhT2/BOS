/**
 * POST /api/extract-from-url
 * Extracts readable text content from a URL for use as generation context.
 * Referenced by studio page but was previously missing.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/supabase-server'

export const runtime = 'nodejs'

const MAX_CONTENT_CHARS = 3000
const TIMEOUT_MS = 10_000

export async function POST(req: NextRequest) {
  const { user, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const { url } = body

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid URL' }, { status: 400 })
    }

    // Validate URL
    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return NextResponse.json({ error: 'Only HTTP/HTTPS URLs are supported' }, { status: 400 })
      }
    } catch {
      return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 })
    }

    // Fetch the page
    const fetchRes = await fetch(parsedUrl.toString(), {
      headers: {
        'User-Agent': 'BrandOS/1.0 (content extractor)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (!fetchRes.ok) {
      return NextResponse.json(
        { error: `Failed to fetch URL: ${fetchRes.status} ${fetchRes.statusText}` },
        { status: 422 }
      )
    }

    const contentType = fetchRes.headers.get('content-type') ?? ''
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      return NextResponse.json(
        { error: 'URL does not return HTML content' },
        { status: 422 }
      )
    }

    const html = await fetchRes.text()

    // Simple but robust text extraction without DOM parser
    const stripped = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, MAX_CONTENT_CHARS)

    if (stripped.length < 50) {
      return NextResponse.json({ error: 'Could not extract readable content from URL' }, { status: 422 })
    }

    return NextResponse.json({
      success: true,
      content: stripped,
      url: parsedUrl.toString(),
      charCount: stripped.length,
    })
  } catch (error: any) {
    const isTimeout = error?.name === 'TimeoutError' || error?.name === 'AbortError'
    if (isTimeout) {
      return NextResponse.json({ error: 'URL fetch timed out after 10 seconds' }, { status: 408 })
    }
    console.error('[extract-from-url]', error)
    return NextResponse.json({ error: error?.message || 'Extraction failed' }, { status: 500 })
  }
}


