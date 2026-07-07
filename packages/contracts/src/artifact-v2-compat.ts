// ============================================================
// @brandos/contracts — artifact-v2-compat.ts
//
// BACKWARD-COMPATIBILITY SHIM ONLY.
// Do NOT add new types here.
// ArtifactTheme kept alive solely for pptx renderer compatibility
// until that renderer migrates to SemanticTheme from artifact-v2.ts.
// ============================================================

/**
 * @deprecated  Use SemanticTheme from artifact-v2.ts instead.
 * This type will be removed once the pptx renderer migrates.
 */
export interface ArtifactTheme {
  preset?: 'executive-dark' | 'modern-light' | 'vibrant' | 'minimal' | 'corporate' | 'social';
  primaryColor: string;
  accentColor: string;
  bgColor: string;
  surfaceColor?: string;
  fontTitle: string;
  fontBody: string;
  fontSizeTitle?: number;
  fontSizeBody?: number;
  lineHeight?: number;
  letterSpacing?: number;
}


