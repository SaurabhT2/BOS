// ============================================================
// packages/ai-runtime-layer/src/plugins/index.ts
//
// PLUGIN REGISTRY — Extension System for Lifecycle Hooks
//
// Provides two extension mechanisms:
//
//   1. ADAPTERS: Register custom IProviderAdapter implementations at runtime.
//      Useful for: testing (mock adapters), dynamic provider onboarding,
//      or custom local model integrations not covered by built-in adapters.
//
//   2. HOOKS: Register callbacks for lifecycle events.
//      Hook events and their call sites:
//        before_invoke  — RuntimeEngine.run(), before capability detection
//        after_invoke   — RuntimeEngine.run(), after ExecutionEngine.execute()
//        on_fallback    — ExecutionEngine.execute(), when switching providers
//        on_error       — ExecutionEngine.execute(), when a provider throws
//
// INVARIANT (I-9):
//   Hook failures MUST NOT propagate to the runtime.
//   All runHooks() calls are wrapped in try/catch that silently swallows errors.
//   A broken hook must never crash or delay a user-facing generation request.
//
// ADAPTER MERGING:
//   Adapters registered via PluginRegistry can be merged into the main
//   providers Map via mergeIntoProviderMap(). Typically called by factory
//   extensions or admin dynamic registration flows.
//   Plugin adapters take priority over factory-registered adapters on conflict.
// ============================================================

import {
  AIRuntimeOutput,
  HookContext,
  HookEvent,
  HookHandler,
  IPluginRegistry,
  IProviderAdapter,
  InvocationRequest,
  ProviderName,
} from '@brandos/contracts'

export class PluginRegistry implements IPluginRegistry {
  /** Custom provider adapters registered at runtime. */
  private adapters = new Map<string, IProviderAdapter>()

  /** Hook handlers per event. Each event can have multiple handlers. */
  private hooks: Record<HookEvent, HookHandler[]> = {
    before_invoke: [],
    after_invoke:  [],
    on_fallback:   [],
    on_error:      [],
  }

  /**
   * Register a custom provider adapter.
   *
   * The adapter must implement IProviderAdapter fully:
   *   - name: ProviderName
   *   - supportedModes: ExecutionMode[]
   *   - invoke(): Promise<ProviderInvokeResult>
   *   - healthCheck(): Promise<ProviderCapabilityStatus>
   *
   * Replaces any existing adapter with the same name.
   *
   * @param adapter - Custom adapter implementing IProviderAdapter.
   * @returns this (fluent API for chaining multiple registrations).
   * @throws Error when required adapter fields are missing.
   */
  registerAdapter(adapter: IProviderAdapter): this {
    if (!adapter.name || !adapter.invoke || !adapter.healthCheck) {
      throw new Error('Adapter missing required fields: name, invoke, healthCheck')
    }
    this.adapters.set(adapter.name, adapter)
    return this
  }

  /**
   * Register a hook handler for a lifecycle event.
   *
   * Multiple handlers can be registered for the same event.
   * Handlers are called in registration order.
   * Handler failures are silently swallowed (I-9 invariant).
   *
   * @param event   - The lifecycle event to hook.
   * @param handler - Callback function. May be sync or async.
   * @returns this (fluent API for chaining).
   * @throws Error when the event name is not a known HookEvent.
   */
  on(event: HookEvent, handler: HookHandler): this {
    if (!(event in this.hooks)) {
      throw new Error(
        `Unknown hook event: ${event}. Valid: ${Object.keys(this.hooks).join(', ')}`
      )
    }
    this.hooks[event].push(handler)
    return this
  }

  /**
   * Run all handlers for a lifecycle event.
   *
   * Handlers are awaited sequentially. Each handler's failure is caught
   * and silently swallowed — a broken hook never crashes the runtime.
   *
   * @param event   - The lifecycle event being fired.
   * @param context - Event-specific context payload.
   */
  async runHooks(event: HookEvent, context: HookContext): Promise<void> {
    for (const handler of this.hooks[event]) {
      try {
        await Promise.resolve(handler(context))
      } catch {
        // Silently swallow. Hook failures must never propagate (I-9).
      }
    }
  }

  /**
   * Look up a registered plugin adapter by name.
   *
   * @param name - Provider name string.
   * @returns The adapter, or undefined if not registered.
   */
  getAdapter(name: string): IProviderAdapter | undefined {
    return this.adapters.get(name)
  }

  /**
   * List all registered plugin adapter names.
   */
  listAdapters(): string[] {
    return [...this.adapters.keys()]
  }

  /**
   * Merge plugin adapters into an existing provider Map.
   *
   * Returns a new Map that includes all existing providers plus plugin
   * adapters. Plugin adapters win on conflict (same provider name).
   *
   * Typical call site: AIRuntimeFactory, after buildProviders().
   *
   * @param existing - The base provider Map from AIRuntimeFactory.
   * @returns A new Map with plugin adapters merged in.
   */
  mergeIntoProviderMap(
    existing: Map<ProviderName, IProviderAdapter>,
  ): Map<ProviderName, IProviderAdapter> {
    const merged = new Map(existing)
    for (const [name, adapter] of this.adapters) {
      merged.set(name as ProviderName, adapter)
    }
    return merged
  }
}


