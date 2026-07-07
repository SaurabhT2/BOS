/**
 * scripts/shared/rule-applicability.mjs
 *
 * Given a package, determines which ARCH_RULES entries apply to it.
 *
 * PROVENANCE: extracted from scripts/generate-architecture-graph.mjs
 * (P3.5 — Agenticity Infrastructure Expansion), where this logic first
 * appeared, so generate-agent-entrypoints.mjs can reuse it rather than
 * re-implementing the same citation resolution a second time.
 *
 * PACKAGE_RESTRICTIONS bullets cite rules in two different numbering
 * schemes that both appear in ARCH_RULES: some bullets cite a rule's own
 * `id` directly (e.g. "(RULE-3)" -> id "RULE-3 — CPL BI symbol allowlist"),
 * others cite the legacy "monorepo Rule N" number recorded in that rule's
 * `source` field (e.g. "(RULE-12)" -> source "monorepo Rule 12" -> id
 * "RULE-ADMIN-AUTH"). buildCitationIndex() resolves both, preferring a
 * direct id match when a citation token is ambiguous between the two
 * schemes (this only matters for "RULE-7", which is both a real id and,
 * coincidentally, the monorepo-Rule-7 source citation for a different rule
 * — no PACKAGE_RESTRICTIONS bullet actually cites the latter, so direct-id
 * priority matches observed usage).
 */

import { PACKAGE_RESTRICTIONS } from './package-restrictions.mjs';

export const UNIVERSAL_RULE_IDS = new Set(['RULE-LAYER-ORDER', 'RULE-SAME-LEVEL-PEERS']);

function buildCitationIndex(rules) {
  const index = new Map();
  for (const rule of rules) {
    const shortId = rule.id.split(' — ')[0].trim();
    if (!index.has(shortId)) index.set(shortId, rule.id);
  }
  for (const rule of rules) {
    const m = /[Mm]onorepo [Rr]ule (\d+)/.exec(rule.source ?? '');
    if (m) {
      const token = `RULE-${m[1]}`;
      if (!index.has(token)) index.set(token, rule.id);
    }
  }
  return index;
}

function rulesCitedIn(text, citationIndex) {
  const ids = new Set();
  const re = /RULE-[A-Z0-9-]+|OCL-GOVERNANCE-CONFIG/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const token = m[0];
    const hit = citationIndex.get(token) ?? citationIndex.get(`RULE-${token}`);
    if (hit) ids.add(hit);
  }
  return ids;
}

/**
 * @param {string} pkgName - e.g. '@brandos/control-plane-layer'
 * @param {string} dir - e.g. 'packages/control-plane-layer'
 * @param {Array} archRules - ARCH_RULES (passed in rather than imported
 *   directly, since architecture-rules.mjs is the one module this file
 *   would otherwise create a second axis of coupling with)
 * @returns {string[]} applicable rule ids
 */
export function rulesFor(pkgName, dir, archRules) {
  const citationIndex = buildCitationIndex(archRules);
  const ids = new Set(UNIVERSAL_RULE_IDS);

  for (const bullet of PACKAGE_RESTRICTIONS[pkgName] ?? []) {
    for (const id of rulesCitedIn(bullet, citationIndex)) ids.add(id);
  }

  const bare = pkgName.replace('@brandos/', '');
  for (const rule of archRules) {
    if (ids.has(rule.id)) continue;
    const haystack = `${rule.id} ${rule.description} ${rule.detail ?? ''}`;
    if (haystack.includes(pkgName) || haystack.includes(bare) || (dir && haystack.includes(dir))) {
      ids.add(rule.id);
    }
  }

  return [...ids];
}
