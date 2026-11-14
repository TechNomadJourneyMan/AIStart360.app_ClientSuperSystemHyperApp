/**
 * R2-A: Point A is paid, but the express assessment («Снимок бизнеса» after the
 * express survey) stays free. GET /api/v1/point-a/state answers a Free account
 * 402 for the full page and ONLY the express slice for ?view=express.
 */
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { expressPointASlice } from '@/lib/survey/snapshot'

const s = vi.hoisted(() => ({ gates: true, tier: 'free' as 'free' | 'pro', recalcRequested: 0 }))

const STATE = {
  snapshot: {
    id: 'snap-1', createdAt: '2026-11-10T10:00:00Z', engine: 'v4', assessment: 'full', trigger: 'survey',
    overall: 61, confidence: 0.7, coverage: 0.8, stage: 'growth', healthIndex: 55,
    blocks: [{ key: 'finance', title: 'Финансы', weight: 0.2, hiddenForClient: false, informational: false, order: 1, status: 'ok', score: 64, coverage: 0.9, confidence: 0.8, earned: 1, possible: 2, checks: [{ id: 'secret-check' }], top_issues: ['Нет учёта маржи'], recommendations: ['secret-reco'], needs: [], conflicts: [], inputsHash: 'h' }],
    strengths: [{ block: 'finance', title: 'x', score: 1, checks: [] }],
    uploadChecklist: [{ block: 'finance', gain: 5, extra: 'x' }],
    changeReasons: [], metrics: [{ id: 'revenue', label: 'Выручка', unit: '₸', value: 1000, source: 'survey', period: null }],
    reviewedBy: null, reviewedAt: null, reviewedByName: null,
  },
  history: [{ id: 'h1', createdAt: '2026-11-01', overall: 50, confidence: 0.5, changes: [] }],
  discrepancies: [{ id: 'd1' }],
  goals: [{ id: 'g1' }],
  gri: { index100: 70, assessedAt: null },
  benchmarks: { industry: 'retail', stage: 'growth', source: 'x', overall: 60, blocks: [] },
  sources: { survey: { percent: 100, completed: 30, total: 30, authors: {}, lastChangedAt: null }, documents: { parsed: 0, processing: 0, failed: 0 }, metrics: 1 },
  recalculation: 'idle',
  comments: [{ id: 'c1', body: 'expert note' }],
}

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) }, rpc: async () => ({ data: false }) }) }))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => ({}) }))
vi.mock('@/lib/tenancy', async () => {
  const real = await vi.importActual<Record<string, unknown>>('@/lib/tenancy')
  return { ...real, resolveTenantWith: async () => ({ ok: true, tenant: { companyId: 'c-1', canManage: true, role: 'owner' } }) }
})
vi.mock('@/lib/settings/system-settings', () => ({ getAccessGatesEnabled: async () => s.gates }))
vi.mock('@/lib/access/server', async () => {
  const ent = await import('@/lib/access/entitlements')
  return { readEntitlements: async () => ent.entitlementsFor(s.tier) }
})
vi.mock('@/lib/api-identity', async () => {
  const real = await vi.importActual<typeof import('@/lib/api-identity')>('@/lib/api-identity')
  return { ...real, getSessionRole: async () => 'client', getSessionStaff: async () => null }
})
vi.mock('@/lib/point-a/v4/state', () => ({ loadPointAState: async () => structuredClone(STATE) }))
vi.mock('@/lib/point-a/recalc-queue', () => ({ drainInBackground: () => undefined, requestPointARecalc: async () => { s.recalcRequested += 1; return true } }))

const { GET } = await import('@/app/api/v1/point-a/state/route')
const get = (q = '') => GET(new NextRequest(`http://t/api/v1/point-a/state${q}`))

beforeEach(() => {
  s.gates = true
  s.tier = 'free'
  s.recalcRequested = 0
})

describe('GET /api/v1/point-a/state for a Free account', () => {
  it('the full page → 402 upgrade_required (feature point_a)', async () => {
    const res = await get()
    expect(res.status).toBe(402)
    expect(await res.json()).toMatchObject({ ok: false, error: 'upgrade_required', feature: 'point_a' })
  })

  it('?view=express → only what the free snapshot shows, nothing of the paid page', async () => {
    const res = await get('?view=express')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.view).toBe('express')
    expect(Object.keys(body.data).sort()).toEqual(['recalculation', 'snapshot'])
    expect(body.data.snapshot.overall).toBe(61)
    expect(body.data.snapshot.blocks[0]).toEqual({ key: 'finance', title: 'Финансы', score: 64, status: 'ok', coverage: 0.9, weight: 0.2, informational: false, hiddenForClient: false, top_issues: ['Нет учёта маржи'] })
    const text = JSON.stringify(body)
    for (const leak of ['secret-check', 'secret-reco', 'expert note', 'history', 'discrepancies', 'benchmarks', 'metrics', 'goals', 'companyId']) expect(text).not.toContain(leak)
  })

  it('Pro (or gates off) gets the full state, also on the express view', async () => {
    s.tier = 'pro'
    const body = await (await get()).json()
    expect(body.data.history).toHaveLength(1)
    expect(body.data.companyId).toBe('c-1')
    s.tier = 'free'
    s.gates = false
    expect((await (await get('?view=express')).json()).data.goals).toHaveLength(1)
  })
})

describe('expressPointASlice (pure) and the snapshot screen', () => {
  it('keeps the fields of the free snapshot card only', () => {
    expect(expressPointASlice({ snapshot: null, recalculation: 'queued' })).toEqual({ snapshot: null, recalculation: 'queued' })
    const slice = expressPointASlice(STATE as never)
    expect(slice.snapshot?.uploadChecklist).toEqual([{ block: 'finance', gain: 5 }])
  })

  it('the express screens ask for the express view', () => {
    expect(readFileSync('components/onboarding/express/usePointAView.ts', 'utf8')).toContain("'/api/v1/point-a/state?view=express'")
  })
})
