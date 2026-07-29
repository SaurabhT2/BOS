// ============================================================
// packages/design-tokens/vitest.config.ts
//
// Test configuration for @brandos/design-tokens.
//
// This package contains only TypeScript types, constants, and
// pure functions — no DOM, no React, no async I/O.
// 'node' environment is correct and sufficient.
// ============================================================

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/__tests__/**',
        // Barrel re-export file — no runtime logic of its own, coverage meaningless
        // (same convention as @brandos/contracts excluding its pure type/boundary files).
        'src/index.ts',
      ],
      reporter: ['text', 'lcov'],
      thresholds: {
        statements: 95,
        branches: 90,
        functions: 95,
        lines: 95,
      },
    },
  },
})
