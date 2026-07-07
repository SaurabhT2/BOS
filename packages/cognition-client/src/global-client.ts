/**
 * @brandos/cognition-client — src/global-client.ts
 *
 * Process-scoped singleton for the CognitionProvider client. Mirrors the
 * defense-in-depth pattern @brandos/brand-intelligence used for its
 * runtime singleton (globalThis store, survives webpack chunk splits in
 * Next.js), so callers migrating off getGlobalBrandIntelligenceRuntime()
 * have a drop-in equivalent.
 *
 * SINGLETON ISOLATION DEFENSE
 * Both layers are active:
 *   1. PRIMARY — next.config.js: All @brandos/* packages in transpilePackages.
 *   2. DEFENSE-IN-DEPTH — globalThis.__BRANDOS_COGNITION_CLIENT__ store.
 */

import type { CognitionProvider } from '@platform/cognition-contract'
import { HttpCognitionProvider, type HttpCognitionProviderConfig } from './HttpCognitionProvider'

declare global {
  // eslint-disable-next-line no-var
  var __BRANDOS_COGNITION_CLIENT__: CognitionProvider | null | undefined
}

function _get(): CognitionProvider | null {
  return globalThis.__BRANDOS_COGNITION_CLIENT__ ?? null
}

function _set(client: CognitionProvider): void {
  globalThis.__BRANDOS_COGNITION_CLIENT__ = client
}

function _clear(): void {
  globalThis.__BRANDOS_COGNITION_CLIENT__ = null
}

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Register any CognitionProvider implementation as the process-wide
 * singleton — the general primitive both initCognitionClient() (real
 * HttpCognitionProvider) and degraded-mode bootstrap (DegradedCognitionProvider,
 * see ../DegradedCognitionProvider.ts) call. Exists separately from
 * initCognitionClient() so callers that already hold a constructed
 * CognitionProvider (of *any* kind) have a way to register it without that
 * function's HttpCognitionProviderConfig-shaped signature forcing them to
 * go through HttpCognitionProvider specifically.
 */
export function setGlobalCognitionClient(client: CognitionProvider): void {
  if (_get()) {
    console.warn('[cognition-client] setGlobalCognitionClient called more than once — ignoring')
    return
  }
  _set(client)
}

export function initCognitionClient(config: HttpCognitionProviderConfig): void {
  if (_get()) {
    console.warn('[cognition-client] initCognitionClient called more than once — ignoring')
    return
  }
  setGlobalCognitionClient(new HttpCognitionProvider(config))
  console.info('[cognition-client] Client initialized')
}

export function getGlobalCognitionClient(): CognitionProvider {
  const client = _get()
  if (!client) {
    throw new Error(
      '[cognition-client] Client not initialized. ' +
      'Call initCognitionClient() at application startup.'
    )
  }
  return client
}

/** Only for tests. Never call in production. */
export function _resetGlobalCognitionClientForTests(): void {
  _clear()
}
