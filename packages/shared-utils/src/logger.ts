// ============================================================
// @brandos/shared-utils — logger.ts
//
// PURPOSE:
//   Structured, levelled logger for the entire BrandOS monorepo.
//   Zero external dependencies — safe in any Node.js environment
//   including Next.js edge runtime, Supabase functions, and CLI tools.
//
// ARCHITECTURE:
//   Logger is a class (not a singleton) so each layer can instantiate
//   its own copy with the appropriate log level. Dependency injection
//   is mandatory — never import a shared Logger instance.
//
//   Child loggers (via Logger.child(tag)) prepend "[tag]" to every
//   message and inherit the parent's log level. The level cannot be
//   changed on a child logger.
//
// OUTPUT FORMAT:
//   [AIRuntime][LEVEL] [optional-tag] message {optional JSON data}
//
// LEVEL HIERARCHY (lowest → highest verbosity):
//   silent(0) < error(1) < warn(2) < info(3) < debug(4)
//   A logger at level N suppresses all messages ranked < N.
//
// INVARIANTS:
//   - No Supabase, Next.js, or Express imports — ever.
//   - No singleton exports — callers must instantiate.
//   - The `child()` return type is ILogger (via TaggedLogger).
// ============================================================

import type { ILogger, LogLevel } from "./ISharedUtils";

/**
 * Numeric rank for each log level.
 * Used to filter messages below the configured threshold.
 */
const LEVEL_RANK: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

/**
 * Logger — structured levelled logger.
 *
 * Instantiate once per layer/component:
 *   const log = new Logger('info');
 *
 * For component-scoped output:
 *   const routerLog = log.child('Router');
 *   routerLog.info('Selected provider', { provider: 'anthropic' });
 *   // → [AIRuntime][INFO] [Router] Selected provider {"provider":"anthropic"}
 *
 * In production, set level to 'warn' or 'error' to suppress noise.
 * In tests, set level to 'silent' to suppress all output.
 */
export class Logger implements ILogger {
  /**
   * Numeric rank of the configured log level.
   * Messages with a rank BELOW this are suppressed.
   */
  private readonly rank: number;

  /**
   * @param level - Minimum level to emit. Default: 'info'.
   *   'silent' suppresses all output (useful in tests).
   *   'debug'  emits everything including verbose traces.
   */
  constructor(private readonly level: LogLevel = "info") {
    this.rank = LEVEL_RANK[level];
  }

  /**
   * Log at ERROR level.
   * Use for: unrecoverable failures, exceptions that abort a request,
   * missing required configuration at startup.
   *
   * NEVER swallow an error without at least calling log.error() first.
   */
  error(message: string, data?: unknown): void {
    // Rank 1 — emit when level >= error (i.e., not silent)
    if (this.rank >= 1) this.emit("ERROR", message, data);
  }

  /**
   * Log at WARN level.
   * Use for: retryable failures, degraded-mode operation, approaching
   * budget limits, deprecated code paths still being exercised.
   */
  warn(message: string, data?: unknown): void {
    // Rank 2 — emit when level >= warn
    if (this.rank >= 2) this.emit("WARN", message, data);
  }

  /**
   * Log at INFO level.
   * Use for: request lifecycle milestones, provider selection decisions,
   * successful generation completions, capability check results.
   *
   * Default level for production — keep INFO messages concise.
   */
  info(message: string, data?: unknown): void {
    // Rank 3 — emit when level >= info (default threshold)
    if (this.rank >= 3) this.emit("INFO", message, data);
  }

  /**
   * Log at DEBUG level.
   * Use for: verbose tracing, intermediate state dumps, prompt content,
   * token counts, backoff timings. Never enable in production.
   */
  debug(message: string, data?: unknown): void {
    // Rank 4 — emit only when level === 'debug' (opt-in verbosity)
    if (this.rank >= 4) this.emit("DEBUG", message, data);
  }

  /**
   * Create a child logger that prepends [tag] to every message.
   *
   * The tag should identify the component or sub-system:
   *   log.child('CircuitBreaker')
   *   log.child('RetryEngine')
   *   log.child('CostTracker')
   *
   * Child loggers inherit the parent's level and cannot change it.
   * Nesting is allowed but discouraged — prefer flat tags.
   */
  child(tag: string): Logger {
    return new TaggedLogger(this.level, tag);
  }

  /**
   * Internal emit — formats and writes to stdout.
   *
   * Format: [AIRuntime][LEVEL] message {data}
   *   - Objects are JSON-serialised for structured log parsers.
   *   - Primitives are appended as-is.
   *   - `undefined` data is omitted entirely.
   *
   * All log levels write to console.log (not console.error) so that
   * log consumers (e.g. structured logging pipelines) can handle
   * level filtering themselves via the embedded level token.
   */
  protected emit(level: string, message: string, data?: unknown): void {
    const line = `[AIRuntime][${level}] ${message}`;
    if (data !== undefined) {
      // JSON.stringify objects for structured parsing; pass primitives raw
      console.log(line, typeof data === "object" ? JSON.stringify(data) : data);
    } else {
      console.log(line);
    }
  }
}

/**
 * TaggedLogger — child logger implementation.
 *
 * Created via Logger.child(tag). Prefixes every message with [tag]
 * before delegating to the parent class emit path.
 *
 * NOT exported directly — callers always get an ILogger interface
 * from Logger.child(), keeping the TaggedLogger class internal.
 */
class TaggedLogger extends Logger {
  /**
   * @param level - Inherited from the parent Logger.
   * @param tag   - Component name to prefix on every message.
   */
  constructor(level: LogLevel, private readonly tag: string) {
    super(level);
  }

  // Shadow each public method to inject the tag prefix.
  // We cannot override the private `emit()` so we intercept here.

  error(message: string, data?: unknown): void {
    super.error(`[${this.tag}] ${message}`, data);
  }

  warn(message: string, data?: unknown): void {
    super.warn(`[${this.tag}] ${message}`, data);
  }

  info(message: string, data?: unknown): void {
    super.info(`[${this.tag}] ${message}`, data);
  }

  debug(message: string, data?: unknown): void {
    super.debug(`[${this.tag}] ${message}`, data);
  }
}

/**
 * generateRequestId — lightweight unique request identifier.
 *
 * Format: `req_{timestamp_base36}_{random_5chars}`
 *   e.g.  `req_lz8k3a_xf7r2`
 *
 * Collision probability is negligible for monorepo-scale request
 * volumes (< 1M/second). Use this instead of uuid to avoid an
 * external dependency.
 *
 * EDGE CASE: `Date.now()` has millisecond resolution. Two calls in
 * the same millisecond will produce different IDs due to the random
 * suffix, but the timestamp prefix will be identical. This is
 * acceptable for request tracing — it is NOT a cryptographic ID.
 */
export function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}


