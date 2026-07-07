import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    // Resolve workspace packages from source during tests, avoiding
    // dist/ ESM extension issues from packages built with moduleResolution: "bundler"
    alias: {
      '@brandos/governance-layer': path.resolve(__dirname, '../governance-layer/src/index.ts'),
      '@brandos/governance-config': path.resolve(__dirname, '../governance-config/src/index.ts'),
      '@brandos/contracts': path.resolve(__dirname, '../contracts/src/index.ts'),
      '@brandos/cognition-client': path.resolve(__dirname, '../cognition-client/src/index.ts'),
      '@platform/cognition-contract': path.resolve(__dirname, '../cognition-contract/src/index.ts'),
      '@brandos/output-control-layer': path.resolve(__dirname, '../output-control-layer/src/index.ts'),
      '@brandos/artifact-engine-layer': path.resolve(__dirname, '../artifact-engine-layer/src/index.ts'),
      '@brandos/ai-runtime-layer': path.resolve(__dirname, '../ai-runtime-layer/src/index.ts'),
      '@brandos/shared-utils': path.resolve(__dirname, '../shared-utils/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: ['src/**/*.ts'],
    },
  },
})


