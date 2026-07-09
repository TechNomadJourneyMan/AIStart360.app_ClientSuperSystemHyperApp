/**
 * tests/unit/giga-admin/user-access.test.ts — PATCH /api/giga-admin/users/[id]/access
 * (Фаза 6C). Урок аудита 2026-07-04: мутация обязана идти service-клиентом и
 * честно падать при 0 затронутых строк.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const giga = vi.hoisted(() => ({ role: 'super_admin' as string | null }))
const db = vi.hoisted(() => ({
  updated: [{ id: 'u1', tier: 'pro', feature_flags: {} }] as unknown[],
  error: null as unknown,
  lastPatch: null as Record<string, unknown> | null,
}))
const audit = vi.hoisted(() => ({ fn: vi.fn() }))

vi.mock('@/lib/giga-cookie', () => ({
  GIGA_COOKIE_NAME: 'giga',
  verifyGigaRole: () => giga.role,
}))
vi.mock('@/lib/audit', () => ({ logAudit: (...a: unknown[]) => audit.fn(...a) }))
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        db.lastPatch = patch
        return {
          eq: () => ({ select: () => Promise.resolve({ data: db.updated, error: db.error }) }),
        }
      },
    }),
  }),
}))

import { PATCH } from '@/app/api/giga-admin/users/[id]/access/route'
import { NextRequest } from 'next/server'

const UID = '11111111-2222-3333-4444-555555555555'

// Роут читает req.cookies (isSuperAdmin) — нужен настоящий NextRequest.
function req(body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/giga-admin/users/${UID}/access`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('giga-admin user access PATCH', () => {
  beforeEach(() => {
    giga.role = 'super_admin'
    db.updated = [{ id: UID, tier: 'pro', feature_flags: {} }]
    db.error = null
    db.lastPatch = null
    audit.fn.mockReset()
  })

  it('403 for non-super_admin', async () => {
    giga.role = 'admin'
    const res = await PATCH(req({ tier: 'pro' }), { params: { id: UID } })
    expect(res.status).toBe(403)
  })

  it('updates tier and audits', async () => {
    const res = await PATCH(req({ tier: 'pro' }), { params: { id: UID } })
    expect(res.status).toBe(200)
    expect(db.lastPatch).toEqual({ tier: 'pro' })
    expect(audit.fn).toHaveBeenCalled()
  })

  it('sanitizes feature_flags to known booleans only', async () => {
    await PATCH(req({ feature_flags: { pdf_export: true, junk: 1, ai_chat: 'yes' } }), {
      params: { id: UID },
    })
    expect(db.lastPatch).toEqual({ feature_flags: { pdf_export: true } })
  })

  it('409 when 0 rows updated (profile missing or migration 048 not applied)', async () => {
    db.updated = []
    const res = await PATCH(req({ tier: 'free' }), { params: { id: UID } })
    expect(res.status).toBe(409)
    expect(audit.fn).not.toHaveBeenCalled()
  })

  it('422 on garbage tier / empty body / bad uuid → 400', async () => {
    expect((await PATCH(req({ tier: 'gold' }), { params: { id: UID } })).status).toBe(422)
    expect((await PATCH(req({}), { params: { id: UID } })).status).toBe(422)
    expect((await PATCH(req({ tier: 'pro' }), { params: { id: 'nope' } })).status).toBe(400)
  })
})
