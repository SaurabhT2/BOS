// ============================================================
// AIRuntime V2 — HTTP Gateway
// Exposes IAIRuntime + Orchestrator as a local HTTP API.
// Zero external dependencies (raw Node http module).
//
// Endpoints:
//   POST /v1/run          → InvocationRequest → AIRuntimeOutput
//   POST /v1/generate     → OrchestratorRequest → OrchestratorResponse  ← NEW
//   POST /v1/remix        → remix_deck shortcut                          ← NEW
//   GET  /v1/capabilities → CapabilityResult
//   GET  /v1/stats        → TelemetryStats
//   GET  /v1/health       → { status: "ok" }
// ============================================================

import * as http from "http";
import { randomUUID } from "crypto";
import { IAIRuntime, InvocationRequest } from "@brandos/contracts";

export interface GatewayConfig {
  runtime: IAIRuntime;
  /** Optional orchestrator — enables /v1/generate and /v1/remix */
  orchestrator?: {
    run(req: {
      intent: string;
      userPrompt: string;
      context?: string;
      exportFormat?: string;
      themePreset?: string;
      maxSlides?: number;
      existingArtifact?: unknown;
      metadata?: Record<string, unknown>;
    }): Promise<unknown>;
  };
  port?: number | undefined;
  host?: string | undefined;
  auth_token?: string | undefined;
  cors?: boolean | undefined;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer | string) => (body += chunk));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function json(res: http.ServerResponse, status: number, data: unknown, requestId?: string): void {
  const payload = requestId ? { request_id: requestId, ...Object(data) } : data;
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": String(Buffer.byteLength(body)),
    ...(requestId ? { "X-Request-Id": requestId } : {}),
  });
  res.end(body);
}

function apiError(res: http.ServerResponse, status: number, message: string, requestId?: string): void {
  json(res, status, { error: { status, message } }, requestId);
}

export class AIRuntimeGateway {
  private readonly server: http.Server;
  private readonly runtime: IAIRuntime;
  private readonly orchestrator: GatewayConfig["orchestrator"];
  private readonly authToken: string | undefined;
  private readonly corsEnabled: boolean;

  constructor(private readonly config: GatewayConfig) {
    this.runtime      = config.runtime;
    this.orchestrator = config.orchestrator;
    this.authToken    = config.auth_token;
    this.corsEnabled  = config.cors ?? true;
    this.server       = http.createServer(this.handleRequest.bind(this));
  }

  private checkAuth(req: http.IncomingMessage): boolean {
    if (!this.authToken) return true;
    return req.headers["authorization"] === `Bearer ${this.authToken}`;
  }

