// ============================================================
// @brandos/output-control-layer — artifact-compiler/transformers/transformToDeckSchema.ts
//
// Maps a parsed LLM JSON object to the strict DeckSchema contract.
// ============================================================

import { coerceString } from '../utils/coerce';

export interface CanonicalDeckSection {
  heading: string;
  talkingPoints: string[];
}

export interface CanonicalDeckSchema {
  $type: 'deck';
  title: string;
  sections: CanonicalDeckSection[];
}

/**
 * transformToDeckSchema — handles common LLM deck shape variations:
 *
 *   Canonical:   { title, sections: [{ heading, talkingPoints }] }
 *   Variation 1: sections as [{ title, points }]
 *   Variation 2: sections as [{ heading, bullets }]
 *   Variation 3: sections nested under "slides" or "pages"
 */
export function transformToDeckSchema(parsed: unknown): CanonicalDeckSchema | null {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const obj = parsed as Record<string, unknown>;

  const title = coerceString(obj.title ?? obj.name ?? obj.heading);
  if (!title) return null;

  const rawSections =
    Array.isArray(obj.sections) ? obj.sections :
    Array.isArray(obj.slides)   ? obj.slides   :
    Array.isArray(obj.pages)    ? obj.pages     :
    null;

  if (!rawSections || rawSections.length === 0) return null;

  const sections: CanonicalDeckSection[] = rawSections
    .map(normalizeSection)
    .filter((s): s is CanonicalDeckSection => s !== null);

  if (sections.length === 0) return null;

  return { $type: 'deck', title, sections };
}

function normalizeSection(raw: unknown): CanonicalDeckSection | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const s = raw as Record<string, unknown>;

  const heading = coerceString(s.heading ?? s.title ?? s.name);
  if (!heading) return null;

  let talkingPoints: string[] = [];
  if (Array.isArray(s.talkingPoints))  talkingPoints = s.talkingPoints.map(String).filter(Boolean);
  else if (Array.isArray(s.points))    talkingPoints = s.points.map(String).filter(Boolean);
  else if (Array.isArray(s.bullets))   talkingPoints = s.bullets.map(String).filter(Boolean);
  else if (Array.isArray(s.items))     talkingPoints = s.items.map(String).filter(Boolean);
  else if (typeof s.body === 'string') talkingPoints = s.body.split(/\.\s+/).map((t: string) => t.trim()).filter(Boolean);

  return { heading, talkingPoints };
}


