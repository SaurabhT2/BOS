// packages/ai-runtime-layer/src/__tests__/MockProviderAdapter.ts
//
// Test double for IProviderAdapter.
// Configure responses via static factory methods.
//
// L5 FIX: Updated to implement the L5 IProviderAdapter contract:
//   - ProviderResult → ProviderInvokeResult
//   - healthCheck() returns ProviderCapabilityStatus (not boolean)
//   - Added required name and supportedModes properties
//   - Removed capabilities() (not part of IProviderAdapter)

import type {
  IProviderAdapter,
  ProviderInvokeRequest,
  ProviderInvokeResult,
  ProviderCapabilityStatus,
  ProviderName,
  ExecutionMode,
} from '@brandos/contracts'

export interface MockProviderConfig {
  /** Content to return on success. Default: 'mock response' */
  content?: string
  /** If true, invoke() will throw an Error with errorMessage */
  shouldThrow?: boolean
  /** Error message when shouldThrow is true */
  errorMessage?: string
  /** finish_reason to return. Default: 'stop' */
  finishReason?: 'stop' | 'length' | 'error' | 'timeout'
  /** Token usage to return */
  tokenUsage?: { prompt: number; completion: number }
  /** Artificial delay in ms before resolving */
  delayMs?: number
  /** Whether this provider reports as healthy */
  healthy?: boolean
  /** Provider name for this mock. Default: 'openai' */
  providerName?: ProviderName
}

export class MockProviderAdapter implements IProviderAdapter {
  private config: Required<MockProviderConfig>
  public invokeCallCount = 0
  public lastRequest: ProviderInvokeRequest | undefined

  readonly name: ProviderName
  readonly supportedModes: ExecutionMode[] = ['cloud', 'local', 'auto']

  constructor(config: MockProviderConfig = {}) {
    this.config = {
      content:      config.content      ?? 'mock response',
      shouldThrow:  config.shouldThrow  ?? false,
      errorMessage: config.errorMessage ?? 'mock provider error',
      finishReason: config.finishReason ?? 'stop',
      tokenUsage:   config.tokenUsage   ?? { prompt: 100, completion: 50 },
      delayMs:      config.delayMs      ?? 0,
      healthy:      config.healthy      ?? true,
      providerName: config.providerName ?? 'openai',
    }
    this.name = this.config.providerName
  }

  async invoke(request: ProviderInvokeRequest): Promise<ProviderInvokeResult> {
    this.invokeCallCount++
    this.lastRequest = request

    if (this.config.delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, this.config.delayMs))
    }

    if (this.config.shouldThrow) {
      throw new Error(this.config.errorMessage)
    }

    return {
      content:       this.config.content,
      finish_reason: this.config.finishReason,
      token_usage:   this.config.tokenUsage,
      latency_ms:    0,
    }
  }

  async healthCheck(_timeout_ms: number): Promise<ProviderCapabilityStatus> {
    return {
      available:  this.config.healthy,
      healthy:    this.config.healthy,
      latency_ms: 0,
      checked_at: Date.now(),
    }
  }

  /** Factory: always succeeds */
  static success(content = 'mock response'): MockProviderAdapter {
    return new MockProviderAdapter({ content })
  }

  /** Factory: always throws */
  static failure(message = 'provider error'): MockProviderAdapter {
    return new MockProviderAdapter({ shouldThrow: true, errorMessage: message })
  }

  /** Factory: returns timeout finish_reason */
  static timeout(): MockProviderAdapter {
    return new MockProviderAdapter({ finishReason: 'timeout' })
  }

  /** Factory: unhealthy provider */
  static unhealthy(): MockProviderAdapter {
    return new MockProviderAdapter({ healthy: false })
  }

  /** Factory: success after delay */
  static delayed(delayMs: number, content = 'slow response'): MockProviderAdapter {
    return new MockProviderAdapter({ delayMs, content })
  }
}


