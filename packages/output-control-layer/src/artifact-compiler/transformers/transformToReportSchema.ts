// ============================================================
// @brandos/output-control-layer — artifact-compiler/transformers/transformToReportSchema.ts
//
// Maps a parsed LLM JSON object to the strict ReportSchema contract.
// Previously report was treated as text-only. This transformer handles
// structured report JSON output.
// ============================================================

import { coerceString } from '../utils/coerce';

export interface CanonicalReportSlide {
  title: string;
  bullets: string[];
  stats?: Array<{ value: string; label: string }>;
  type: 'cover' | 'section' | 'data' | 'closing';
}

export interface CanonicalReportSchema {
  $type: 'report';
  title: string;
  slides: CanonicalReportSlide[];
}

/**
 * transformToReportSchema — handles common LLM report shape variations.
 * Returns null if not a structured report JSON (text reports pass through).
 */
export function transformToReportSchema(parsed: unknown): CanonicalReportSchema | null {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const obj = parsed as Record<string, unknown>;

  const title = coerceString(obj.title ?? obj.name ?? obj.heading);
  if (!title) return null;

  const rawSlides =
    Array.isArray(obj.slides)   ? obj.slides   :
    Array.isArray(obj.pages)    ? obj.pages     :
    Array.isArray(obj.sections) ? obj.sections  :
    null;

  if (!rawSlides || rawSlides.length === 0) return null;

  const slides: CanonicalReportSlide[] = rawSlides
    .map(normalizeReportSlide)
    .filter((s): s is CanonicalReportSlide => s !== null);

  if (slides.length === 0) return null;

  return { $type: 'report', title, slides };
}

function normalizeReportSlide(raw: unknown): CanonicalReportSlide | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const s = raw as Record<string, unknown>;

  const title = coerceString(s.title ?? s.heading ?? s.name);
  if (!title) return null;

  let bullets: string[] = [];
  if (Array.isArray(s.bullets))      bullets = s.bullets.map(String).filter(Boolean);
  else if (Array.isArray(s.points))  bullets = s.points.map(String).filter(Boolean);
  else if (typeof s.body === 'string') bullets = s.body.split(/\.\s+/).map((t: string) => t.trim()).filter(Boolean);

  let stats: CanonicalReportSlide['stats'] | undefined;
  if (Array.isArray(s.stats)) {
    stats = (s.stats as unknown[]).map((st) => {
      if (!st || typeof st !== 'object') return null;
      const stObj = st as Record<string, unknown>;
      const value = coerceString(stObj.value ?? stObj.number ?? stObj.amount);
      const label = coerceString(stObj.label ?? stObj.name ?? stObj.description);
      if (!value || !label) return null;
      return { value, label };
    }).filter((st): st is { value: string; label: string } => st !== null);
  }

  const typeRaw = coerceString(s.type) ?? '';
  const validTypes: CanonicalReportSlide['type'][] = ['cover', 'section', 'data', 'closing'];
  const type: CanonicalReportSlide['type'] = validTypes.includes(typeRaw as CanonicalReportSlide['type'])
    ? (typeRaw as CanonicalReportSlide['type'])
    : 'section';

  return {
    title,
    bullets,
    ...(stats && stats.length > 0 && { stats }),
    type,
  };
}


