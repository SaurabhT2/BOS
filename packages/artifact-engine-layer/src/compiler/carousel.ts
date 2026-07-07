/**
 * @brandos/artifact-engine-layer — compiler/carousel.ts
 *
 * CarouselCompiler — ICompiler<CarouselArtifact> implementation.
 *
 * WHAT IT DOES:
 *   Adapts compileCarouselArtifact() from @brandos/output-control-layer into
 *   the ICompiler<CarouselArtifact> interface that ArtifactEngine.compile() expects.
 *
 * ARCHITECTURE NOTE — Why this adapter exists:
 *   output-control-layer exports compileCarouselArtifact() as a standalone function.
 *   ArtifactEngine dispatches via the ICompiler interface (class-based, registry-lookup).
 *   This adapter bridges the two without changing either package's public API.
 *   Carousel is the FIRST registered artifact type — it is NOT a special case.
 *
 * DETERMINISM:
 *   compile() is pure. Same input + options always produces the same CarouselArtifact.
 *   No LLM calls. No I/O. No side effects. Thread-safe.
 *
 * INPUT HANDLING:
 *   - raw is string: passed directly to compileCarouselArtifact().
 *   - raw is DraftArtifactInput or object: serialized to JSON string first.
 *     This serialization is safe because compileCarouselArtifact() expects a JSON string.
 *
 * OPTIONS FORWARDING:
 *   Only defined options are forwarded (no undefined keys in the options object).
 *   This prevents compileCarouselArtifact() from receiving `{ provider: undefined }`
 *   when provider is absent — which could cause unexpected behavior downstream.
 *
 * RETURN:
 *   CompileResult & { artifact: CarouselArtifact }
 *   - artifact: the fully normalized, $schema-stamped CarouselArtifact.
 *   - durationMs: wall-clock time of the OCL compile step.
 *   - inputType: always 'json' (carousel OCL parses JSON).
 *   - slideCount: number of slides compiled (for telemetry and logging).
 *
 * REGISTRATION:
 *   Called from bootstrap.ts: globalArtifactRegistry.registerCompiler(new CarouselCompiler())
 *   Only ONE CarouselCompiler instance is registered per ArtifactRegistry.
 */

import { compileCarouselArtifact } from '@brandos/output-control-layer'
import type {
  CarouselArtifact,
  CompileOptions,
  CompileResult,
  DraftArtifactInput,
} from '@brandos/contracts'
import type { ICompiler } from '../interfaces'

export class CarouselCompiler implements ICompiler<CarouselArtifact> {
  /**
   * Discriminant for registry lookup.
   * Must match the 'carousel' literal in the ArtifactType union from @brandos/contracts.
   */
  readonly artifactType = 'carousel' as const

  /**
   * Compile raw input into a canonical CarouselArtifact.
   *
   * @param raw     - LLM output string, DraftArtifactInput, or plain object.
   *                  Non-string inputs are JSON.stringify'd before OCL processing.
   * @param options - Forwarded to compileCarouselArtifact(). Only defined values forwarded.
   * @returns CompileResult & { artifact: CarouselArtifact }
   *
   * EDGE CASES (handled by compileCarouselArtifact in output-control-layer):
   *   - raw string is not valid JSON → OCL throws a descriptive parse error.
   *   - raw has wrong artifact_type → OCL normalizes to 'carousel' by schema stamp.
   *   - raw has no slides → OCL applies safe defaults (minimum slide count).
   *   - raw has too many slides → OCL caps to maximum slide count (per governance rules).
   */
  compile(
    raw: string | DraftArtifactInput | object,
    options?: CompileOptions & {
      requestId?: string
      topic?: string
      tone?: string
      provider?: string
    }
  ): CompileResult & { artifact: CarouselArtifact } {
    // Normalize to string: compileCarouselArtifact() accepts JSON strings only.
    // Object inputs (DraftArtifactInput, plain object) are serialized first.
    const rawStr = typeof raw === 'string' ? raw : JSON.stringify(raw)

    // Build the options object with only defined values to avoid passing
    // `{ tone: undefined }` into OCL (which could override internal defaults).
    const compileOptions: {
      topic: string
      tone?: string
      provider?: string
      requestId?: string
    } = {
      topic: options?.topic ?? '',
      ...(options?.tone      !== undefined && { tone:      options.tone }),
      ...(options?.provider  !== undefined && { provider:  options.provider }),
      ...(options?.requestId !== undefined && { requestId: options.requestId }),
    }

    const oclResult = compileCarouselArtifact(rawStr, compileOptions)

    return {
      artifact:   oclResult.artifact,
      durationMs: oclResult.durationMs,
      inputType:  'json',
      // slideCount is a CarouselArtifact-specific field; included for telemetry.
      // This is added to CompileResult by this adapter (not part of the core CompileResult type).
      slideCount: oclResult.artifact.slides.length,
    }
  }
}


