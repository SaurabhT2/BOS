import { describe, it, expect } from 'vitest'
import { sha256Hex, sha256HexOfJson } from '../hash'

describe('hash', () => {
  it('sha256Hex produces a 64-character hex digest', async () => {
    const digest = await sha256Hex(new TextEncoder().encode('hello world'))
    expect(digest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('sha256Hex is deterministic for identical bytes', async () => {
    const bytes = new TextEncoder().encode('same content')
    const a = await sha256Hex(bytes)
    const b = await sha256Hex(bytes)
    expect(a).toBe(b)
  })

  it('sha256Hex differs for different bytes', async () => {
    const a = await sha256Hex(new TextEncoder().encode('content A'))
    const b = await sha256Hex(new TextEncoder().encode('content B'))
    expect(a).not.toBe(b)
  })

  it('sha256HexOfJson is stable for structurally identical objects', async () => {
    const a = await sha256HexOfJson({ x: 1, y: 'two' })
    const b = await sha256HexOfJson({ x: 1, y: 'two' })
    expect(a).toBe(b)
  })

  it('sha256HexOfJson differs when content differs', async () => {
    const a = await sha256HexOfJson({ x: 1 })
    const b = await sha256HexOfJson({ x: 2 })
    expect(a).not.toBe(b)
  })

  it('sha256HexOfJson handles null/undefined consistently', async () => {
    const a = await sha256HexOfJson(undefined)
    const b = await sha256HexOfJson(null)
    expect(a).toBe(b)
  })
})
