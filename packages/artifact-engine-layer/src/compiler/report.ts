/**
 * @brandos/artifact-engine-layer — compiler/report.ts
 *
 * ReportCompiler — ICompiler<ReportArtifact> implementation.
 *
 * WHAT IT DOES:
 *   Adapts compileReportArtifact() from @brandos/output-control-layer into
 *   the ICompiler<ReportArtifact> interface that ArtifactEngine.compile() expects.
 *
 * ARCHITECTURE NOTE:
 *   Mirror of CarouselCompiler and DeckCompiler adapter patterns.
 *   Report compilation is deterministic and pure. No LLM calls. No I/O.
 *
 * SLIDECOUNT FIELD SEMANTICS:
 *   For reports, CompileResult.slideCount holds the section count, not slide count.
 *   This is a naming legacy from carousel being the first artifact type.
 *   The field is used for telemetry logging only — no business logic depends on it.
 *
 * REGISTRATION:
 *   Called from bootstrap.ts: globalArtifactRegistry.registerCompiler(new ReportCompiler())
 */

import { compileReportArtifact } from '@brandos/output-control-layer'
import type {
  ReportArtifact,
  CompileOptions,
  CompileResult,
  DraftArtifactInput,
} from '@brandos/contracts'
import type { ICompiler } from '../interfaces'

export class ReportCompiler implements ICompiler<ReportArtifact> {
  /**
   * Discriminant for registry lookup.
   * Must match the 'report' literal in the ArtifactType union from @brandos/contracts.
   */
  readonly artifactType = 'report' as const

  /**
   * Compile raw input into a canonical ReportArtifact.
   *
   * @param raw     - LLM output string, DraftArtifactInput, or plain object.
   * @param options - Forwarded to compileReportArtifact(). Only defined values forwarded.
   * @returns CompileResult & { artifact: ReportArtifact }
   *          NOTE: slideCount = section count for reports (naming legacy; telemetry only).
   *
   * EDGE CASES (handled by compileReportArtifact in output-control-layer):
   *   - Sections with duplicate `id` fields → OCL deduplicates by appending suffix.
   *   - Missing section `heading` → OCL applies 'Untitled Section' default.
   *   - Empty sections array → OCL allows (governance may reject later).
   */
  compile(
    raw: string | DraftArtifactInput | object,
    options?: CompileOptions & {
      requestId?: string
      topic?: string
      tone?: string
      provider?: string
    }
  ): CompileResult & { artifact: ReportArtifact } {
    const rawStr = typeof raw === 'string' ? raw : JSON.stringify(raw)

    const oclResult = compileReportArtifact(rawStr, {
      topic: options?.topic ?? '',
      ...(options?.provider  !== undefined && { provider:  options.provider }),
      ...(options?.requestId !== undefined && { requestId: options.requestId }),
    })

    return {
      artifact:   oclResult.artifact,
      durationMs: oclResult.durationMs,
      inputType:  'json',
      // For reports, slideCount holds section count (naming legacy — telemetry only).
      slideCount: oclResult.artifact.sections.length,
    }
  }
}


