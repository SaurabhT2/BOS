import { describe, it, expect } from 'vitest'
import {
  DEFAULT_APPROVER_ROLES,
  StaticPolicyProvider,
  evaluateApprovalGate,
  evaluatePublishGate,
} from '../policy'

describe('StaticPolicyProvider', () => {
  it('returns governance-config defaults when no overrides are given', async () => {
    const provider = new StaticPolicyProvider()
    const policy = await provider.getPolicy('any-workspace')
    expect(policy.allowedApproverRoles).toEqual(DEFAULT_APPROVER_ROLES)
    expect(typeof policy.requirePublishingApproval).toBe('boolean')
    expect(typeof policy.requireApprovalForExternalPublish).toBe('boolean')
  })

  it('applies overrides', async () => {
    const provider = new StaticPolicyProvider({
      requirePublishingApproval: true,
      allowedApproverRoles: ['editor'],
    })
    const policy = await provider.getPolicy('w1')
    expect(policy.requirePublishingApproval).toBe(true)
    expect(policy.allowedApproverRoles).toEqual(['editor'])
  })

  it('returns the same policy regardless of workspaceId (documented limitation)', async () => {
    const provider = new StaticPolicyProvider({ requirePublishingApproval: true })
    const a = await provider.getPolicy('w1')
    const b = await provider.getPolicy('w2')
    expect(a).toEqual(b)
  })
})

describe('evaluateApprovalGate', () => {
  const policy = {
    requirePublishingApproval: true,
    requireApprovalForExternalPublish: true,
    allowedApproverRoles: ['owner', 'admin'],
  }

  it('allows an approver with a permitted role', () => {
    expect(evaluateApprovalGate(policy, 'owner').allowed).toBe(true)
  })

  it('denies an approver with a role not in the allowlist', () => {
    const result = evaluateApprovalGate(policy, 'viewer')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('viewer')
  })
})

describe('evaluatePublishGate', () => {
  it('allows publishing without approval when neither gate flag is set', () => {
    const policy = { requirePublishingApproval: false, requireApprovalForExternalPublish: false, allowedApproverRoles: [] }
    expect(evaluatePublishGate(policy, false).allowed).toBe(true)
  })

  it('denies publishing without an approval when requirePublishingApproval is true', () => {
    const policy = { requirePublishingApproval: true, requireApprovalForExternalPublish: false, allowedApproverRoles: [] }
    const result = evaluatePublishGate(policy, false)
    expect(result.allowed).toBe(false)
  })

  it('denies publishing without an approval when requireApprovalForExternalPublish is true', () => {
    const policy = { requirePublishingApproval: false, requireApprovalForExternalPublish: true, allowedApproverRoles: [] }
    expect(evaluatePublishGate(policy, false).allowed).toBe(false)
  })

  it('allows publishing when an approval exists and approval is required', () => {
    const policy = { requirePublishingApproval: true, requireApprovalForExternalPublish: true, allowedApproverRoles: [] }
    expect(evaluatePublishGate(policy, true).allowed).toBe(true)
  })
})
