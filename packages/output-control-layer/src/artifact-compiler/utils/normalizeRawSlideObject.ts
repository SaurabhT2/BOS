// ============================================================
// @brandos/output-control-layer — artifact-compiler/utils/normalizeRawSlideObject.ts
//
// Normalizes a raw (unknown) slide object into a structured form
// before type-specific coercion in carousel/deck/report compilers.
// ============================================================

import type { CarouselRole, RichCarouselSlide } from '@brandos/contracts';
import { CAROUSEL_ROLES } from '@brandos/contracts';
import { inferRoleFromIndex } from './inferRoleFromIndex';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function coerceRole(raw: unknown, index: number): CarouselRole {
  if (typeof raw === 'string' && CAROUSEL_ROLES.includes(raw as CarouselRole)) {
    return raw as CarouselRole;
  }
  // Map string role variants from inferRoleFromIndex to CarouselRole
  const inferred = inferRoleFromIndex(index, 99); // total=99 → position-based only
  if (CAROUSEL_ROLES.includes(inferred as CarouselRole)) {
    return inferred as CarouselRole;
  }
  return 'insight';
}

function extractBullets(raw: unknown): string[] | undefined {
  if (Array.isArray(raw)) return raw.map(String).filter(s => s.trim().length > 0);
  if (typeof raw === 'string' && raw.includes('\n')) {
    return raw.split('\n').map(s => s.replace(/^[-•*]\s*/, '').trim()).filter(Boolean);
  }
  return undefined;
}

function extractSupportingEvidence(slide: Record<string, unknown>): string[] | undefined {
  const candidates = ['supporting_evidence', 'evidence', 'data_points', 'proof_points'];
  for (const key of candidates) {
    const v = slide[key];
    if (Array.isArray(v) && v.length > 0) return v.map(String);
  }
  return undefined;
}

const SLIDE_DENSITY_TARGET = 40;

function scoreSlide(slide: RichCarouselSlide): { density: number; persuasion: number } {
  const words = [
    slide.headline ?? '',
    slide.subheadline ?? '',
    slide.body ?? '',
    ...(slide.bullets ?? []),
    slide.insight ?? '',
    slide.key_takeaway ?? '',
  ].join(' ').split(/\s+/).filter(Boolean).length;

  const density = Math.min(100, Math.round((words / SLIDE_DENSITY_TARGET) * 100));

  let persuasion = 40;
  if (slide.insight) persuasion += 20;
  if (slide.key_takeaway) persuasion += 20;
  if (slide.supporting_evidence?.length) persuasion += 15;
  if (slide.bullets && slide.bullets.length >= 2) persuasion += 5;
  persuasion = Math.min(100, persuasion);

  return { density, persuasion };
}

/**
 * normalizeRawSlideObject — coerce unknown raw slide into RichCarouselSlide.
 *
 * Extracted from carousel-compiler.ts (coerceSlide).
 * Owns field normalization, role coercion, density scoring.
 */
export function normalizeRawSlideObject(raw: unknown, index: number): RichCarouselSlide {
  const s = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};

  const headline = String(s.headline ?? s.title ?? `Slide ${index + 1}`);
  const role = coerceRole(s.role, index);
  const bullets = extractBullets(s.bullets ?? s.bullet_points);
  const supporting_evidence = extractSupportingEvidence(s);
  const body = typeof s.body === 'string' ? s.body
    : typeof s.subtext === 'string' ? s.subtext
    : typeof s.description === 'string' ? s.description
    : undefined;

  const subheadline = typeof s.subheadline === 'string' ? s.subheadline : undefined;
  const insight = typeof s.insight === 'string' ? s.insight : undefined;
  const key_takeaway = typeof s.key_takeaway === 'string' ? s.key_takeaway
    : typeof s.takeaway === 'string' ? s.takeaway : undefined;
  const cta = typeof s.cta === 'string' ? s.cta : undefined;
  const visual_direction = typeof s.visual_direction === 'string' ? s.visual_direction : undefined;
  const emphasis_keywords = Array.isArray(s.emphasis_keywords) ? s.emphasis_keywords.map(String) : undefined;
  const speaker_notes = typeof s.speaker_notes === 'string' ? s.speaker_notes : undefined;

  const slide: RichCarouselSlide = {
    slide: index + 1,
    role,
    headline,
    ...(subheadline !== undefined && { subheadline }),
    ...(body !== undefined && { body }),
    ...(bullets !== undefined && { bullets }),
    ...(insight !== undefined && { insight }),
    ...(supporting_evidence !== undefined && { supporting_evidence }),
    ...(key_takeaway !== undefined && { key_takeaway }),
    ...(cta !== undefined && { cta }),
    ...(visual_direction !== undefined && { visual_direction }),
    ...(emphasis_keywords !== undefined && { emphasis_keywords }),
    ...(speaker_notes !== undefined && { speaker_notes }),
  };

  const { density, persuasion } = scoreSlide(slide);
  slide.semantic_density_score = density;
  slide.persuasion_score = persuasion;

  return slide;
}


