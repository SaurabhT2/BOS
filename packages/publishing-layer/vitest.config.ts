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
        'src/index.ts',
        'src/types.ts',
        'src/publisher-contract.ts',
        'src/repository.ts',
        // Exclusively wraps a live external service (Supabase) — no
        // in-memory counterpart lives in this file (unlike storage.ts,
        // which is NOT excluded because InMemoryRenderedOutputStore's real
        // coverage shouldn't be hidden by SupabaseRenderedOutputStore's).
        // repository-supabase.ts's pure logic — row mappers, isTableMissing(),
        // and every method's missing-credentials guard clause — IS
        // unit-tested (repository-supabase.test.ts) and passes; the actual
        // wire-level .from() calls need a live or extensively mocked
        // Supabase client to verify further, which this sandbox does not
        // have. See PUBLISHING_LAYER_NOTES.md's validation section.
        'src/repository-supabase.ts',
      ],
      reporter: ['text', 'lcov'],
      thresholds: {
        statements: 85,
        branches: 80,
        functions: 85,
        lines: 85,
      },
    },
  },
})
