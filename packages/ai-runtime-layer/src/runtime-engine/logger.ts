// ============================================================
// packages/ai-runtime-layer/src/runtime-engine/logger.ts
//
// LOGGER — Re-export from @brandos/shared-utils
//
// Logger and generateRequestId are generic utilities that live in
// @brandos/shared-utils. This file re-exports them so imports within
// ai-runtime-layer can use the short local path.
//
// ARCHITECTURAL RULE:
//   DO NOT add ai-runtime-specific log formatting here.
//   This file is a pure re-export.
//
// LOGGER USAGE PATTERN:
//   Each engine creates a child logger with its class name:
//     private readonly logger = logger.child('RuntimeEngine')
//     private readonly logger = opts.logger.child('ExecutionEngine')
//   This ensures log lines are tagged with the originating component,
//   making multi-engine traces readable:
//     [info] [RuntimeEngine] run() { task: 'chat' }
//     [info] [RouterEngine] Plan { provider: 'anthropic', mode: 'cloud' }
//     [info] [ExecutionEngine] Invoking anthropic { requestId: '...' }
// ============================================================

export { Logger, generateRequestId } from '@brandos/shared-utils'


