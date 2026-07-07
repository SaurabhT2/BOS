// ============================================================
// packages/contracts/vitest.config.ts
//
// Test configuration for @brandos/contracts.
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
    // Coverage setup — run with `pnpm test:coverage`
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/__tests__/**',
        // Boundary doc file — no runtime code
        'src/IContracts.ts',
        // Pure type files — zero runtime code, coverage meaningless
        'src/auth-types.ts',
        'src/generation-contract.ts',
        'src/artifact-v2-compat.ts',
      ],
      reporter: ['text', 'lcov'],
      // L5 coverage targets — required for Agentic Readiness L5
      thresholds: {
        statements: 95,
        branches: 90,
        functions: 95,
        lines: 95,
      },
    },
  },
})


