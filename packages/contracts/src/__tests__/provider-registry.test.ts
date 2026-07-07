/**
 * @brandos/contracts — provider-registry.test.ts
 *
 * Tests for the PROVIDER_REGISTRY and all derived lookup helpers.
 *
 * These are the most critical tests in the package: if the registry is
 * corrupt (duplicate IDs, missing fields, wrong priorities), the runtime
 * silently routes incorrectly — causing hard-to-debug production issues.
 */

import { describe, it, expect } from 'vitest'
import {
  PROVIDER_REGISTRY,
  ALL_PROVIDER_IDS,
  LOCAL_PROVIDER_IDS,
  CLOUD_PROVIDER_IDS,
  DEFAULT_ENABLED_PROVIDER_IDS,
  OPENAI_COMPATIBLE_DEFS,
  getProviderDefinition,
  isLocalProvider,
  isCloudProvider,
  type ProviderDefinition,
} from '../provider-registry'

// ─────────────────────────────────────────────────────────────────────────────
// Registry integrity
// ─────────────────────────────────────────────────────────────────────────────

describe('PROVIDER_REGISTRY integrity', () => {
  it('contains at least one local and one cloud provider', () => {
    expect(PROVIDER_REGISTRY.some(p => p.kind === 'local')).toBe(true)
    expect(PROVIDER_REGISTRY.some(p => p.kind === 'cloud')).toBe(true)
  })

  it('has no duplicate provider IDs', () => {
    const ids = PROVIDER_REGISTRY.map(p => p.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })

  it('has no duplicate priority_default values', () => {
    const priorities = PROVIDER_REGISTRY.map(p => p.priority_default)
    const unique = new Set(priorities)
    expect(unique.size).toBe(priorities.length)
  })

  it('has contiguous priority_default values starting at 1', () => {
    const sorted = [...PROVIDER_REGISTRY]
      .map(p => p.priority_default)
      .sort((a, b) => a - b)
    sorted.forEach((v, i) => {
      expect(v).toBe(i + 1)
    })
  })

  it('every local provider has requires_api_key === false', () => {
    const localProviders = PROVIDER_REGISTRY.filter(p => p.kind === 'local')
    localProviders.forEach(p => {
      expect(p.requires_api_key, `${p.id} is local but requires_api_key is true`).toBe(false)
    })
  })

  it('every local provider has cost_per_1k_tokens === 0', () => {
    const localProviders = PROVIDER_REGISTRY.filter(p => p.kind === 'local')
    localProviders.forEach(p => {
      expect(p.cost_per_1k_tokens, `${p.id} is local but has non-zero cost`).toBe(0)
    })
  })

  it('all required fields are present on every entry', () => {
    const requiredFields: (keyof ProviderDefinition)[] = [
      'id', 'name', 'kind', 'protocol', 'semanticProfile',
      'defaultModel', 'enabled_by_default', 'priority_default',
      'cost_per_1k_tokens', 'requires_api_key',
    ]
    PROVIDER_REGISTRY.forEach(p => {
      requiredFields.forEach(field => {
        expect(p[field], `${p.id} missing field: ${field}`).toBeDefined()
      })
    })
  })

  it('known providers are present', () => {
    const ids = PROVIDER_REGISTRY.map(p => p.id)
    ;['ollama', 'openai', 'anthropic', 'groq'].forEach(knownId => {
      expect(ids, `${knownId} missing from registry`).toContain(knownId)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Derived lookup arrays
// ─────────────────────────────────────────────────────────────────────────────

describe('ALL_PROVIDER_IDS', () => {
  it('contains all provider IDs', () => {
    expect(ALL_PROVIDER_IDS.length).toBe(PROVIDER_REGISTRY.length)
  })

  it('is sorted by priority_default ascending', () => {
    const expectedOrder = [...PROVIDER_REGISTRY]
      .sort((a, b) => a.priority_default - b.priority_default)
      .map(p => p.id)
    expect(ALL_PROVIDER_IDS).toEqual(expectedOrder)
  })
})

describe('LOCAL_PROVIDER_IDS', () => {
  it('contains only local providers', () => {
    LOCAL_PROVIDER_IDS.forEach(id => {
      const def = getProviderDefinition(id)
      expect(def?.kind).toBe('local')
    })
  })

  it('does not contain cloud providers', () => {
    LOCAL_PROVIDER_IDS.forEach(id => {
      expect(CLOUD_PROVIDER_IDS).not.toContain(id)
    })
  })
})

describe('CLOUD_PROVIDER_IDS', () => {
  it('contains only cloud providers', () => {
    CLOUD_PROVIDER_IDS.forEach(id => {
      const def = getProviderDefinition(id)
      expect(def?.kind).toBe('cloud')
    })
  })
})

describe('DEFAULT_ENABLED_PROVIDER_IDS', () => {
  it('is a subset of ALL_PROVIDER_IDS', () => {
    DEFAULT_ENABLED_PROVIDER_IDS.forEach(id => {
      expect(ALL_PROVIDER_IDS).toContain(id)
    })
  })

  it('only includes providers where enabled_by_default is true', () => {
    DEFAULT_ENABLED_PROVIDER_IDS.forEach(id => {
      const def = getProviderDefinition(id)
      expect(def?.enabled_by_default).toBe(true)
    })
  })

  it('has at least one provider (workspace bootstrap requires a default)', () => {
    expect(DEFAULT_ENABLED_PROVIDER_IDS.length).toBeGreaterThan(0)
  })
})

describe('OPENAI_COMPATIBLE_DEFS', () => {
  it('contains only openai-compatible protocol providers', () => {
    OPENAI_COMPATIBLE_DEFS.forEach(p => {
      expect(p.protocol).toBe('openai-compatible')
    })
  })

  it('does not include anthropic, google, ollama, or lmstudio', () => {
    const excluded = ['anthropic', 'google', 'ollama', 'lmstudio']
    OPENAI_COMPATIBLE_DEFS.forEach(p => {
      expect(excluded).not.toContain(p.id)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Helper functions
// ─────────────────────────────────────────────────────────────────────────────

describe('getProviderDefinition', () => {
  it('returns the correct definition for a known ID', () => {
    const def = getProviderDefinition('openai')
    expect(def).toBeDefined()
    expect(def?.id).toBe('openai')
    expect(def?.kind).toBe('cloud')
  })

  it('returns undefined for an unknown ID', () => {
    expect(getProviderDefinition('unknown-provider-xyz')).toBeUndefined()
  })

  it('returns undefined for empty string', () => {
    expect(getProviderDefinition('')).toBeUndefined()
  })
})

describe('isLocalProvider', () => {
  it('returns true for ollama', () => {
    expect(isLocalProvider('ollama')).toBe(true)
  })

  it('returns false for openai', () => {
    expect(isLocalProvider('openai')).toBe(false)
  })

  it('returns false for unknown provider', () => {
    expect(isLocalProvider('nonexistent')).toBe(false)
  })
})

describe('isCloudProvider', () => {
  it('returns true for openai', () => {
    expect(isCloudProvider('openai')).toBe(true)
  })

  it('returns false for ollama', () => {
    expect(isCloudProvider('ollama')).toBe(false)
  })

  it('returns false for unknown provider', () => {
    expect(isCloudProvider('nonexistent')).toBe(false)
  })
})


