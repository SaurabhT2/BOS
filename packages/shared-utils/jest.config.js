/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  // Discover tests in both legacy location (src/*.test.ts) and new location (src/__tests__/*.test.ts)
  testMatch: ["**/src/**/*.test.ts"],
  globals: {
    "ts-jest": {
      tsconfig: "./tsconfig.test.json"
    }
  },
  moduleNameMapper: {
    "^@brandos/contracts$": "<rootDir>/../contracts/src/index.ts"
  }
};


