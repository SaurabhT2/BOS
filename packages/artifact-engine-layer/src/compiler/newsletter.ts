/**
 * @brandos/artifact-engine-layer — compiler/newsletter.ts
 *
 * NewsletterCompiler — ICompiler<NewsletterArtifact> implementation.
 *
 * Adapts compileNewsletterArtifact() from @brandos/output-control-layer into
 * the ICompiler<NewsletterArtifact> interface that ArtifactEngine.compile() expects.
 *
 * REGISTRATION:
 *   Called from bootstrap.ts: globalArtifactRegistry.registerCompiler(new NewsletterCompiler())
 */

import { compileNewsletterArtifact } from '@brandos/output-control-layer'
import type {
  NewsletterArtifact,
  CompileOptions,
  CompileResult,
  DraftArtifactInput,
} from '@brandos/contracts'
import type { ICompiler } from '../interfaces'

export class NewsletterCompiler implements ICompiler<NewsletterArtifact> {
  /** Discriminant for registry lookup. */
  readonly artifactType = 'newsletter' as const

  compile(
    raw: string | DraftArtifactInput | object,
    options?: CompileOptions & {
      requestId?: string
      topic?:     string
      tone?:      string
      provider?:  string
    }
  ): CompileResult & { artifact: NewsletterArtifact } {
    const rawStr = typeof raw === 'string' ? raw : JSON.stringify(raw)

    const oclResult = compileNewsletterArtifact(rawStr, {
      topic:     options?.topic     ?? '',
      tone:      options?.tone,
      provider:  options?.provider,
      requestId: options?.requestId,
    })

    // SPRINT1-FIX (F-06): Warn when extractJSON() failed and the compiler
    // silently constructed a placeholder artifact from raw text. The artifact
    // passes governance (governance thresholds apply to richness metrics, not
    // parse provenance), so without this warning the fallback is completely
    // invisible in logs. Users may receive filler newsletter content.
    //
    // Note: the tracker specifies logging in runNewsletterPipeline() (CPL), but
    // the OCLNewsletterCompileResult.parsedFromJson flag is only accessible in
    // this AEL adapter — it is not propagated through CompileResult (a contracts-
    // layer interface). Logging here achieves the same observability intent with
    // no cross-layer contract change. Implementation deviation documented.
    if (!oclResult.parsedFromJson) {
      console.warn(
        `[NewsletterCompiler][${options?.requestId ?? 'unknown'}] ` +
        `extractJSON() failed on LLM output — artifact compiled from raw text fallback. ` +
        `Newsletter content may be placeholder. Topic: "${options?.topic ?? '(none)'}" ` +
        `inputLength=${rawStr.length}`
      )
    }

    return {
      artifact:   oclResult.artifact,
      durationMs: oclResult.durationMs,
      inputType:  'json',
      // For newsletters, slideCount holds section count (naming legacy — telemetry only).
      slideCount: oclResult.artifact.sections.length,
    }
  }
}
