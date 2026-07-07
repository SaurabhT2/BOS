/**
 * @brandos/ui-admin — CapabilityRegistry.ts
 *
 * Runtime capability ownership registry.
 * Maps capability keys to their owning component/export.
 *
 * Usage:
 *   import { UIAdminCapabilityRegistry } from './CapabilityRegistry'
 *   UIAdminCapabilityRegistry.owns('admin.settings.toggle')  // → true
 *   UIAdminCapabilityRegistry.get('admin.settings.toggle')   // → { owner, description, status }
 *   UIAdminCapabilityRegistry.list()                         // → CapabilityEntry[]
 *   UIAdminCapabilityRegistry.keys()                         // → CapabilityKey[]
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

export type CapabilityKey =
  | 'admin.design.tokens'
  | 'admin.layout.card'
  | 'admin.layout.section'
  | 'admin.settings.toggle'
  | 'admin.settings.number'
  | 'admin.settings.select'
  | 'admin.settings.segmented'
  | 'admin.providers.status'
  | 'admin.providers.stat'
  | 'admin.save.button'
  | 'admin.save.hook'

export type CapabilityStatus = 'active' | 'deprecated' | 'experimental'

export interface CapabilityEntry {
  key:         CapabilityKey
  owner:       string
  description: string
  status:      CapabilityStatus
  usedBy:      string[]
}

// ─── Registry data ────────────────────────────────────────────────────────────

const ENTRIES: CapabilityEntry[] = [
  {
    key:         'admin.design.tokens',
    owner:       'tokens',
    description: 'Design token constants — colors, surfaces. Single source of truth for admin color palette.',
    status:      'active',
    usedBy:      ['admin/page', 'admin/governance', 'admin/ai-runtime', 'admin/artifact-engine', 'admin/telemetry'],
  },
  {
    key:         'admin.layout.card',
    owner:       'AdminCard',
    description: 'Container card for admin sections. Applies dark surface + border styling.',
    status:      'active',
    usedBy:      ['admin/page', 'admin/governance', 'admin/ai-runtime', 'admin/artifact-engine', 'admin/telemetry'],
  },
  {
    key:         'admin.layout.section',
    owner:       'SectionTitle',
    description: 'Section header with icon badge. Renders icon in colored square + uppercase label.',
    status:      'active',
    usedBy:      ['admin/page', 'admin/governance', 'admin/ai-runtime', 'admin/artifact-engine'],
  },
  {
    key:         'admin.settings.toggle',
    owner:       'Toggle',
    description: 'Boolean setting with label, description, and toggle switch. Supports disabled state.',
    status:      'active',
    usedBy:      ['admin/governance', 'admin/ai-runtime', 'admin/artifact-engine'],
  },
  {
    key:         'admin.settings.number',
    owner:       'NumberInput',
    description: 'Numeric setting with min/max/unit. Renders inline number input with optional unit label.',
    status:      'active',
    usedBy:      ['admin/governance', 'admin/ai-runtime', 'admin/artifact-engine'],
  },
  {
    key:         'admin.settings.select',
    owner:       'SelectInput',
    description: 'Enum/string setting. Renders inline select element from options array.',
    status:      'active',
    usedBy:      ['admin/governance', 'admin/ai-runtime', 'admin/artifact-engine'],
  },
  {
    key:         'admin.settings.segmented',
    owner:       'SegmentedControl',
    description: 'Multi-option selector. Generic over T extends string. Each option is a button.',
    status:      'active',
    usedBy:      ['admin/governance', 'admin/ai-runtime'],
  },
  {
    key:         'admin.providers.status',
    owner:       'StatusBadge',
    description: 'Provider/job health indicator. Renders colored badge with optional pulse animation.',
    status:      'active',
    usedBy:      ['admin/page', 'admin/telemetry', 'admin/ai-runtime', 'admin/artifact-engine'],
  },
  {
    key:         'admin.providers.stat',
    owner:       'StatCard',
    description: 'Metric display card. Renders value + label + sub-label in colored card.',
    status:      'active',
    usedBy:      ['admin/page', 'admin/telemetry'],
  },
  {
    key:         'admin.save.button',
    owner:       'SaveButton',
    description: 'Save button with loading and saved states. Visual feedback via color + text change.',
    status:      'active',
    usedBy:      ['admin/governance', 'admin/ai-runtime', 'admin/artifact-engine'],
  },
  {
    key:         'admin.save.hook',
    owner:       'useAdminSave',
    description: 'Fetch-based save state hook. Accepts saveUrl + section. Returns { save, saving, saved, error }.',
    status:      'active',
    usedBy:      ['admin/governance', 'admin/ai-runtime', 'admin/artifact-engine'],
  },
]

// ─── Registry API ─────────────────────────────────────────────────────────────

function get(key: CapabilityKey): CapabilityEntry | undefined {
  return ENTRIES.find(e => e.key === key)
}

function keys(): CapabilityKey[] {
  return ENTRIES.map(e => e.key)
}

function list(): CapabilityEntry[] {
  return [...ENTRIES]
}

function owns(key: string): key is CapabilityKey {
  return ENTRIES.some(e => e.key === key)
}

export const UIAdminCapabilityRegistry = {
  get,
  keys,
  list,
  owns,
} as const

export type IUIAdminCapabilityRegistry = typeof UIAdminCapabilityRegistry


