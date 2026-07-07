import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    // Resolve workspace packages from source during tests, avoiding
    // dist/ ESM extension issues from packages built with moduleResolution: "bundler"
    alias: {
      '@platform/cognition-contract': path.resolve(__dirname, '../cognition-contract/src/index.ts'),
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
