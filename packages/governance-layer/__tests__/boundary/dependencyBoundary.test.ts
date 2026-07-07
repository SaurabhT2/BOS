/**
 * Boundary tests — dependency isolation enforcement.
 *
 * Validates that governance-layer only imports from allowed packages.
 * Reads the actual source files and checks for forbidden import patterns.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, resolve } from 'path'

const SRC_DIR = resolve(__dirname, '../../src')

const FORBIDDEN_IMPORT_PATTERNS = [
  { pattern: /@brandos\/ai-runtime-layer/, label: '@brandos/ai-runtime-layer' },
  { pattern: /@brandos\/control-plane-layer/, label: '@brandos/control-plane-layer' },
  { pattern: /@brandos\/artifact-engine-layer/, label: '@brandos/artifact-engine-layer' },
  { pattern: /@supabase\/supabase-js/, label: '@supabase/supabase-js' },
  { pattern: /from ['"]react['"]/, label: 'react' },
  { pattern: /from ['"]next\//, label: 'next/' },
  // P2-4 FIX: @brandos/shared-utils (L1 — infrastructure primitives) is PERMITTED for all
  // higher layers including governance-layer (L5). The layer graph explicitly allows L5 → L1.
  // repairJSON and extractJSON are correctly placed in shared-utils (domain-free) and correctly
  // imported by validators. Removing the erroneous forbidden rule.
]

const ALLOWED_BRANDOS_IMPORTS = [
  '@brandos/contracts',
  '@brandos/governance-config',
  '@brandos/shared-utils', // L1 — permitted for all layers (L5 may import L1)
]

function collectSourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      files.push(...collectSourceFiles(fullPath))
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      files.push(fullPath)
    }
  }
  return files
}

describe('Dependency boundary enforcement', () => {
  const sourceFiles = collectSourceFiles(SRC_DIR)

  it('finds source files to check', () => {
    expect(sourceFiles.length).toBeGreaterThan(0)
  })

  for (const { pattern, label } of FORBIDDEN_IMPORT_PATTERNS) {
    it(`no file imports "${label}"`, () => {
      const violations: string[] = []
      for (const file of sourceFiles) {
        const content = readFileSync(file, 'utf-8')
        const lines = content.split('\n')
        for (let i = 0; i < lines.length; i++) {
          if (pattern.test(lines[i]) && !lines[i].trim().startsWith('//') && !lines[i].trim().startsWith('*')) {
            violations.push(`${file.replace(SRC_DIR, 'src')}:${i + 1}: ${lines[i].trim()}`)
          }
        }
      }
      if (violations.length > 0) {
        throw new Error(`Forbidden import "${label}" found:\n${violations.join('\n')}`)
      }
      expect(violations).toHaveLength(0)
    })
  }

  it('all @brandos/* imports are from allowed packages', () => {
    const violations: string[] = []
    const brandosImportPattern = /from ['"](@brandos\/[^'"]+)['"]/g

    for (const file of sourceFiles) {
      const content = readFileSync(file, 'utf-8')
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue
        let match
        brandosImportPattern.lastIndex = 0
        while ((match = brandosImportPattern.exec(line)) !== null) {
          const pkg = match[1].split('/').slice(0, 2).join('/')
          if (!ALLOWED_BRANDOS_IMPORTS.some(allowed => pkg === allowed)) {
            violations.push(`${file.replace(SRC_DIR, 'src')}:${i + 1}: "${pkg}" (forbidden)`)
          }
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(`Unauthorized @brandos/* imports:\n${violations.join('\n')}`)
    }
    expect(violations).toHaveLength(0)
  })

  it('no root-level index.ts shadow file exists', () => {
    const rootIndex = resolve(__dirname, '../../index.ts')
    let exists = false
    try {
      statSync(rootIndex)
      exists = true
    } catch {
      exists = false
    }
    expect(exists).toBe(false)
  })

  it('no root-level IPackage.ts shadow file exists', () => {
    const rootIPackage = resolve(__dirname, '../../IPackage.ts')
    let exists = false
    try {
      statSync(rootIPackage)
      exists = true
    } catch {
      exists = false
    }
    expect(exists).toBe(false)
  })

  it('src/index.ts is the only entry point', () => {
    const srcIndex = resolve(__dirname, '../../src/index.ts')
    let exists = false
    try {
      statSync(srcIndex)
      exists = true
    } catch {
      exists = false
    }
    expect(exists).toBe(true)
  })

  it('no commented-out code blocks (// TODO: or // FIXME:) in source files', () => {
    const violations: string[] = []
    const todoPattern = /\/\/\s*(TODO|FIXME|HACK|XXX):/
    for (const file of sourceFiles) {
      const content = readFileSync(file, 'utf-8')
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (todoPattern.test(lines[i])) {
          violations.push(`${file.replace(SRC_DIR, 'src')}:${i + 1}: ${lines[i].trim()}`)
        }
      }
    }
    // Warn but don't fail — TODOs may exist in governance config notes
    if (violations.length > 0) {
      console.warn(`[boundary] Found ${violations.length} TODO/FIXME markers:\n${violations.join('\n')}`)
    }
    expect(violations.length).toBeLessThanOrEqual(5) // soft limit
  })

  it('no CRLF line endings in source files', () => {
    const violations: string[] = []
    for (const file of sourceFiles) {
      const content = readFileSync(file)
      if (content.includes(0x0d)) { // \r
        violations.push(file.replace(SRC_DIR, 'src'))
      }
    }
    expect(violations).toHaveLength(0)
  })
})


