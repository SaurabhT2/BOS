'use client'
/**
 * @brandos/ui-admin — inputs.tsx
 *
 * Input controls: Toggle, NumberInput, SelectInput, SegmentedControl.
 */

import * as React from 'react'
import { tokens } from './tokens'

// ─── Toggle ───────────────────────────────────────────────────────────────────

export interface ToggleProps {
  label?:   string
  checked:  boolean
  onChange: (v: boolean) => void
  desc?:    string
  color?:   string
  disabled?: boolean
}

export function Toggle({ label, checked, onChange, desc, color = tokens.info, disabled }: ToggleProps) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 0', borderBottom: `1px solid ${tokens.borderSubtle}`,
      opacity: disabled ? 0.5 : 1,
    }}>
      <div>
        {label && <div style={{ fontSize: 13, color: '#cbd5e1', fontWeight: 500 }}>{label}</div>}
        {desc && <div style={{ fontSize: 11, color: tokens.textDim, marginTop: 2 }}>{desc}</div>}
      </div>
      <button
        onClick={() => !disabled && onChange(!checked)}
        aria-checked={checked}
        role="switch"
        style={{
          width: 42, height: 22, borderRadius: 11,
          border: 'none', cursor: disabled ? 'not-allowed' : 'pointer', flexShrink: 0,
          background: checked ? color : '#1e293b',
          position: 'relative', transition: 'background 0.2s',
        }}
      >
        <div style={{
          width: 16, height: 16, borderRadius: '50%', background: '#fff',
          position: 'absolute', top: 3,
          left: checked ? 23 : 3,
          transition: 'left 0.2s',
        }} />
      </button>
    </div>
  )
}

// ─── NumberInput ──────────────────────────────────────────────────────────────

export interface NumberInputProps {
  label:     string
  value:     number
  onChange:  (v: number) => void
  min?:      number
  max?:      number
  unit?:     string
  disabled?: boolean
}

export function NumberInput({ label, value, onChange, min = 0, max = 99_999, unit, disabled }: NumberInputProps) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '8px 0', borderBottom: `1px solid ${tokens.borderSubtle}`,
    }}>
      <span style={{ fontSize: 13, color: tokens.textMuted }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          disabled={disabled}
          onChange={(e) => onChange(Number((e.currentTarget as HTMLInputElement).value))}
          style={{
            width: 80, padding: '4px 8px', borderRadius: 6,
            border: `1px solid ${tokens.border}`,
            background: tokens.bg, color: tokens.text,
            fontSize: 13, textAlign: 'right',
            fontVariantNumeric: 'tabular-nums',
          }}
        />
        {unit && <span style={{ fontSize: 11, color: tokens.textDim }}>{unit}</span>}
      </div>
    </div>
  )
}

// ─── SelectInput ──────────────────────────────────────────────────────────────

export interface SelectInputProps {
  label:    string
  value:    string
  onChange: (v: string) => void
  options:  { value: string; label: string }[]
}

export function SelectInput({ label, value, onChange, options }: SelectInputProps) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '8px 0', borderBottom: `1px solid ${tokens.borderSubtle}`,
    }}>
      <span style={{ fontSize: 13, color: tokens.textMuted }}>{label}</span>
      <select
        value={value}
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onChange(e.currentTarget.value)}
        style={{
          padding: '4px 10px', borderRadius: 6,
          border: `1px solid ${tokens.border}`,
          background: tokens.surface, color: tokens.text,
          fontSize: 12, cursor: 'pointer',
        }}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

// ─── SegmentedControl ─────────────────────────────────────────────────────────

export interface SegmentedControlProps<T extends string> {
  value:    T
  onChange: (v: T) => void
  options:  { value: T; label: string; desc?: string }[]
  color?:   string
}

export function SegmentedControl<T extends string>({ value, onChange, options, color = tokens.info }: SegmentedControlProps<T>) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {options.map(o => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          title={o.desc}
          style={{
            flex: 1, padding: '8px 12px', borderRadius: 8,
            border: `1px solid ${value === o.value ? color : tokens.border}`,
            background: value === o.value ? `${color}18` : 'transparent',
            color: value === o.value ? color : tokens.textDim,
            cursor: 'pointer', fontSize: 12, fontWeight: 600,
            transition: 'all 0.15s',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}