  private setCORS(res: http.ServerResponse): void {
    if (!this.corsEnabled) return;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-Id");
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    this.setCORS(res);

    // Per-request tracing ID: honour incoming header or generate one
    const requestId = (req.headers["x-request-id"] as string | undefined) ?? randomUUID();

    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
    if (!this.checkAuth(req)) { apiError(res, 401, "Unauthorized.", requestId); return; }

    const url  = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    try {
      // ── GET /v1/health ──────────────────────────────────────
      if (path === "/v1/health" && req.method === "GET") {
        json(res, 200, { status: "ok", timestamp: Date.now() }, requestId);
        return;
      }

      // ── GET /v1/stats ───────────────────────────────────────
      if (path === "/v1/stats" && req.method === "GET") {
        json(res, 200, this.runtime.stats(), requestId);
        return;
      }

      // ── GET /v1/capabilities ────────────────────────────────
      if (path === "/v1/capabilities" && req.method === "GET") {
        const force = url.searchParams.get("force") === "1";
        const cap   = await (force ? this.runtime.refreshCapabilities() : this.runtime.capabilities());
        json(res, 200, cap, requestId);
        return;
      }

      // ── POST /v1/run  (raw runtime — existing behaviour) ────
      if (path === "/v1/run" && req.method === "POST") {
        const body = await readBody(req);
        let request: InvocationRequest;
        try {
          request = JSON.parse(body) as InvocationRequest;
        } catch {
          apiError(res, 400, "Invalid JSON body.", requestId);
          return;
        }
        if (!request.task_type || !request.user_intent) {
          apiError(res, 422, "Missing required fields: task_type, user_intent", requestId);
          return;
        }
        const output = await this.runtime.run(request);
        json(res, output.status === "terminal_failure" ? 500 : 200, output, requestId);
        return;
      }

      // ── POST /v1/generate  (full orchestrator path) ─────────
      if (path === "/v1/generate" && req.method === "POST") {
        if (!this.orchestrator) {
          apiError(res, 501, "/v1/generate requires an orchestrator. Pass orchestrator: in GatewayConfig.", requestId);
          return;
        }
        const body = await readBody(req);
        let request: Record<string, unknown>;
        try {
          request = JSON.parse(body) as Record<string, unknown>;
        } catch {
          apiError(res, 400, "Invalid JSON body.", requestId);
          return;
        }
        if (!request.intent || !request.userPrompt) {
          apiError(res, 422, "Missing required fields: intent, userPrompt", requestId);
          return;
        }
       const result = await this.orchestrator.run({
  intent: request.intent as string,
  userPrompt: request.userPrompt as string,

  ...(request.context !== undefined && {
    context: request.context as string,
  }),

  ...(request.exportFormat !== undefined && {
    exportFormat: request.exportFormat as string,
  }),

  ...(request.themePreset !== undefined && {
    themePreset: request.themePreset as string,
  }),

  ...(request.maxSlides !== undefined && {
    maxSlides: request.maxSlides as number,
  }),

  existingArtifact: request.existingArtifact,

  metadata: {
    ...(request.metadata as Record<string, unknown> ?? {}),
    requestId,
  },
});
        const success = (result as { success?: boolean }).success ?? true;
        json(res, success ? 200 : 500, result, requestId);
        return;
      }

      // ── POST /v1/remix  (shortcut for remix_deck intent) ────
      if (path === "/v1/remix" && req.method === "POST") {
        if (!this.orchestrator) {
          apiError(res, 501, "/v1/remix requires an orchestrator.", requestId);
          return;
        }
        const body = await readBody(req);
        let request: Record<string, unknown>;
        try {
          request = JSON.parse(body) as Record<string, unknown>;
        } catch {
          apiError(res, 400, "Invalid JSON body.", requestId);
          return;
        }
        if (!request.instruction || !request.artifact) {
          apiError(res, 422, "Missing required fields: instruction, artifact", requestId);
          return;
        }
        const result = await this.orchestrator.run({
  intent: "remix_deck",
  userPrompt: request.instruction as string,
  existingArtifact: request.artifact,

  ...(request.exportFormat !== undefined && {
    exportFormat: request.exportFormat as string,
  }),

  metadata: { requestId },
});
        const success = (result as { success?: boolean }).success ?? true;
        json(res, success ? 200 : 500, result, requestId);
        return;
      }

      apiError(res, 404, `Route not found: ${req.method} ${path}`, requestId);
    } catch (err) {
      apiError(res, 500, `Internal server error: ${(err as Error).message}`, requestId);
    }
  }

  start(): Promise<void> {
    const port = this.config.port ?? 8080;
    const host = this.config.host ?? "127.0.0.1";
    return new Promise((resolve) => {
      this.server.listen(port, host, () => {
        console.info(`[AIRuntime Gateway] http://${host}:${port}`);
        console.info(`[AIRuntime Gateway] Routes:`);
        console.info(`  POST /v1/run          raw AIRuntime`);
        console.info(`  POST /v1/generate     full orchestrator pipeline`);
        console.info(`  POST /v1/remix        remix existing artifact`);
        console.info(`  GET  /v1/capabilities`);
        console.info(`  GET  /v1/stats`);
        console.info(`  GET  /v1/health`);
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err?: Error) => (err ? reject(err) : resolve()));
    });
  }
}


