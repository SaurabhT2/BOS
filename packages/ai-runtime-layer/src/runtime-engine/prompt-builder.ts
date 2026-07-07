// ============================================================
// packages/ai-runtime-layer/src/runtime-engine/prompt-builder.ts
//
// PROMPT BUILDER — System + User Prompt Assembly
//
// Translates an InvocationRequest into a BuiltPrompt that provider
// adapters can consume directly (system_prompt, user_prompt, json_mode).
//
// Stateless. Can be constructed once and reused across all requests.
//
// AUTHORITY RULE (P1-C convergence — MUST preserve):
//   Two distinct prompt assembly paths exist, and they must never mix:
//
//   PATH 1: request.context is present.
//     The orchestrator (control-plane-layer) has already compiled a full,
//     brand-aware system prompt via orchestrator.compilePrompt().
//     In this case, request.context IS the system prompt.
//     The PromptBuilder must NOT prepend the generic SYSTEM_PROMPTS fallback.
//     Only schema constraints are appended (to enforce output format).
//
//   PATH 2: request.context is absent.
//     No orchestrator system prompt. Use SYSTEM_PROMPTS generic fallback
//     for the task type. This covers: VLM analysis, raw API tool use,
//     test harnesses, direct RuntimeEngine callers.
//
//   WHY THIS MATTERS:
//     If PATH 1 and PATH 2 are merged (i.e. always prepend SYSTEM_PROMPTS),
//     brand-aware prompts from the orchestrator get contaminated by generic
//     text that conflicts with the brand voice. P1 ticket tracked this.
//
// JSON MODE:
//   json_mode is set to true when:
//     - output_schema.type is 'json' or 'array'
//     - task_type is 'json' or 'carousel'
//   Provider adapters read json_mode to activate native JSON mode
//   (OpenAI response_format: {type: 'json_object'}, Anthropic prefilling, etc.).
// ============================================================

import { BuiltPrompt, IPromptBuilder, InvocationRequest, InvocationType } from '@brandos/contracts'

// ─────────────────────────────────────────────────────────────
// SYSTEM_PROMPTS — Generic fallback system prompts
//
// Used ONLY in PATH 2 (no orchestrator context).
// These cover direct RuntimeEngine callers that don't pre-compile a prompt.
//
// DO NOT USE for brand-aware generation — that path always provides context.
//
// Guidelines for new entries:
//   - Concise. Providers have limited system prompt attention.
//   - Instructional. Tell the model what role to play and output format.
//   - No brand voice. These are generic technical prompts.
// ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPTS: Record<InvocationType, string> = {
  chat:
    'You are a helpful, concise AI assistant.',

  post:
    'You are a social media content writer. Write engaging, concise posts.',

  article:
    'You are a professional writer. Write well-structured, informative articles.',

  carousel:
    "You create structured carousel content. Return a JSON array of slides " +
    "with 'title' and 'body' fields.",

  analyze:
    'You are an analytical AI. Provide clear, structured analysis.',

  json:
    'You are a data extraction AI. Always respond with valid JSON only. No explanation.',

  image_analysis:
    'You analyze images and describe their content accurately and concisely.',

  code:
    'You are an expert software engineer. Write clean, well-commented code.',

  summarize:
    'You summarize content concisely while preserving key information.',

  classify:
    'You classify input into the requested categories. Respond with the classification only.',

  embed:
    'You generate semantic embeddings. Return the embedding vector.',

  generate_deck:
    'Create a structured presentation deck with clear slides, headlines, bullets, and flow.',

  generate_carousel:
    'Create a high-performing social media carousel with slide-by-slide structure.',

  generate_report:
    'Create a professional report with sections, executive summary, findings, and recommendations.',
}

export class PromptBuilder implements IPromptBuilder {

  /**
   * Build a provider-ready prompt from an InvocationRequest.
   *
   * Returns a BuiltPrompt with:
   *   system_prompt — assembled from context or SYSTEM_PROMPTS + schema constraints
   *   user_prompt   — the caller's user_intent (passed through unchanged)
   *   json_mode     — true when the provider should use native JSON mode
   *
   * @param request - The InvocationRequest from the caller.
   */
  build(request: InvocationRequest): BuiltPrompt {
    return {
      system_prompt: this.buildSystem(request),
      user_prompt:   request.user_intent,
      json_mode:     this.requiresJsonMode(request.task_type, request.output_schema?.type),
    }
  }

