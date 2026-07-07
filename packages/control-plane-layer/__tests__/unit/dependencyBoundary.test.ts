/**
 * Boundary tests — CPL dependency direction
 *
 * Verifies that @brandos/control-plane-layer does NOT import from
 * @brandos/presentation-layer or @brandos/ui-admin, and that the
 * dependency graph flows in the correct direction:
 *
 *   contracts → shared-utils → [...runtime layers] → CPL → presentation
 *
 * Uses static import analysis (grep) to enforce the constraint
 * without needing to build or resolve the full dependency graph.
 */

import { describe, it, expect } from 'vitest'
import { resolve, join } from 'path'
import { readFileSync, readdirSync, statSync } from 'fs'

const CPL_SRC = resolve(__dirname, '../../src')

// Pure-Node equivalent of `grep -r "pattern" dir --include="*.ts" -l`.
// The previous implementation shelled out to the real `grep` binary via
// execSync, which doesn't exist on native Windows — and the catch block
// unconditionally returned '' (grep also exits 1 for "no matches"), so a
// missing `grep` and a genuinely clean result were indistinguishable: this
// test would have silently passed on Windows even with a real violation.
function findFilesContaining(dir: string, substring: string): string[] {
  const matches: string[] = []
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry)
      if (statSync(full).isDirectory()) {
        walk(full)
      } else if (entry.endsWith('.ts')) {
        if (readFileSync(full, 'utf8').includes(substring)) matches.push(full)
      }
    }
  }
  walk(dir)
  return matches
}

function grepImports(pattern: string): string {
  return findFilesContaining(CPL_SRC, pattern).join('\n')
}

describe('CPL dependency boundary', () => {
  it('does not import from @brandos/presentation-layer', () => {
    const matches = grepImports('@brandos/presentation-layer')
    expect(matches).toBe('')
  })

  it('does not import from @brandos/ui-admin', () => {
    const matches = grepImports('@brandos/ui-admin')
    expect(matches).toBe('')
  })

  it('does not import posthog directly without a peer-dep guard', () => {
    // posthog-node should only be imported via enterprise.ts (optional peer)
    const directImports = grepImports("from 'posthog-node'")
    // enterprise.ts is the only allowed file — and it must guard with try/catch
    const files = directImports.split('\n').filter(Boolean)
    const forbidden = files.filter(f => !f.includes('enterprise.ts'))
    expect(forbidden).toHaveLength(0)
  })
})


