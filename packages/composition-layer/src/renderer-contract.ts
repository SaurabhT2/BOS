// ============================================================
// packages/composition-layer/src/renderer-contract.ts
//
// The interface every format renderer implements. See
// RENDERER_CONTRACT.md for the full "what belongs inside a
// renderer" specification. This file defines the contract only —
// it contains no renderer implementations (those live in
// apps/web/lib/artifact-export-*.ts and are wired up in later
// roadmap phases).
// ============================================================

import type { ArtifactType } from '@brandos/contracts'
import type { CompositionDocument } from './types'

export interface RenderOptions {
  /** PDF only. */
  pageSize?: 'A4' | 'Letter'
  /** PPTX only. */
  aspectRatio?: '16:9' | '4:3'
  /** Image/social renderer only. */
  targetCanvas?: { width: number; height: number }
  quality?: 'draft' | 'final'
}

export type RenderOutput =
  | { kind: 'html'; html: string }
  | { kind: 'bytes'; bytes: Uint8Array; mimeType: string }
  | { kind: 'canva'; designId: string; editUrl: string; viewUrl: string }
  | { kind: 'images'; images: Uint8Array[] }

/**
 * A renderer is a (mostly) pure function of (CompositionDocument, RenderOptions).
 * It never reads raw ArtifactV2 fields, never makes a layout/theme decision,
 * and never re-validates governance. See RENDERER_CONTRACT.md §2/§3 for the
 * full list of what is and is not allowed inside an implementation.
 */
export interface Renderer<TOutput extends RenderOutput = RenderOutput> {
  readonly formatId: string
  readonly supportedArtifactTypes: ArtifactType[]
  render(doc: CompositionDocument, options?: RenderOptions): Promise<TOutput>
}
