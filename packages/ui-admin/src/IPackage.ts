/**
 * @brandos/ui-admin — IPackage.ts
 *
 * Machine-readable package metadata for repo-intelligence and agentic tooling.
 *
 * SOURCE OF TRUTH for:
 * - Package level and blockers
 * - Capability ownership
 * - Export status (confirmed active vs. suspected dead)
 * - Invariants
 *
 * Updated by: L1 → L2 upgrade (AGENT_CONTEXT.md authored, IUIAdmin.ts created,
 * CapabilityRegistry.ts created, validatePackage() added, export usage confirmed).
 */

export const PACKAGE_METADATA = {
  name:    '@brandos/ui-admin',
  version: '1.0.0',
  layer:   8,     // Presentation layer (admin sub-layer)
  level:   'L2',  // Upgraded from L1

  /**
   * Capability ownership registry.
   * All capabilities confirmed active in apps/web admin pages.
   * See CapabilityRegistry.ts for the runtime registry object.
   */
  capabilities: {
    'admin.design.tokens':      'tokens — single source of truth for admin color palette',
    'admin.layout.card':        'AdminCard — container for admin sections',
    'admin.layout.section':     'SectionTitle — section header with icon badge',
    'admin.settings.toggle':    'Toggle — boolean setting (label + desc + switch)',
    'admin.settings.number':    'NumberInput — numeric setting with min/max/unit',
    'admin.settings.select':    'SelectInput — enum/string setting',
    'admin.settings.segmented': 'SegmentedControl — multi-option mode selector (generic T)',
    'admin.providers.status':   'StatusBadge — provider/job health indicator',
    'admin.providers.stat':     'StatCard — metric display (value + label + sub)',
    'admin.save.button':        'SaveButton — save with loading/saved states',
    'admin.save.hook':          'useAdminSave — fetch-based save state management',
  },

  /**
   * INVARIANT: No @brandos/* dependencies.
   * This package depends only on react (peer).
   */
  dependencies: [
    'react', // peer dependency
  ],

  /**
   * Packages that consume this package.
   * NOTE: apps/web is an application; cross-package reference counting does NOT
   * track app-level consumers. All repo-intelligence MEDIUM dead-code flags for
   * this package are confirmed false positives.
   */
  consumers: [
    'apps/web', // admin pages: admin/page, ai-runtime, governance, artifact-engine, telemetry
  ],

  /**
   * Export usage status — confirmed by grep audit (see AGENT_CONTEXT.md §Confirmed Export Map).
   * ALL exports are CONFIRMED ACTIVE. Do not delete any export.
   */
  exports: [
    { name: 'tokens',           status: 'CONFIRMED_ACTIVE', usedBy: ['admin/page', 'admin/governance', 'admin/ai-runtime', 'admin/artifact-engine', 'admin/telemetry'] },
    { name: 'AdminCard',        status: 'CONFIRMED_ACTIVE', usedBy: ['admin/page', 'admin/governance', 'admin/ai-runtime', 'admin/artifact-engine', 'admin/telemetry'] },
    { name: 'SectionTitle',     status: 'CONFIRMED_ACTIVE', usedBy: ['admin/page', 'admin/governance', 'admin/ai-runtime', 'admin/artifact-engine'] },
    { name: 'Toggle',           status: 'CONFIRMED_ACTIVE', usedBy: ['admin/governance', 'admin/ai-runtime', 'admin/artifact-engine'] },
    { name: 'NumberInput',      status: 'CONFIRMED_ACTIVE', usedBy: ['admin/governance', 'admin/ai-runtime', 'admin/artifact-engine'] },
    { name: 'SelectInput',      status: 'CONFIRMED_ACTIVE', usedBy: ['admin/governance', 'admin/ai-runtime', 'admin/artifact-engine'] },
    { name: 'StatCard',         status: 'CONFIRMED_ACTIVE', usedBy: ['admin/page', 'admin/telemetry'] },
    { name: 'SaveButton',       status: 'CONFIRMED_ACTIVE', usedBy: ['admin/governance', 'admin/ai-runtime', 'admin/artifact-engine'] },
    { name: 'SegmentedControl', status: 'CONFIRMED_ACTIVE', usedBy: ['admin/governance', 'admin/ai-runtime'] },
    { name: 'StatusBadge',      status: 'CONFIRMED_ACTIVE', usedBy: ['admin/page', 'admin/telemetry', 'admin/ai-runtime', 'admin/artifact-engine'] },
    { name: 'useAdminSave',     status: 'CONFIRMED_ACTIVE', usedBy: ['admin/governance', 'admin/ai-runtime', 'admin/artifact-engine'] },
  ],

  /**
   * Invariants that must never be violated.
   * IDs match UIAdminInvariantId in IUIAdmin.ts.
   * Checked at build time by validatePackage().
   */
  invariants: [
    { id: 'I-1-no-brandos-imports',           rule: 'No @brandos/* imports — this package depends only on react',                                          severity: 'CRITICAL' },
    { id: 'I-2-no-api-calls-in-components',   rule: 'No API calls in components — only useAdminSave hook, parameterized by saveUrl',                       severity: 'HIGH' },
    { id: 'I-3-components-stateless',         rule: 'All components are stateless except useAdminSave',                                                    severity: 'MEDIUM' },
    { id: 'I-4-tokens-single-source',         rule: 'tokens is the single source of truth for admin color palette — no inline hex values',                 severity: 'MEDIUM' },
    { id: 'I-5-stable-prop-interfaces',       rule: 'Component prop interfaces are stable — changes break apps/web consumers without coordination',        severity: 'CRITICAL' },
    { id: 'I-6-status-badge-colors-complete', rule: 'Every status value in StatusBadgeStatus must have an entry in STATUS_COLORS',                         severity: 'HIGH' },
  ],

  /**
   * L3 blockers (in priority order).
   */
  l3Blockers: [
    { id: 'L3-1', description: 'No test suite — useAdminSave and interactive components (Toggle, SaveButton) untested', priority: 1 },
    { id: 'L3-2', description: 'Single large file (src/index.tsx) — splitting into sub-modules enables parallel agent work', priority: 2 },
    { id: 'L3-3', description: 'pulseDot animation dependency undocumented — consuming apps must define @keyframes pulseDot in global CSS', priority: 3 },
  ],

  /**
   * Required reads before modifying this package.
   */
  requiredReads: [
    'AGENT_CONTEXT.md',  // ownership rules + invariants + safe ops
    'src/IUIAdmin.ts',   // stable public contracts
    'src/index.tsx',     // implementation
  ],

  /**
   * Migration history.
   */
  migrationHistory: [
    'v1.0.0 — Initial: single src/index.tsx, all components co-located, no docs',
    'v1.1.0 — L1→L2: AGENT_CONTEXT.md authored, IUIAdmin.ts, IPackage.ts, CapabilityRegistry.ts, validatePackage() added, export usage confirmed',
  ],
} as const

export type PackageCapabilityKey  = keyof typeof PACKAGE_METADATA.capabilities
export type PackageInvariantId    = (typeof PACKAGE_METADATA.invariants)[number]['id']


