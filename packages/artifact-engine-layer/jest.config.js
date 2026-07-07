/**
 * @brandos/artifact-engine-layer — jest.config.js
 *
 * Jest configuration for this package.
 *
 * STRATEGY:
 *   - ts-jest: TypeScript source files are compiled by Jest via ts-jest.
 *   - testEnvironment: node (no browser APIs needed).
 *   - testMatch: only tests in src/tests/ (no accidental test discovery in dist/).
 *   - moduleNameMapper: maps @brandos/* workspace imports to their actual source
 *     locations. In a real monorepo with project references, this would point to
 *     the compiled dist/ of each package. In test environments, source is used.
 *
 * ISOLATION:
 *   Each test file runs in its own worker (default Jest behavior).
 *   Singletons (globalArtifactRegistry etc.) are reset via jest.resetModules()
 *   where needed (see bootstrap.integration.test.ts).
 */

/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',

  // Only discover tests in src/tests/ — never in dist/ or node_modules/
  testMatch: [
    '<rootDir>/src/tests/**/*.test.ts',
  ],

  // TypeScript compilation via ts-jest
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        // isolatedModules required for Node16/Next hybrid moduleResolution in ts-jest
        isolatedModules: true,
        // Include jest types so describe/it/expect are recognised without explicit imports
        types: ['jest', 'node'],
      },
    }],
  },

  // Map workspace package names to their source files.
  // In CI/CD, these would point to compiled dist/ artifacts.
  // In local dev with ts-jest, they can point to src/ directly.
  moduleNameMapper: {
    '^@brandos/contracts$': '<rootDir>/../contracts/src/index.ts',
    '^@brandos/output-control-layer$': '<rootDir>/../output-control-layer/src/index.ts',
    '^@brandos/governance-layer$': '<rootDir>/../governance-layer/src/index.ts',
    '^@brandos/iskill-runtime$': '<rootDir>/../iskill-runtime/src/index.ts',
  },

  // Coverage configuration (used with --coverage flag)
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/tests/**',           // exclude test files from coverage
    '!src/**/*.d.ts',          // exclude declaration files
  ],

  coverageThresholds: {
    global: {
      branches:  70,
      functions: 80,
      lines:     80,
      statements: 80,
    },
  },

  // Display each test name in verbose output
  verbose: true,
}


