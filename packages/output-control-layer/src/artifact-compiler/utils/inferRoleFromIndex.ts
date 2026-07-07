// ============================================================
// @brandos/output-control-layer — artifact-compiler/utils/inferRoleFromIndex.ts
//
// Role inference from slide index when the model did not supply roles.
// Index-based because we cannot infer semantic intent from content alone.
// ============================================================

/**
 * inferRoleFromIndex — canonical role inference by position.
 *
 * Extracted from weakModelAdapter.ts (was private helper inferRoleFromIndex).
 * artifact-compiler owns role inference; output-normalizer must NOT own it.
 */
export function inferRoleFromIndex(index: number, total: number): string {
  if (index === 0) return 'hook';
  if (index === total - 1) return 'cta';
  if (index === 1) return 'problem';
  if (index === 2) return 'solution';
  return 'insight';
}


