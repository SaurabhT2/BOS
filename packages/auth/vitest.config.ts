import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Run in a Node environment — auth tests do not need a browser DOM.
    // Hooks tests that use React hooks would need 'jsdom' — those are covered
    // by the presentation-layer test suite which has jsdom configured.
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts', 'src/__tests__/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/__tests__/**',
        'src/types/**',       // Re-export barrels only — no logic to cover
        'src/index.ts',       // Re-export barrel only
        'src/IAuth.ts',       // Interface definitions only
      ],
    },
  },
});


