// ============================================================
// @brandos/output-control-layer — artifact-compiler/transformers/transformToCarouselSchema.ts
//
// Maps a parsed (but possibly loose) LLM JSON object to the strict
// canonical carousel schema.
//
// CAROUSEL SCHEMA FIX:
//   The canonical schema (from CAROUSEL_SCHEMA_INSTRUCTION) uses:
//     slides[].role, slides[].headline, slides[].body, slides[].visualNote?
//
//   This transformer normalizes ALL variant shapes (old title+bullets,
//   new role+headline+body, and mixed) into the canonical shape.
//   The repair path (repairJSON CAROUSEL_REPAIR_HINT) is aligned to this schema.
//   No schema shape changes occur during pipeline execution.
//
// Handles 5 common LLM shape variations:
//   Canonical:   { slides: [{ role, headline, body }] }
//   Variation 1: slides as [{ headline, bullets }] (old schema — normalize body from bullets)
//   Variation 2: slides as [{ title, points }]
//   Variation 3: top-level "intro" instead of "hook"
//   Variation 4: slides nested under "pages" or "sections"
//   Variation 5: wrapped in { title, hook, slides, cta } envelope
// ============================================================

import { coerceString } from '../utils/coerce';

export interface CanonicalCarouselSlide {
  role: string;
  headline: string;
  body: string;
  visualNote?: string;
}

export interface CanonicalCarouselSchema {
  slides: CanonicalCarouselSlide[];
  // Envelope fields (optional — present when LLM includes them)
  title?: string;
  hook?: string;
  cta?: string;
}

/**
 * transformToCarouselSchema — normalizes all LLM shape variants into the
 * canonical { slides: [{ role, headline, body, visualNote? }] } schema.
 *
 * Returns null if the parsed object is missing structurally required fields.
 */
export function transformToCarouselSchema(parsed: unknown): CanonicalCarouselSchema | null {
  if (!parsed || typeof parsed !== 'object') return null;

  // Handle array at top level — treat as slides
  if (Array.isArray(parsed)) {
    const slides = parsed.map((item, i) => normalizeSlide(item, i)).filter((s): s is CanonicalCarouselSlide => s !== null);
    if (slides.length === 0) return null;
    return { slides };
  }

  const obj = parsed as Record<string, unknown>;

  // Accept slides under several common keys
  const rawSlides =
    Array.isArray(obj.slides)   ? obj.slides   :
    Array.isArray(obj.pages)    ? obj.pages     :
    Array.isArray(obj.sections) ? obj.sections  :
    Array.isArray(obj.cards)    ? obj.cards     :
    null;

  if (!rawSlides || rawSlides.length === 0) return null;

  const slides: CanonicalCarouselSlide[] = rawSlides
    .map((raw, i) => normalizeSlide(raw, i))
    .filter((s): s is CanonicalCarouselSlide => s !== null);

  if (slides.length === 0) return null;

  // Extract optional envelope fields
  const title = coerceString(obj.title ?? obj.name ?? obj.heading) ?? undefined;
  const hook = coerceString(obj.hook ?? obj.intro ?? obj.subtitle) ?? undefined;
  const cta = coerceString(obj.cta ?? obj.callToAction ?? obj.call_to_action) ?? undefined;

  return {
    slides,
    ...(title && { title }),
    ...(hook && { hook }),
    ...(cta && { cta }),
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * normalizeSlide — maps any LLM slide variant to CanonicalCarouselSlide.
 *
 * Shape handling:
 *   - New schema: { role, headline, body, visualNote? } → direct
 *   - Old schema: { headline, bullets[] } → body from bullets.join('. ')
 *   - Variant: { title, points[] } → headline from title, body from points
 *   - Variant: { heading, body: string } → direct
 */
function normalizeSlide(raw: unknown, index: number): CanonicalCarouselSlide | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const s = raw as Record<string, unknown>;

  const headline = coerceString(s.headline ?? s.title ?? s.heading ?? s.name);
  if (!headline) return null;

  // Role: use provided or infer from index
  const role = coerceString(s.role) ?? inferRoleLabel(index);

  // Body: prefer explicit body, fall back to bullets/points/items array, then text/subtext
  let body: string;
  if (typeof s.body === 'string' && s.body.trim().length > 0) {
    body = s.body.trim();
  } else if (Array.isArray(s.bullets) && s.bullets.length > 0) {
    body = (s.bullets as unknown[]).map(String).filter(Boolean).join('. ');
  } else if (Array.isArray(s.points) && s.points.length > 0) {
    body = (s.points as unknown[]).map(String).filter(Boolean).join('. ');
  } else if (Array.isArray(s.items) && s.items.length > 0) {
    body = (s.items as unknown[]).map(String).filter(Boolean).join('. ');
  } else if (typeof s.subtext === 'string' && s.subtext.trim().length > 0) {
    body = s.subtext.trim();
  } else if (typeof s.text === 'string' && s.text.trim().length > 0) {
    body = s.text.trim();
  } else if (typeof s.description === 'string' && s.description.trim().length > 0) {
    body = s.description.trim();
  } else {
    body = '';
  }

  const visualNote = coerceString(s.visualNote ?? s.visual_direction ?? s.visual ?? s.note) ?? undefined;

  return {
    role,
    headline,
    body,
    ...(visualNote && { visualNote }),
  };
}

function inferRoleLabel(index: number): string {
  const roles = ['hook', 'problem', 'reframe', 'framework', 'evidence', 'insight', 'CTA'];
  return roles[index] ?? 'insight';
}


