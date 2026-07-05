import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Regression: GET /api/giga-admin/clients used to call createServerClient()
 * (anon key), which — because the giga panel has no Supabase auth session —
 * hit `profiles`' RLS with auth.uid() = NULL and returned []. The UI then
 * showed "Клиентов пока нет в базе" even when the DB was full of approved
 * clients. Fix: use createServiceClient() (bypasses RLS).
 */

const state = vi.hoisted(() => ({
  stub: null as any,
  role: 'super_admin' as string | null,
}))

vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => {
    if (!state.stub) throw new Error('no service stub configured')
    return state.stub
  },
}))

// Guard: if the route regresses to the anon client, tests must fail loud
// instead of silently returning [] like production did.
vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => {
    throw new Error('regression: giga-admin route must NOT use anon createServerClient()')
  },
}))

vi.mock('@/lib/giga-cookie', () => ({
  GIGA_COOKIE_NAME: 'aistart360_giga',
  verifyGigaRole: () => state.role,
}))

import { NextRequest } from 'next/server'
import { GET } from '@/app/api/giga-admin/clients/route'

function makeSbStub({
  profiles = [] as any[],
  companies = [] as any[],
  diagnostics = [] as any[],
  profilesError = null as any,
}) {
  return {
    from(table: string) {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => Promise.resolve({ data: profiles, error: profilesError }),
              }),
            }),
          }),
        }
      }
      if (table === 'companies') {
        return {
          select: () => Promise.resolve({ data: companies, error: null }),
        }
      }
      if (table === 'diagnostics') {
        return {
          select: () => ({
            order: () => Promise.resolve({ data: diagnostics, error: null }),
          }),
        }
      }
      throw new Error('unexpected table: ' + table)
    },
  }
}

function makeReq() {
  return new NextRequest('http://localhost/api/giga-admin/clients', {
    method: 'GET',
    headers: { cookie: 'aistart360_giga=x' },
  })
}

describe('GET /api/giga-admin/clients — RLS bypass regression', () => {
  beforeEach(() => {
    state.role = 'super_admin'
    state.stub = null
  })

  it('403s when the giga super_admin cookie is missing', async () => {
    state.role = null
    state.stub = makeSbStub({})
    const res = await GET(makeReq())
    expect(res.status).toBe(403)
  })

  it('reads via service-role client (guard-mock proves anon is NOT used)', async () => {
    state.stub = makeSbStub({
      profiles: [
        { id: 'u1', email: 'a@x.io', full_name: 'Anna', organization: 'Acme', status: 'approved', created_at: '2026-01-01' },
      ],
    })
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const { clients } = await res.json()
    expect(clients).toHaveLength(1)
    expect(clients[0]).toMatchObject({ id: 'u1', name: 'Acme' })
  })

  it('joins company + diagnostics onto each approved profile', async () => {
    state.stub = makeSbStub({
      profiles: [
        { id: 'u1', email: 'a@x.io', full_name: 'Anna', organization: null, status: 'approved', created_at: '2026-01-01' },
      ],
      companies: [{ user_id: 'u1', name: 'Beta LLC', industry: 'SaaS', employee_count: 12 }],
      diagnostics: [
        // Two rows for same user — only the FIRST (already sorted) must win.
        { user_id: 'u1', overall_score: 7.2, health_index: 65, stage: 'Growth', created_at: '2026-02-02' },
        { user_id: 'u1', overall_score: 4.0, health_index: 30, stage: 'Seed', created_at: '2025-12-01' },
      ],
    })
    const res = await GET(makeReq())
    const { clients } = await res.json()
    expect(clients[0].name).toBe('Beta LLC')
    expect(clients[0].industry).toBe('SaaS')
    expect(clients[0].stage).toBe('Growth')
    // health_index 65 → low-risk band → churnLevel 'low', churnProb 35, riskScore 20
    expect(clients[0].pulseMetrics.churnLevel).toBe('low')
    expect(clients[0].pulseMetrics.churnProb).toBe(35)
    expect(clients[0].pulseMetrics.riskScore).toBe(20)
  })

  it('returns [] (not error) when there are truly no approved profiles', async () => {
    state.stub = makeSbStub({ profiles: [] })
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const { clients } = await res.json()
    expect(clients).toEqual([])
  })
})
