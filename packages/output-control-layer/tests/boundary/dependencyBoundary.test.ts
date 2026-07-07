/**
 * Boundary tests — Output Control Layer dependency isolation
 *
 * Verifies statically that no source file in @brandos/output-control-layer
 * imports from @brandos/governance-config directly.
 *
 * Allowed dependency chain:
 *   governance-config → contracts → output-control-layer  ✓
 *
 * Forbidden direct coupling:
 *   governance-config ←→ output-control-layer             ✗
 *
 * WHY: OCL is a compiler/assembler layer. It needs structural constraint
 * values (minSlides, requiredRoles, etc.) but must source them from the
 * @brandos/contracts base layer, not from @brandos/governance-config
 * directly. This keeps OCL independently testable and prevents governance
 * policy churn from forcing OCL redeployments.
 *
 * The concrete constant objects live in governance-config and satisfy the
 * interfaces declared in @brandos/contracts. OCL imports the interfaces
 * and the canonical values from contracts only.
 *
 * Cleanup Sprint 2 — WS2 guardrail.
 */

import { describe, it, expect } from 'vitest'
import { resolve, join } from 'path'
import { readFileSync, readdirSync, statSync } from 'fs'

const SRC_DIR = resolve(__dirname, '../../src')

// Pure-Node equivalent of `grep -r "from '${pkg}'" dir --include="*.ts" --include="*.tsx" -l`.
// The previous implementation shelled out to the real `grep` binary via
// execSync, which doesn't exist on native Windows — and the catch block
// unconditionally returned `[]` (grep also exits 1 for "no matches"), so a
// missing `grep` and a genuinely clean result were indistinguishable: these
// tests would have silently reported "no violations" on Windows even with
// a real boundary violation.
function findFilesContaining(dir: string, substring: string): string[] {
  const matches: string[] = []
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry)
      if (statSync(full).isDirectory()) {
        walk(full)
      } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
        if (readFileSync(full, 'utf8').includes(substring)) matches.push(full)
      }
    }
  }
  walk(dir)
  return matches
}

function grepImports(pkg: string): string[] {
  return findFilesContaining(SRC_DIR, `from '${pkg}'`)
}

describe('Output-Control-Layer dependency boundary', () => {
  it('does NOT import directly from @brandos/governance-config', () => {
    const violating = grepImports('@brandos/governance-config')
    expect(violating, [
      'OCL must not import @brandos/governance-config directly.',
      'Structural constraints belong in @brandos/contracts.',
      'See: packages/contracts/src/artifact-v2.ts — CAROUSEL/DECK/REPORT_STRUCTURAL_CONSTRAINTS',
    ].join('\n')).toHaveLength(0)
  })

  it('does NOT import from @brandos/cognition-client', () => {
    const violating = grepImports('@brandos/cognition-client')
    expect(violating, [
      'OCL must not import @brandos/cognition-client.',
      'CognitionContext must be injected via ContributorContext.cognitionContext, not imported/resolved.',
    ].join('\n')).toHaveLength(0)
  })

  it('does NOT import from @platform/cognition-contract', () => {
    const violating = grepImports('@platform/cognition-contract')
    expect(violating, [
      'OCL must not import @platform/cognition-contract directly.',
      'The CognitionContext type is re-exported through @brandos/contracts\' ',
      'generation-contract.ts (ContributorContext.cognitionContext) — OCL ',
      'source files should reference it from there, keeping a single import ',
      'seam for the cross-platform contract.',
    ].join('\n')).toHaveLength(0)
  })

  it('does NOT import from @brandos/control-plane-layer', () => {
    const violating = grepImports('@brandos/control-plane-layer')
    expect(violating).toHaveLength(0)
  })

  it('does NOT import from @brandos/auth', () => {
    const violating = grepImports('@brandos/auth')
    expect(violating).toHaveLength(0)
  })
})
