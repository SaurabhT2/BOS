/**
 * scripts/brandos.ts
 *
 * BrandOS AI Agent CLI Dispatcher — v2
 *
 * Single entry point for all repo-agent-manager subcommands.
 * Replaces the five individual wrapper scripts:
 *   brandos-analyze.ts → brandos.ts analyze
 *   brandos-bug.ts     → brandos.ts bug
 *   brandos-feature.ts → brandos.ts feature
 *   brandos-plan.ts    → brandos.ts plan
 *   brandos-evolve.ts  → brandos.ts evolve
 *
 * pnpm script aliases in package.json continue to work unchanged:
 *   "brandos:analyze": "tsx scripts/brandos.ts analyze"
 *   "brandos:bug":     "tsx scripts/brandos.ts bug"
 *   "brandos:feature": "tsx scripts/brandos.ts feature"
 *   "brandos:plan":    "tsx scripts/brandos.ts plan"
 *   "brandos:evolve":  "tsx scripts/brandos.ts evolve"
 *
 * Usage:
 *   pnpm brandos:analyze
 *   pnpm brandos:bug
 *   tsx scripts/brandos.ts <subcommand> [...args]
 */

import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const VALID_SUBCOMMANDS = ['analyze', 'bug', 'feature', 'plan', 'evolve'] as const;
type Subcommand = (typeof VALID_SUBCOMMANDS)[number];

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot  = join(__dirname, '..');
const cliPath   = join(repoRoot, 'packages', 'repo-agent-manager', 'src', 'cli', 'main.ts');

// ── Parse subcommand ─────────────────────────────────────────────────────────

const [, , subcommand, ...restArgs] = process.argv;

if (!subcommand || !VALID_SUBCOMMANDS.includes(subcommand as Subcommand)) {
  const validList = VALID_SUBCOMMANDS.join(', ');
  console.error(`[brandos] Error: subcommand "${subcommand ?? ''}" is not valid.`);
  console.error(`[brandos] Valid subcommands: ${validList}`);
  console.error(`[brandos] Usage: tsx scripts/brandos.ts <subcommand> [...args]`);
  process.exit(1);
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

const result = spawnSync('tsx', [cliPath, subcommand, ...restArgs], {
  stdio: 'inherit',
  cwd:   repoRoot,
});

if (result.error) {
  console.error(`[brandos] Failed to start process: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 0);
