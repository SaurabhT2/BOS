/**
 * Boundary tests — Presentation Layer dependency isolation
 *
 * Verifies statically that no source file in @brandos/presentation-layer
 * imports from forbidden packages:
 *   ✗ @brandos/control-plane-layer
 *   ✗ @brandos/ai-runtime-layer
 *   ✗ @brandos/governance-layer
 *   ✗ @brandos/output-control-layer
 *   ✗ @brandos/artifact-engine-layer
 *
 * Also verifies that src/index.ts does NOT re-export @brandos/auth symbols.
 * Consumers must import auth utilities from @brandos/auth directly.
 *
 * Shell components (WorkspaceShell, AdminShell) MAY import @brandos/auth
 * internally for rendering auth state — this is pure UI. They must NOT
 * be listed in src/index.ts re-exports.
 *
 * These tests run against source files (no compile step needed) —
 * suitable for pre-commit and CI gates.
 */

import { describe, it, expect } from 'vitest'
import { resolve, join } from 'path'
import { readFileSync, readdirSync, statSync } from 'fs'

const SRC_DIR = resolve(__dirname, '../../src')

// Pure-Node equivalent of `grep -r "from '${pkg}'" dir --include="*.ts" --include="*.tsx" -l`.
// The previous implementation shelled out to the real `grep` binary via
// execSync, which doesn't exist on native Windows — and because the catch
// block unconditionally returned `[]` (grep also exits 1 for "no matches"),
// a missing `grep` and a clean result were indistinguishable: these tests
// would have silently reported "no violations" on Windows even if a real
// boundary violation existed. Walking the tree directly is deterministic
// on every OS.
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

describe('Presentation-layer dependency boundary', () => {
  it('does NOT import from @brandos/control-plane-layer', () => {
    const violating = grepImports('@brandos/control-plane-layer')
    expect(violating).toHaveLength(0)
  })

  it('does NOT import from @brandos/ai-runtime-layer', () => {
    const violating = grepImports('@brandos/ai-runtime-layer')
    expect(violating).toHaveLength(0)
  })

  it('does NOT import from @brandos/governance-layer', () => {
    const violating = grepImports('@brandos/governance-layer')
    expect(violating).toHaveLength(0)
  })

  it('does NOT import from @brandos/output-control-layer', () => {
    const violating = grepImports('@brandos/output-control-layer')
    expect(violating).toHaveLength(0)
  })

  it('does NOT import from @brandos/artifact-engine-layer', () => {
    const violating = grepImports('@brandos/artifact-engine-layer')
    expect(violating).toHaveLength(0)
  })

  it('does NOT import Supabase clients directly (must go via @brandos/auth)', () => {
    // Direct @supabase/supabase-js imports are forbidden in presentation-layer
    // components — all Supabase access must flow through @brandos/auth.
    const files = grepImports('@supabase/supabase-js')
    expect(files).toHaveLength(0)
  })

  it('src/index.ts does NOT re-export @brandos/auth symbols (Cleanup Sprint 2 — WS1)', () => {
    // Presentation Layer must be a pure UI package.
    // Auth utilities (AuthProvider, useAuth, authService, supabase, etc.) must be
    // imported by consumers directly from @brandos/auth, not via presentation-layer.
    //
    // Shell components (WorkspaceShell, AdminShell) MAY import from @brandos/auth
    // internally — they render auth state, which is pure UI. What is prohibited is
    // re-exporting those symbols through src/index.ts.
    const indexPath = join(SRC_DIR, 'index.ts')
    const indexContent = readFileSync(indexPath, 'utf-8')

    // Check for live export lines referencing @brandos/auth (not comments)
    const liveExportLines = indexContent
      .split('\n')
      .filter(line => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .filter(line => line.includes('@brandos/auth') && line.includes('export'))

    expect(liveExportLines, [
      'src/index.ts must not re-export @brandos/auth symbols.',
      'Consumers must import from @brandos/auth directly.',
      'See: Cleanup Sprint 2 WS1.',
    ].join('\n')).toHaveLength(0)
  })
})
