/**
 * MCP scopes derived from the RBAC matrix, PII helpers, argument summaries
 * for the audit, and the credential / PKCE primitives (lib/mcp).
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ prisma: {} }))

import { STAFF_ROLES } from '@/lib/admin/rbac'
import { allowedScopes, EXPERT_PROFILE_ROLES, intersectScopes, MCP_SCOPES, normalizeScopes, parseScopeString, scopeString } from '@/lib/mcp/scopes'
import { displayPrefix, looksLike, newSecret, pkceS256Matches, sha256Hex } from '@/lib/mcp/crypto'
import { contactEmail, contactPhone, freeText } from '@/lib/mcp/pii'
import { summarizeArgs } from '@/lib/mcp/audit'
import { roleFromRow } from '@/lib/mcp/principal'

describe('MCP scopes ← RBAC', () => {
  const staff = (r: (typeof STAFF_ROLES)[number]) => allowedScopes({ kind: 'staff', staffRole: r })

  it('maps every staff role from its existing permissions', () => {
    expect(staff('super_admin')).toEqual([...MCP_SCOPES])
    expect(staff('admin')).toEqual([...MCP_SCOPES])
    // SuperExpert: people data incl. contacts, no agents / costs.
    expect(staff('super_expert')).toEqual(['clients:read', 'clients:pii', 'diagnostics:read', 'metrics:read', 'reports:read'])
    expect(staff('crm_manager')).toEqual([...MCP_SCOPES])
    // Analyst: aggregates and journeys, but no personal contacts.
    expect(staff('analyst')).toEqual(['clients:read', 'diagnostics:read', 'metrics:read', 'reports:read', 'agents:read', 'spend:read'])
    expect(staff('support')).toEqual(['clients:read', 'clients:pii', 'diagnostics:read', 'metrics:read', 'reports:read'])
    // Content managers do not work with client data at all.
    expect(staff('content_manager')).toEqual([])
  })

  it('experts read clients (contacts included) but not agents or spend', () => {
    expect(allowedScopes({ kind: 'expert', profileRole: 'expert' })).toEqual(['clients:read', 'clients:pii', 'diagnostics:read', 'metrics:read', 'reports:read'])
  })

  it('expert profile roles are exactly the expert portal ones', async () => {
    vi.doMock('@/lib/supabase-server', () => ({ createServerClient: vi.fn() }))
    const { EXPERT_ROLES } = await import('@/lib/expert-auth')
    expect([...EXPERT_PROFILE_ROLES].sort()).toEqual([...EXPERT_ROLES].sort())
  })

  it('resolves the role like the panel: approved only, super_admin profile, staff row, then expert', () => {
    expect(roleFromRow({ email: null, profile_role: 'client', status: 'approved', staff_role: 'analyst' })).toEqual({ kind: 'staff', staffRole: 'analyst' })
    expect(roleFromRow({ email: null, profile_role: 'super_admin', status: 'approved', staff_role: null })).toEqual({ kind: 'staff', staffRole: 'super_admin' })
    // Staff are governed by RBAC even when their profile says expert.
    expect(roleFromRow({ email: null, profile_role: 'expert', status: 'approved', staff_role: 'content_manager' })).toEqual({ kind: 'staff', staffRole: 'content_manager' })
    expect(roleFromRow({ email: null, profile_role: 'expert', status: 'approved', staff_role: null })).toEqual({ kind: 'expert', profileRole: 'expert' })
    expect(roleFromRow({ email: null, profile_role: 'expert', status: 'blocked', staff_role: null })).toBeNull()
    expect(roleFromRow({ email: null, profile_role: 'super_admin', status: 'archived', staff_role: null })).toBeNull()
    expect(roleFromRow({ email: null, profile_role: 'client', status: 'approved', staff_role: null })).toBeNull()
    expect(roleFromRow({ email: null, profile_role: 'manager', status: 'approved', staff_role: null })).toBeNull()
    expect(roleFromRow(undefined)).toBeNull()
  })

  it('parses RFC 6749 scope strings strictly', () => {
    expect(parseScopeString('reports:read clients:read  clients:read')).toEqual(['clients:read', 'reports:read'])
    expect(parseScopeString(null)).toEqual([])
    expect(parseScopeString('clients:read admin:all')).toBeNull()
    expect(normalizeScopes(['spend:read', 'clients:read'])).toEqual(['clients:read', 'spend:read'])
    expect(normalizeScopes(['clients:read', 42])).toBeNull()
    expect(intersectScopes(['clients:read', 'spend:read'], ['spend:read', 'agents:read'])).toEqual(['spend:read'])
    expect(scopeString(['spend:read', 'clients:read'])).toBe('clients:read spend:read')
  })
})

describe('credentials and PKCE', () => {
  it('RFC 7636 Appendix B: S256 of the example verifier', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
    expect(pkceS256Matches(verifier, challenge)).toBe(true)
    expect(pkceS256Matches(`${verifier.slice(0, -1)}x`, challenge)).toBe(false)
    expect(pkceS256Matches('short', challenge)).toBe(false)
    // "plain" (verifier == challenge) is not accepted.
    expect(pkceS256Matches(challenge, challenge)).toBe(false)
  })

  it('mints 256-bit prefixed secrets and shows only a short prefix', () => {
    const t = newSecret('pat')
    expect(t).toMatch(/^a360_pat_[A-Za-z0-9_-]{43}$/)
    expect(looksLike('pat', t)).toBe(true)
    expect(looksLike('access', t)).toBe(false)
    expect(newSecret('pat')).not.toBe(t)
    expect(displayPrefix(t)).toBe(t.slice(0, 16))
    expect(sha256Hex(t)).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('PII and audit summaries', () => {
  it('masks contacts without the PII scope, keeps them with it', () => {
    expect(contactEmail('ivan.petrov@corp.kz', false)).toBe('i***@corp.kz')
    expect(contactEmail('ivan.petrov@corp.kz', true)).toBe('ivan.petrov@corp.kz')
    expect(contactPhone('+7 701 123 45 67', false)).toBe('•••67')
    expect(freeText('Ошибка отправки на ivan@corp.kz, тел. +7 (701) 123-45-67', false)).toBe('Ошибка отправки на i***@corp.kz, тел. •••67')
    expect(freeText('x'.repeat(500), true, 10)).toHaveLength(10)
  })

  it('never puts free text into the audit summary', () => {
    expect(summarizeArgs({ query: 'ivan@corp.kz', company_id: 'c-1', limit: 5, status: 'failed', metric_ids: ['a', 'b'], cursor: 'b2Ox' }))
      .toEqual({ query: { len: 12 }, company_id: 'c-1', limit: 5, status: 'failed', metric_ids: { items: 2 }, cursor: { len: 4 } })
    expect(summarizeArgs({ company_id: 'not an id@x' })).toEqual({ company_id: { len: 11 } })
    expect(summarizeArgs('x')).toEqual({})
  })
})
