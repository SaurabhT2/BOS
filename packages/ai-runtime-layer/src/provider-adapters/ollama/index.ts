// ============================================================
// AIRuntime V2 — Ollama Local Adapter (P1 FIX)
//
// P1 FIX: Ollama supports the /api/chat endpoint with role-based
// message arrays. The original adapter string-concatenated prompts
// into /api/generate which degrades output quality for chat models.
//
// This adapter now uses /api/chat (chat completions format) which
// is the correct API for instruction-tuned models like llama3.
// Falls back to /api/generate only for non-chat models.
// ============================================================

import {
  ExecutionMode,
  IProviderAdapter,
  ProviderCapabilityStatus,
  ProviderInvokeRequest,
  ProviderInvokeResult,
  ProviderName,
} from "@brandos/contracts";

export interface OllamaAdapterConfig {
  base_url?: string | undefined;
  default_model?: string | undefined;
  /** Force /api/generate instead of /api/chat. Default: false (use chat). */
  use_generate_api?: boolean;
}

export class OllamaAdapter implements IProviderAdapter {
  readonly name: ProviderName = "ollama";
  readonly supportedModes: ExecutionMode[] = ["local", "auto"];

  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly useGenerateApi: boolean;

  constructor(config: OllamaAdapterConfig = {}) {
    this.baseUrl = config.base_url ?? "http://localhost:11434";
    this.defaultModel = config.default_model ?? "llama3";
    this.useGenerateApi = config.use_generate_api ?? false;
  }

