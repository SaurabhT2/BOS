import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@brandos\/contracts$/, replacement: resolve(__dirname, 'node_modules/@brandos/contracts/index.js') },
      { find: /^@brandos\/governance-config$/, replacement: resolve(__dirname, 'node_modules/@brandos/governance-config/dist/index.js') },
    ],
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


