// ============================================================
// @brandos/output-control-layer — utils/coerce.ts
//
// Shared coercion utilities used across transform modules.
// ============================================================

/**
 * coerceString — coerce unknown value to trimmed string or null.
 */
export function coerceString(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number') return String(v);
  return null;
}


