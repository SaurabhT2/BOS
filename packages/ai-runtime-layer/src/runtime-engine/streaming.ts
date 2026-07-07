// ============================================================
// AIRuntime V2 — Streaming Engine
// Push-based async generator for token streaming.
// Works with OpenAI-compatible SSE streams.
// ============================================================

import { IStreamable, ProviderName } from "@brandos/contracts";

export class StreamBuffer implements IStreamable {
  private chunks: string[] = [];
  private _done = false;
  private _error: Error | null = null;
  private waiters: Array<(result: IteratorResult<string>) => void> = [];

  push(chunk: string): void {
    this.chunks.push(chunk);
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: chunk, done: false });
  }

  close(): void {
    this._done = true;
    for (const w of this.waiters) w({ value: undefined as unknown as string, done: true });
    this.waiters = [];
  }

  fail(err: Error): void {
    this._error = err;
    for (const w of this.waiters) w({ value: undefined as unknown as string, done: true });
    this.waiters = [];
  }

  get done(): boolean { return this._done; }

  collected(): string { return this.chunks.join(""); }

  [Symbol.asyncIterator](): AsyncIterator<string> {
    let i = 0;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      next(): Promise<IteratorResult<string>> {
        if (i < self.chunks.length)
        
         {const chunk = self.chunks[i++];

if (chunk === undefined) {
  return Promise.resolve({ value: "", done: true });
}

return Promise.resolve({
  value: chunk,
  done: false
});}



        if (self._done) return Promise.resolve({ value: undefined as unknown as string, done: true });
        if (self._error) return Promise.reject(self._error);
        return new Promise((resolve) => {
          self.waiters.push((result) => {
            if (!result.done) i++;
            resolve(result);
          });
        });
      },
    };
  }
}

/** Parse an OpenAI-compatible SSE stream, yield text deltas. */
export async function* parseSSEStream(response: Response): AsyncGenerator<string> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") return;
        try {
          const parsed = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string }; finish_reason?: string }>;
          };
          const text = parsed.choices?.[0]?.delta?.content ?? "";
          if (text) yield text;
        } catch {
          // malformed SSE line — skip
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** OpenAI-compatible streaming invocation. Returns an async-iterable StreamBuffer. */
export async function streamOpenAICompatible(
  baseUrl: string,
  apiKey: string,
  payload: {
    model: string;
    messages: Array<{ role: string; content: string }>;
    max_tokens?: number;
    temperature?: number;
  },
  timeoutMs: number
): Promise<StreamBuffer> {
  const buf = new StreamBuffer();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  (async () => {
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ ...payload, stream: true }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) { buf.fail(new Error(`Stream error ${res.status}`)); return; }
      for await (const chunk of parseSSEStream(res)) buf.push(chunk);
      buf.close();
    } catch (err) {
      clearTimeout(timer);
      buf.fail(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  return buf;
}


