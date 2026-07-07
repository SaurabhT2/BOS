/**
 * BrandOS Model Registry
 *
 * Phase 6: ModelTier removed from public exports. providerKind ('local'|'cloud')
 * is the public discriminator. ModelTier kept as internal-only for registry grouping.
 */

type ModelTier = 'frontier' | 'free_cloud' | 'local'

export interface ModelDefinition {
  id: string
  name: string
  /** internal only — not exported */
  tier: ModelTier
  provider: string
  apiModel: string
  baseUrl?: string | undefined
  maxTokens: number
  supportsVision: boolean
  costPer1kTokens?: number
  notes?: string | undefined
}

export const MODEL_REGISTRY: ModelDefinition[] = [
  // ─── Frontier ────────────────────────────────────────────────────────────────
  {
    id: 'claude-sonnet',
    name: 'Claude Sonnet',
    tier: 'frontier',
    provider: 'anthropic',
    apiModel: 'claude-sonnet-4-6',
    maxTokens: 2000,
    supportsVision: true,
    costPer1kTokens: 0.003,
  },
  {
    id: 'claude-opus',
    name: 'Claude Opus',
    tier: 'frontier',
    provider: 'anthropic',
    apiModel: 'claude-opus-4-6',
    maxTokens: 2000,
    supportsVision: true,
    costPer1kTokens: 0.015,
    notes: 'Highest quality, slowest',
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    tier: 'frontier',
    provider: 'openai',
    apiModel: 'gpt-4o',
    maxTokens: 2000,
    supportsVision: true,
    costPer1kTokens: 0.005,
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    tier: 'frontier',
    provider: 'openai',
    apiModel: 'gpt-4o-mini',
    maxTokens: 2000,
    supportsVision: true,
    costPer1kTokens: 0.00015,
    notes: 'Fast, cheap frontier',
  },
  {
    id: 'gemini-pro',
    name: 'Gemini 1.5 Pro',
    tier: 'frontier',
    provider: 'google',
    apiModel: 'gemini-1.5-pro-latest',
    maxTokens: 2000,
    supportsVision: true,
    costPer1kTokens: 0.0035,
  },
  // ─── Free Cloud ──────────────────────────────────────────────────────────────
  {
    id: 'deepseek-chat',
    name: 'DeepSeek Chat',
    tier: 'free_cloud',
    provider: 'deepseek',
    apiModel: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com/v1',
    maxTokens: 2000,
    supportsVision: false,
    costPer1kTokens: 0.00014,
    notes: 'Cost-competitive frontier-quality model',
  },
  {
    id: 'deepseek-reasoner',
    name: 'DeepSeek R1',
    tier: 'frontier',
    provider: 'deepseek',
    apiModel: 'deepseek-reasoner',
    baseUrl: 'https://api.deepseek.com/v1',
    maxTokens: 2000,
    supportsVision: false,
    costPer1kTokens: 0.00055,
    notes: 'Chain-of-thought reasoning',
  },
  {
    id: 'llama3-groq',
    name: 'Llama 3.1 70B (Groq)',
    tier: 'free_cloud',
    provider: 'groq',
    apiModel: 'llama-3.3-70b-versatile',
    baseUrl: 'https://api.groq.com/openai/v1',
    maxTokens: 1500,
    supportsVision: false,
    notes: 'Very fast inference',
  },
  {
    id: 'mixtral-groq',
    name: 'Mixtral 8x7B (Groq)',
    tier: 'free_cloud',
    provider: 'groq',
    apiModel: 'mixtral-8x7b-32768',
    baseUrl: 'https://api.groq.com/openai/v1',
    maxTokens: 1500,
    supportsVision: false,
  },
  {
    id: 'llama3-together',
    name: 'Llama 3 (Together)',
    tier: 'free_cloud',
    provider: 'togetherai',
    apiModel: 'meta-llama/Llama-3-70b-chat-hf',
    baseUrl: 'https://api.together.xyz/v1',
    maxTokens: 1500,
    supportsVision: false,
  },
  {
    id: 'qwen-openrouter',
    name: 'Qwen 2.5 72B (OpenRouter Free)',
    tier: 'free_cloud',
    provider: 'openrouter',
    apiModel: 'qwen/qwen-2.5-72b-instruct:free',
    baseUrl: 'https://openrouter.ai/api/v1',
    maxTokens: 1500,
    supportsVision: false,
  },
  {
    id: 'mistral-openrouter',
    name: 'Mistral 7B (OpenRouter)',
    tier: 'free_cloud',
    provider: 'openrouter',
    apiModel: 'mistralai/mistral-7b-instruct:free',
    baseUrl: 'https://openrouter.ai/api/v1',
    maxTokens: 1500,
    supportsVision: false,
    notes: 'Free-tier OpenRouter model',
  },
  // ─── Local ───────────────────────────────────────────────────────────────────
  {
    id: 'ollama-llama3',
    name: 'Llama 3 (Ollama local)',
    tier: 'local',
    provider: 'ollama',
    apiModel: 'llama3:latest',
    baseUrl: 'http://localhost:11434',
    maxTokens: 1500,
    supportsVision: false,
    notes: 'Requires Ollama running',
  },
  {
    id: 'ollama-llava',
    name: 'LLaVA (Ollama local, vision)',
    tier: 'local',
    provider: 'ollama',
    apiModel: 'llava:latest',
    baseUrl: 'http://localhost:11434',
    maxTokens: 1000,
    supportsVision: true,
    notes: 'Local vision model',
  },
  {
    id: 'lmstudio-local',
    name: 'LM Studio (local)',
    tier: 'local',
    provider: 'lmstudio',
    apiModel: 'local-model',
    baseUrl: 'http://localhost:1234/v1',
    maxTokens: 1500,
    supportsVision: false,
    notes: 'OpenAI-compatible local endpoint',
  },
]

export function getModelById(id: string): ModelDefinition | undefined {
  return MODEL_REGISTRY.find(m => m.id === id)
}

export function getModelsByProviderKind(kind: 'local' | 'cloud'): ModelDefinition[] {
  const localProviders = new Set(['ollama', 'lmstudio'])
  return MODEL_REGISTRY.filter(m =>
    kind === 'local' ? localProviders.has(m.provider) : !localProviders.has(m.provider)
  )
}

export function getVisionModels(): ModelDefinition[] {
  return MODEL_REGISTRY.filter(m => m.supportsVision)
}

export function getDefaultModelForProviderKind(kind: 'local' | 'cloud'): ModelDefinition {
  const localProviders = new Set(['ollama', 'lmstudio'])
  const envKey = `BRANDOS_DEFAULT_${kind.toUpperCase()}_MODEL`
  const envOverride = process.env[envKey]
  if (envOverride) {
    const found = getModelById(envOverride)
    if (found) return found
  }
  const defaults: Record<'local' | 'cloud', string> = {
    cloud: 'claude-sonnet',
    local: 'ollama-llama3',
  }
  return getModelById(defaults[kind])!
}


