// ============================================================
// @brandos/runtime-config — src/credentials/validator.ts
//
// PROVIDER KEY VALIDATION
//
// PURPOSE:
//   Live validation of a candidate API key against the actual provider API.
//   Called exclusively from W7's POST /api/workspace/providers route —
//   NEVER from the generation hot path.
//
// DESIGN:
//   Each provider uses its cheapest possible live check:
//     - Anthropic:    POST /v1/messages with max_tokens=1 (minimal tokens)
//     - OpenAI:       GET  /v1/models (no generation, just list)
//     - Google:       POST /v1beta/models/{model}:generateContent (min tokens)
//     - OpenRouter:   GET  /api/v1/models
//     - OpenAI-compat (groq, deepseek, togetherai): GET /models equivalent
//
//   A 5-second timeout is applied to every outbound call — the W7 route
//   is the only place that makes outbound provider network calls from
//   a server route handler, and we don't want a slow provider to hang the
//   UI. Returns { valid: false, error: 'timeout' } on abort.
//
//   Returns { valid: boolean; error?: string } — never throws.
//
// SECURITY:
//   The plaintext key is passed in from the calling route — it has already
//   been extracted from the request body (W7) or decrypted from the DB
//   (for revalidation). This function does NOT receive the encrypted form.
//   NEVER log the plaintextKey parameter.
//
// CONSUMERS:
//   - apps/web/app/api/workspace/providers/route.ts  (W7 — POST add/revalidate)
// ============================================================

const VALIDATION_TIMEOUT_MS = 5_000

/** Result of a provider key validation check. */
export interface ValidationResult {
  valid:  boolean
  error?: string
}

/**
 * Validate a candidate plaintext API key against the named provider.
 * Never throws. Returns { valid: false, error: ... } on any failure.
 *
 * @param provider     - Provider ID (e.g. 'anthropic', 'openai').
 * @param plaintextKey - The raw API key to test. NEVER LOG THIS.
 */
export async function validateProviderKey(
  provider:     string,
  plaintextKey: string,
): Promise<ValidationResult> {
  try {
    switch (provider) {
      case 'anthropic':
        return await validateAnthropic(plaintextKey)
      case 'openai':
        return await validateOpenAI(plaintextKey)
      case 'google':
        return await validateGoogle(plaintextKey)
      case 'groq':
        return await validateOpenAICompatible(plaintextKey, 'https://api.groq.com/openai/v1/models')
      case 'deepseek':
        return await validateOpenAICompatible(plaintextKey, 'https://api.deepseek.com/models')
      case 'openrouter':
        return await validateOpenAICompatible(plaintextKey, 'https://openrouter.ai/api/v1/models')
      case 'togetherai':
        return await validateOpenAICompatible(plaintextKey, 'https://api.together.xyz/v1/models')
      default:
        // Unknown provider — accept optimistically (can't know the endpoint)
        return { valid: true }
    }
  } catch (err) {
    return { valid: false, error: (err as Error).message }
  }
}

// ─── Per-provider validators ──────────────────────────────────────────────────

async function validateAnthropic(apiKey: string): Promise<ValidationResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), VALIDATION_TIMEOUT_MS)

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages:   [{ role: 'user', content: 'Hi' }],
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer))

    if (res.status === 401) return { valid: false, error: 'Invalid API key' }
    if (res.status === 429) return { valid: true }  // rate-limited = key is valid
    if (!res.ok && res.status >= 500) return { valid: false, error: `Anthropic service error ${res.status}` }
    return { valid: res.ok || res.status === 400 }  // 400 = key valid, malformed request
  } catch (err) {
    if ((err as Error).name === 'AbortError') return { valid: false, error: 'Validation timed out' }
    return { valid: false, error: (err as Error).message }
  }
}

async function validateOpenAI(apiKey: string): Promise<ValidationResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), VALIDATION_TIMEOUT_MS)

  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal:  controller.signal,
    }).finally(() => clearTimeout(timer))

    if (res.status === 401) return { valid: false, error: 'Invalid API key' }
    if (res.status === 429) return { valid: true }
    return { valid: res.ok }
  } catch (err) {
    if ((err as Error).name === 'AbortError') return { valid: false, error: 'Validation timed out' }
    return { valid: false, error: (err as Error).message }
  }
}

async function validateGoogle(apiKey: string): Promise<ValidationResult> {
  // F7: Use x-goog-api-key header, NOT URL query param
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), VALIDATION_TIMEOUT_MS)

  const model = 'gemini-2.5-flash'
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'x-goog-api-key': apiKey,
        },
        body:   JSON.stringify({
          contents:        [{ parts: [{ text: 'Hi' }] }],
          generationConfig: { maxOutputTokens: 1 },
        }),
        signal: controller.signal,
      }
    ).finally(() => clearTimeout(timer))

    if (res.status === 400) return { valid: false, error: 'Invalid API key or bad request' }
    if (res.status === 401 || res.status === 403) return { valid: false, error: 'Invalid API key' }
    if (res.status === 429) return { valid: true }
    return { valid: res.ok }
  } catch (err) {
    if ((err as Error).name === 'AbortError') return { valid: false, error: 'Validation timed out' }
    return { valid: false, error: (err as Error).message }
  }
}

async function validateOpenAICompatible(
  apiKey:   string,
  endpoint: string,
): Promise<ValidationResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), VALIDATION_TIMEOUT_MS)

  try {
    const res = await fetch(endpoint, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal:  controller.signal,
    }).finally(() => clearTimeout(timer))

    if (res.status === 401) return { valid: false, error: 'Invalid API key' }
    if (res.status === 429) return { valid: true }
    return { valid: res.ok }
  } catch (err) {
    if ((err as Error).name === 'AbortError') return { valid: false, error: 'Validation timed out' }
    return { valid: false, error: (err as Error).message }
  }
}

// ─── Format pre-check ─────────────────────────────────────────────────────────

/**
 * Cheap format validation before making a live network call.
 * Rejects obviously malformed keys (empty, too short, wrong prefix) so we
 * don't waste a round-trip on junk input.
 *
 * Returns null when the format looks valid; returns an error string otherwise.
 */
export function validateKeyFormat(provider: string, key: string): string | null {
  if (!key || key.trim().length === 0) return 'API key cannot be empty'
  if (key.length < 8) return 'API key is too short'

  switch (provider) {
    case 'openai':
      if (!key.startsWith('sk-')) return 'OpenAI keys must start with "sk-"'
      break
    case 'anthropic':
      if (!key.startsWith('sk-ant-')) return 'Anthropic keys must start with "sk-ant-"'
      break
    // Google and others have no stable prefix to validate
  }

  return null
}
