/**
 * @brandos/artifact-engine-layer — compiler/deck.ts
 *
 * DeckCompiler — ICompiler<DeckArtifact> implementation.
 *
 * WHAT IT DOES:
 *   Adapts compileDeckArtifact() from @brandos/output-control-layer into
 *   the ICompiler<DeckArtifact> interface that ArtifactEngine.compile() expects.
 *
 * ARCHITECTURE NOTE:
 *   Mirror of CarouselCompiler's adapter pattern — same structure, different types.
 *   Deck compilation is deterministic and pure. No LLM calls. No I/O.
 *
 * INPUT HANDLING:
 *   - raw is string: passed directly to compileDeckArtifact().
 *   - raw is DraftArtifactInput or object: serialized to JSON string first.
 *
 * TONE OPTION:
 *   DeckCompiler does NOT forward `tone` to compileDeckArtifact() because
 *   the deck OCL does not currently support the tone parameter. If deck OCL
 *   adds tone support, update this adapter to forward it (same pattern as carousel).
 *   See compileOptions construction below for where to add it.
 *
 * RETURN:
 *   CompileResult & { artifact: DeckArtifact }
 *   - artifact: the fully normalized, $schema-stamped DeckArtifact.
 *   - durationMs: wall-clock time of the OCL compile step.
 *   - inputType: always 'json'.
 *   - slideCount: number of slides in the compiled deck.
 *
 * REGISTRATION:
 *   Called from bootstrap.ts: globalArtifactRegistry.registerCompiler(new DeckCompiler())
 */

import { compileDeckArtifact } from '@brandos/output-control-layer'
import type {
  DeckArtifact,
  CompileOptions,
  CompileResult,
  DraftArtifactInput,
} from '@brandos/contracts'
import type { ICompiler } from '../interfaces'

export class DeckCompiler implements ICompiler<DeckArtifact> {
  /**
   * Discriminant for registry lookup.
   * Must match the 'deck' literal in the ArtifactType union from @brandos/contracts.
   */
  readonly artifactType = 'deck' as const

  /**
   * Compile raw input into a canonical DeckArtifact.
   *
   * @param raw     - LLM output string, DraftArtifactInput, or plain object.
   * @param options - Forwarded to compileDeckArtifact(). Only defined values forwarded.
   * @returns CompileResult & { artifact: DeckArtifact }
   *
   * EDGE CASES (handled by compileDeckArtifact in output-control-layer):
   *   - Missing title slide → OCL inserts a default title slide at position 0.
   *   - Slides with missing `type` field → OCL defaults to 'content' type.
   *   - Empty body array on a content slide → OCL allows (governance may reject later).
   */
  compile(
    raw: string | DraftArtifactInput | object,
    options?: CompileOptions & {
      requestId?: string
      topic?: string
      tone?: string
      provider?: string
    }
  ): CompileResult & { artifact: DeckArtifact } {
    const rawStr = typeof raw === 'string' ? raw : JSON.stringify(raw)

    // NOTE: tone is intentionally omitted — deck OCL does not support it yet.
    // Add `...(options?.tone !== undefined && { tone: options.tone })` when supported.
    const oclResult = compileDeckArtifact(rawStr, {
      topic: options?.topic ?? '',
      ...(options?.provider  !== undefined && { provider:  options.provider }),
      ...(options?.requestId !== undefined && { requestId: options.requestId }),
    })

    return {
      artifact:   oclResult.artifact,
      durationMs: oclResult.durationMs,
      inputType:  'json',
      slideCount: oclResult.artifact.slides.length,
    }
  }
}


