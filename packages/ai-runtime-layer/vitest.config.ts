// packages/ai-runtime-layer/vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals:     false,
    environment: 'node',
    include:     ['src/__tests__/**/*.test.ts'],
    exclude:     ['**/node_modules/**', '**/dist/**'],

    // ROOT CAUSE FIX (see REPOSITORY_PORTABILITY_REPORT.md's AI runtime test
    // isolation addendum for the full investigation): llmRouter.test.ts and
    // singleton.integration.test.ts construct their runtime via
    // AIRuntimeAdapter's "fallback path" (no configProvider set) — its own
    // source comment calls this "used in test environments and simple
    // deployments without admin settings." That path always merges
    // ConfigLoader.fromEnv() as the base config, and fromEnv() always
    // enables a real Ollama adapter at http://localhost:11434 unless
    // DISABLE_OLLAMA=1 is set — intentional product behavior for real local
    // development, not a bug in ConfigLoader. The tests' own comments
    // ("no providers in test", "no config provider set, no providers") show
    // they were written assuming an empty config means zero providers; that
    // assumption silently breaks — with zero visible errors, only a 5s
    // timeout under real inference latency — on any machine that happens to
    // have Ollama actually running (a completely normal local AI-runtime dev
    // setup). Setting DISABLE_OLLAMA=1 here uses the exact, already-existing
    // escape hatch ConfigLoader documents for "environments without Ollama
    // installed" — this *is* such an environment. This makes provider
    // registration (and therefore capability detection) deterministically
    // empty on every machine, matching every affected test's actual written
    // intent, with no change to any production code path.
    env: {
      DISABLE_OLLAMA: '1',
    },

    // Coverage configuration
    coverage: {
      provider: 'v8',
      include: [
        'src/runtime-engine/**',
        'src/router-engine/**',
        'src/policy-engine/**',
        'src/validator-engine/**',
        'src/telemetry-engine/**',
        'src/llmRouter.ts',
        'src/AIRuntimeAdapter.ts',
        'src/config/factory.ts',
      ],
      exclude: [
        'src/__tests__/**',
        'src/provider-adapters/**', // tested separately with mocked SDK calls
        'src/gateway/**',           // optional deployment mode
      ],
      thresholds: {
        lines:     80,
        functions: 90,
        branches:  75,
      },
    },

    // Isolate module state between test files (critical for singleton tests)
    isolate: true,
    poolOptions: {
      threads: {
        isolate: true,
      },
    },
  },
})