  async healthCheck(timeout_ms: number): Promise<ProviderCapabilityStatus> {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout_ms);

      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));

      return {
        available: res.ok,
        healthy: res.ok,
        latency_ms: Date.now() - start,
        checked_at: Date.now(),
        reason: res.ok ? undefined : `HTTP ${res.status}`,
      };
    } catch (err) {
      return {
        available: false,
        healthy: false,
        reason: `Ollama not reachable: ${(err as Error).message}`,
        checked_at: Date.now(),
      };
    }
  }

  async invoke(request: ProviderInvokeRequest): Promise<ProviderInvokeResult> {
    return this.useGenerateApi
      ? this.invokeGenerate(request)
      : this.invokeChat(request);
  }

  /**
   * /api/chat — correct format for instruction-tuned models.
   * Uses proper role-based message array: system + user.
   * This is the primary invocation path (P1 fix).
   *
   * STREAM FIX: uses stream:true so Ollama sends NDJSON chunks as tokens
   * are generated. This prevents the silent-hang timeout that occurs with
   * stream:false (Ollama holds the connection open until inference completes,
   * making AbortController fire without any data flowing). With streaming,
   * bytes flow continuously and the connection stays alive during long inference.
   *
   * P3 — VISION: Ollama vision format adds an "images" array alongside the
   * text content field. Only populated when request.attachments is non-empty.
   * Vision works with llava, bakllava, and other multimodal Ollama models.
   * Text-only models ignore the images array gracefully (no error, text response).
   */
  private async invokeChat(request: ProviderInvokeRequest): Promise<ProviderInvokeResult> {
    const start = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeout_ms);

    // Build role-based message array — not string concatenation
    const messages: Array<{ role: string; content: string; images?: string[] }> = []
    if (request.system_prompt) {
      messages.push({ role: "system", content: request.system_prompt });
    }

    // P3 — Multimodal: Ollama vision format uses an "images" array on the user message.
    // The images field accepts raw base64 strings (no data URI prefix).
    // Vision-capable models (llava, bakllava, moondream) process these alongside the text.
    // Text-only models silently ignore the images array.
    const userMessage: { role: string; content: string; images?: string[] } = {
      role: "user",
      content: request.user_prompt,
    }
    if (request.attachments && request.attachments.length > 0) {
      userMessage.images = request.attachments.map((att) => att.data)
    }
    messages.push(userMessage)

    if (request.json_mode) {
      const last = messages[messages.length - 1]
      if (!last) throw new Error('OllamaAdapter requires at least one message')
      last.content = last.content + '\n\nRespond ONLY with valid JSON. No markdown fences. No explanation.'
    }

    const model = request.model ?? this.defaultModel
    console.info('[OllamaAdapter] invokeChat', { model, timeout_ms: request.timeout_ms, json_mode: request.json_mode })

    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages,
          stream: true,   // ← stream to keep connection alive during long inference
          options: {
            num_predict: request.max_tokens ?? 2048,
            temperature: request.temperature ?? 0.7,
          },
          ...(request.json_mode ? { format: "json" } : {}),
        }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        if (res.status === 404) {
          console.warn("[OllamaAdapter] /api/chat not found — falling back to /api/generate");
          return this.invokeGenerate(request);
        }
        throw new Error(`Ollama chat error ${res.status}: ${errText}`);
      }

      // Accumulate NDJSON stream — each line is a JSON chunk from Ollama
      const reader = res.body?.getReader()
      if (!reader) throw new Error('OllamaAdapter: response body is null')

      const decoder = new TextDecoder()
      let accumulated = ''
      let promptTokens = 0
      let completionTokens = 0
      let done = false

      while (true) {
        const { value, done: streamDone } = await reader.read()
        if (streamDone) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n').filter(l => l.trim())

        for (const line of lines) {
          try {
            const parsed = JSON.parse(line) as {
              message?: { content: string }
              done: boolean
              eval_count?: number
              prompt_eval_count?: number
            }
            if (parsed.message?.content) {
              accumulated += parsed.message.content
            }
            if (parsed.done) {
              done = true
              promptTokens = parsed.prompt_eval_count ?? 0
              completionTokens = parsed.eval_count ?? 0
            }
          } catch {
            // incomplete JSON line — skip
          }
        }
      }

      console.info('[OllamaAdapter] stream complete', { chars: accumulated.length, tokens: completionTokens, latency_ms: Date.now() - start })

      return {
        content: accumulated,
        finish_reason: done ? "stop" : "length",
        ...(completionTokens > 0 && {
          token_usage: { prompt: promptTokens, completion: completionTokens },
        }),
        latency_ms: Date.now() - start,
        model_used: request.model ?? this.defaultModel,
        raw: { accumulated_length: accumulated.length },
      };
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        return { content: "", finish_reason: "timeout", latency_ms: Date.now() - start };
      }
      throw err;
    }
  }

  /**
   * /api/generate — legacy path for non-chat models.
   * Retained as fallback. Uses structured prompt, not raw string concat.
   */
  private async invokeGenerate(request: ProviderInvokeRequest): Promise<ProviderInvokeResult> {
    const start = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeout_ms);

    // Structured prompt: system block + user block — not "System: " + string concat
    const promptParts: string[] = [];
    if (request.system_prompt) {
      promptParts.push(`<system>\n${request.system_prompt}\n</system>`);
    }
    promptParts.push(`<user>\n${request.user_prompt}\n</user>`);
    if (request.json_mode) {
      promptParts.push("<assistant>\nRespond ONLY with valid JSON:");
    }
    const prompt = promptParts.join("\n\n");

    try {
      const res = await fetch(`${this.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: request.model ?? this.defaultModel,
          prompt,
          stream: false,
          options: {
            num_predict: request.max_tokens ?? 2048,
            temperature: request.temperature ?? 0.7,
          },
        }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));

      if (!res.ok) throw new Error(`Ollama generate error ${res.status}: ${await res.text()}`);

      const data = await res.json() as {
        response: string;
        done: boolean;
        eval_count?: number;
        prompt_eval_count?: number;
      };

      return {
        content: data.response,
        finish_reason: data.done ? "stop" : "length",

        ...(data.eval_count !== undefined && {
          token_usage: {
            prompt: data.prompt_eval_count ?? 0,
            completion: data.eval_count,
          },
        }),

        latency_ms: Date.now() - start,
        model_used: request.model ?? this.defaultModel,
        raw: data,
      };
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        return { content: "", finish_reason: "timeout", latency_ms: Date.now() - start };
      }
      throw err;
    }
  }

  // ─── Phase 2: Capability contract ────────────────────────────────────────────

  // P3 FIX: Added "vision.analysis" — Ollama supports vision with llava-family models
  // (llava, bakllava, moondream, llava-phi3). Text-only models ignore the images field
  // gracefully, so declaring vision.analysis here is correct: the adapter handles it,
  // and the model's own capability determines whether a useful response is returned.
  readonly capabilities: readonly string[] = ["text.generation", "text.structured", "vision.analysis"];

  describeCapability(id: string): import("@brandos/contracts").CapabilityDescriptor | null {
    if (!(this.capabilities as readonly string[]).includes(id)) return null;
    return {
      id: id as import("@brandos/contracts").CapabilityId,
      version: "1.0.0",
      provider: this.name,
      model_id: this.defaultModel,
      health_score: 70,
      latency_p50_ms: 8000,
      cost_per_1k_tokens: 0.0,
      supports_streaming: false,
      max_context_tokens: 4096,
    };
  }
}


