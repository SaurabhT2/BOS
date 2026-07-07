/**
 * @brandos/control-plane-layer — src/init.ts
 *
 * PLATFORM SPLIT: this module previously constructed a
 * SupabaseBrandSignalRepository and initialized @brandos/brand-intelligence's
 * runtime in-process. IntelligenceOS now owns all of its own persistence —
 * CPL's only job is to configure the HTTP client that talks to it.
 *
 * There is no Supabase client or brand-memory config here anymore: nothing
 * in BrandOS reads or writes brand-memory storage directly.
 */

import { initCognitionClient } from '@brandos/cognition-client'
import { Logger } from '@brandos/shared-utils'
import { CPLOrchestrator } from './orchestrator'

const logger = new Logger('info')

export interface CPLInitOptions {
  /** Base URL of the IntelligenceOS API. */
  readonly intelligenceOsApiUrl: string
  /** Service-to-service API key for authenticating to IntelligenceOS. */
  readonly intelligenceOsApiKey: string
}

export interface CPLBootstrap {
  readonly orchestrator: CPLOrchestrator
}

export function initCPL(options: CPLInitOptions): CPLBootstrap {
  logger.info('[CPLInit] initialization start (cognition-client)')

  initCognitionClient({
    baseUrl: options.intelligenceOsApiUrl,
    apiKey: options.intelligenceOsApiKey,
  })

  const orchestrator = new CPLOrchestrator()

  logger.info('[CPLInit] complete — cognition client wired')

  return { orchestrator }
}
