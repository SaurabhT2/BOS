/**
 * apps/web/lib/internal/read-optional-json-body.ts
 *
 * Internal runtime-verify POST routes accept a body that is entirely
 * optional — every field has a sensible default in the verification
 * service. CI typically calls these with no body at all. This helper reads
 * the body when present and returns `{}` for an empty or malformed body
 * instead of throwing, so a missing body never turns into a 500.
 */

import type { NextRequest } from 'next/server'

export async function readOptionalJsonBody(req: NextRequest): Promise<Record<string, any>> {
  const text = await req.text()
  if (!text.trim()) return {}
  try {
    const parsed = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}