  /**
   * Assemble the system prompt.
   *
   * Implements the two-path authority rule. See file header for full explanation.
   *
   * PATH 1 (context present — orchestrator owns):
   *   - Use request.context as the system prompt directly.
   *   - Append schema constraints after (never before) the orchestrator prompt.
   *   - No SYSTEM_PROMPTS injection. The orchestrator's prompt is authoritative.
   *
   * PATH 2 (no context — PromptBuilder fallback):
   *   - Use SYSTEM_PROMPTS[task_type] as the base.
   *   - Append schema constraints.
   *
   * @param request - The InvocationRequest.
   * @returns Assembled system prompt string.
   */
  private buildSystem(request: InvocationRequest): string {
    if (request.context) {
      // PATH 1: Orchestrator-compiled prompt. Preserve it exactly.
      // Schema constraints follow to enforce output format expectations.
      const parts: string[] = [request.context]
      parts.push(...this.schemaConstraints(request))
      return parts.join('\n\n')
    }

    // PATH 2: Generic fallback. No orchestrator context.
    const base  = SYSTEM_PROMPTS[request.task_type] ?? 'You are a helpful AI assistant.'
    const parts: string[] = [base, ...this.schemaConstraints(request)]
    return parts.join('\n\n')
  }

  /**
   * Build schema constraint instructions for the system prompt.
   *
   * These are appended to the system prompt to reinforce the expected output format.
   * They complement (not replace) any format instructions in the orchestrator prompt.
   *
   * JSON/array output:
   *   - Explicit instruction to respond with JSON only (no markdown, no explanation).
   *   - Expected shape hint if output_schema.shape is provided.
   *
   * Token limit:
   *   - Approximate length guidance (token count is not exact due to tokenizer differences).
   *
   * @param request - The InvocationRequest with output_schema.
   * @returns Array of constraint strings. Empty if no schema is specified.
   */
  private schemaConstraints(request: InvocationRequest): string[] {
    const parts: string[] = []

    if (request.output_schema?.type === 'json' || request.output_schema?.type === 'array') {
      // Primary JSON instruction — also signals adapters via json_mode.
      parts.push('Always respond with valid JSON only. No markdown. No explanation.')

      // Shape hint helps the model produce the expected structure.
      // Provided when the orchestrator or caller knows the required keys.
      if (request.output_schema.shape) {
        parts.push(`Expected JSON shape: ${JSON.stringify(request.output_schema.shape)}`)
      }
    }

    if (request.output_schema?.max_tokens) {
      // Advisory — models respect this roughly, not exactly.
      parts.push(`Keep response under approximately ${request.output_schema.max_tokens} tokens.`)
    }

    return parts
  }

  /**
   * Determine whether this request requires native JSON mode in the provider.
   *
   * JSON mode activates provider-specific structured output features:
   *   OpenAI:    response_format: { type: 'json_object' }
   *   Anthropic: JSON prefilling + instruction reinforcement
   *   Google:    responseMimeType: 'application/json'
   *
   * Returns true when:
   *   - output_schema.type is 'json' or 'array' (explicit schema request)
   *   - task_type is 'json' (raw JSON extraction task)
   *   - task_type is 'carousel' (JSON slide array output)
   *
   * Note: generate_deck, generate_carousel, generate_report are handled by
   * AIRuntimeAdapter which forces output_schema.type='json'. By the time the
   * request reaches PromptBuilder, their schema type is already 'json'.
   *
   * @param taskType   - The InvocationType for this request.
   * @param schemaType - The output_schema.type if specified.
   * @returns true when the provider should use native JSON mode.
   */
  private requiresJsonMode(taskType: InvocationType, schemaType?: string): boolean {
    if (schemaType === 'json' || schemaType === 'array') return true
    if (taskType === 'json' || taskType === 'carousel') return true
    return false
  }
}


