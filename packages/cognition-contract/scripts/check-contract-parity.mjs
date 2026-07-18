#!/usr/bin/env node
/**
 * check-contract-parity.mjs
 *
 * Cognitive Platform Evolution Program — EM-1.1 (Contract Publishing &
 * Parity Gate).
 *
 * Until both repositories can depend on a single published
 * `@platform/cognition-contract` package from a shared registry (blocked
 * on provisioning a private package registry — an infrastructure/ops
 * decision, not something this script can do), this file is the interim
 * enforcement mechanism the Milestone 1 risk assessment called out as an
 * acceptable fallback: a symbol-level parity check between this repo's
 * copy of the contract and IntelligenceOS's copy, run in CI.
 *
 * WHAT THIS DOES
 * Parses every exported top-level declaration (interface, type alias,
 * const, function) out of both copies of CognitionContext.ts,
 * CognitionProvider.ts, and index.ts, and compares them symbol-by-symbol:
 *
 *   - Present in both, identical (after stripping comments/whitespace)
 *     → OK.
 *   - Present in both, DIFFERENT                → FAIL (accidental drift —
 *     exactly the bug this check exists to catch; see the audit's §1.2).
 *   - Present in only one side                   → FAIL, UNLESS the symbol
 *     is listed in that side's contract-parity.allowlist.json with a
 *     `reason` and `trackingRef` — i.e. a documented, tracked, deliberate
 *     divergence (e.g. `review()` / `CognitionReviewDecision` under
 *     Option B, tracked as EM-4.5) rather than an oversight.
 *
 * This intentionally does NOT require byte-for-byte file identity — that
 * would make it impossible to ever ship a deliberate, reviewed divergence
 * like Option B without lying about it in an allowlist entry that says
 * "everything," which defeats the point. It requires every divergence to
 * be named and justified.
 *
 * USAGE
 *   SIBLING_CONTRACT_SRC=/path/to/intelligenceOS/packages/cognition-contract/src \
 *     node packages/cognition-contract/scripts/check-contract-parity.mjs
 *
 * Exits non-zero (and fails CI) on any undocumented divergence.
 */

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const __dirname = dirname(fileURLToPath(import.meta.url))
const LOCAL_SRC = join(__dirname, '..', 'src')
const LOCAL_ALLOWLIST = join(__dirname, '..', 'contract-parity.allowlist.json')

const SIBLING_SRC = process.env.SIBLING_CONTRACT_SRC
const FILES = ['CognitionContext.ts', 'CognitionProvider.ts', 'index.ts']

function normalize(text) {
  // Strip comments and collapse whitespace so documentation-only edits
  // (e.g. a doc filename rename in a docblock) never count as drift —
  // only changes to the actual declared shape do.
  const withoutBlockComments = text.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const withoutLineComments = withoutBlockComments.replace(/\/\/[^\n]*/g, ' ')
  return withoutLineComments.replace(/\s+/g, ' ').trim()
}

function extractSymbols(filePath) {
  const text = readFileSync(filePath, 'utf8')
  const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true)
  const symbols = new Map()

  for (const stmt of sourceFile.statements) {
    const isExported =
      ts.canHaveModifiers(stmt) &&
      ts.getModifiers(stmt)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    const isExportDeclaration = ts.isExportDeclaration(stmt)

    if (isExportDeclaration) {
      // `export type { X, Y } from './Z'` — record each named export.
      const clause = stmt.exportClause
      if (clause && ts.isNamedExports(clause)) {
        for (const el of clause.elements) {
          symbols.set(`export:${el.name.text}`, normalize(el.getText(sourceFile)))
        }
      }
      continue
    }

    if (!isExported) continue

    let name = null
    if (
      ts.isInterfaceDeclaration(stmt) ||
      ts.isTypeAliasDeclaration(stmt) ||
      ts.isFunctionDeclaration(stmt)
    ) {
      name = stmt.name?.text ?? null
    } else if (ts.isVariableStatement(stmt)) {
      name = stmt.declarationList.declarations[0]?.name?.getText(sourceFile) ?? null
    }

    if (name) {
      symbols.set(`decl:${name}`, normalize(stmt.getText(sourceFile)))
    }
  }

  return symbols
}

function loadAllowlist(path) {
  if (!existsSync(path)) return {}
  return JSON.parse(readFileSync(path, 'utf8'))
}

function main() {
  if (!SIBLING_SRC) {
    console.error(
      '[contract-parity] SIBLING_CONTRACT_SRC is not set — pass the path to the ' +
        "other repository's packages/cognition-contract/src directory. " +
        'Skipping (this is expected when only one repository is checked out; ' +
        'CI wiring across both repositories is tracked separately, see EM-1.1).'
    )
    process.exit(0)
  }

  const allowlist = loadAllowlist(LOCAL_ALLOWLIST)
  let failures = []

  for (const file of FILES) {
    const localPath = join(LOCAL_SRC, file)
    const siblingPath = join(SIBLING_SRC, file)

    if (!existsSync(siblingPath)) {
      failures.push(`${file}: missing entirely on the sibling side.`)
      continue
    }

    const localSymbols = extractSymbols(localPath)
    const siblingSymbols = extractSymbols(siblingPath)
    const allKeys = new Set([...localSymbols.keys(), ...siblingSymbols.keys()])

    for (const key of allKeys) {
      const local = localSymbols.get(key)
      const sibling = siblingSymbols.get(key)
      const allowed = allowlist[key]

      if (local !== undefined && sibling !== undefined) {
        if (local !== sibling) {
          if (allowed?.reason) {
            console.warn(
              `[contract-parity] ${file} ${key}: differs, but allowlisted — ${allowed.reason} (${allowed.trackingRef ?? 'no tracking ref'})`
            )
          } else {
            failures.push(
              `${file} ${key}: content differs between repositories and is NOT allowlisted. ` +
                'This is exactly the accidental-drift failure mode the audit found — either ' +
                'make the two copies match, or add a justified entry to ' +
                'contract-parity.allowlist.json.'
            )
          }
        }
        continue
      }

      // One-sided symbol.
      if (allowed?.reason) {
        console.warn(
          `[contract-parity] ${file} ${key}: present on only one side, allowlisted — ${allowed.reason} (${allowed.trackingRef ?? 'no tracking ref'})`
        )
      } else {
        failures.push(
          `${file} ${key}: present on only one side and NOT allowlisted (undocumented divergence).`
        )
      }
    }
  }

  if (failures.length > 0) {
    console.error('\n[contract-parity] FAILED — undocumented contract drift detected:\n')
    for (const f of failures) console.error(`  - ${f}`)
    console.error(
      '\nIf this divergence is deliberate (e.g. an Option-B-style split), add it to ' +
        'contract-parity.allowlist.json with a reason and trackingRef instead of ' +
        'silently shipping it — that is the whole point of this check.\n'
    )
    process.exit(1)
  }

  console.log('[contract-parity] OK — no undocumented drift between contract copies.')
}

main()
