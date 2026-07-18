/**
 * @brandos/cognition-client — src/global-workspace-configuration-client.ts
 *
 * Cognitive Platform Evolution Program, EM-1.2. Process-scoped singleton
 * for WorkspaceConfigurationClient. Same defense-in-depth pattern as
 * global-knowledge-client.ts (globalThis store, survives webpack chunk
 * splits in Next.js) — deliberately mirrored rather than merged into that
 * file, since the two clients are independent write endpoints for
 * different ingestion concerns.
 */

import {
  WorkspaceConfigurationClient,
  type WorkspaceConfigurationClientConfig,
} from './WorkspaceConfigurationClient'

declare global {
  // eslint-disable-next-line no-var
  var __BRANDOS_WORKSPACE_CONFIGURATION_CLIENT__: WorkspaceConfigurationClient | null | undefined
}

function _get(): WorkspaceConfigurationClient | null {
  return globalThis.__BRANDOS_WORKSPACE_CONFIGURATION_CLIENT__ ?? null
}

function _set(client: WorkspaceConfigurationClient): void {
  globalThis.__BRANDOS_WORKSPACE_CONFIGURATION_CLIENT__ = client
}

export function initWorkspaceConfigurationClient(config: WorkspaceConfigurationClientConfig): void {
  if (_get()) {
    console.warn(
      '[cognition-client] initWorkspaceConfigurationClient called more than once — ignoring',
    )
    return
  }
  _set(new WorkspaceConfigurationClient(config))
  console.info('[cognition-client] Workspace configuration client initialized')
}

/**
 * Returns null instead of throwing when not configured, same reasoning as
 * getGlobalKnowledgeIngestClient(): a workspace running without
 * INTELLIGENCE_OS_API_URL configured should degrade to "persona writes
 * stay local," not fail persona edits outright.
 */
export function getGlobalWorkspaceConfigurationClient(): WorkspaceConfigurationClient | null {
  return _get()
}

/** Only for tests. Never call in production. */
export function _resetGlobalWorkspaceConfigurationClientForTests(): void {
  globalThis.__BRANDOS_WORKSPACE_CONFIGURATION_CLIENT__ = null
}
