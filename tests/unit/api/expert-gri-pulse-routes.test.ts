/**
 * Expert GRI and Pulse tabs show only the client's real data: no sample GRI
 * scores, no risk or "days without an order" derived from unrelated fields.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ rows: null as unknown, paths: [] as string[] }))
vi.mock('@/lib/expert-auth', () => ({
  requireExpert: async () => ({ id: 'expert-1', role: 'expert' }),
  resolveExpert: async () => ({ ok: true, viewer: { id: 'expert-1', role: 'expert', email: null } }),
  expertBlockResponse: () => new Response(null, { status: 403 }),
  srGet: async (path: string) => { state.paths.push(path); return state.rows },
}))

import { GET as griGET } from '@/app/api/expert/clients/[id]/gri/route'
import { GET as pulseGET } from '@/app/api/expert/clients/[id]/pulse/route'

const CLIENT = '11111111-1111-4111-8111-111111111111'
type Handler = (req: Request, ctx: { params: { id: string } }) => Promise<Response>
const call = (fn: Handler, id = CLIENT) => fn(new Request('http://x'), { params: { id } })

beforeEach(() => { state.rows = null; state.paths = [] })

describe('expert GRI tab', () => {
  it('returns the latest assessment scores mapped to the tab categories', async () => {
    state.rows = [{ gri_index: '6.43', section_avgs: { 'product-demand': 7, 'owner-readiness': 5.5, team: '4' }, updated_at: '2026-10-01T00:00:00Z', created_at: '2026-09-01T00:00:00Z' }]
    const body = await (await call(griGET)).json()
    expect(body.data).toMatchObject({ hasAssessment: true, overall: 6.43, lastCalculatedAt: '2026-10-01T00:00:00Z' })
    expect(body.data.categoryScores).toMatchObject({ 'Product & Demand': 7, 'Founder Ready': 5.5, Team: 4, 'Business Model': null })
    expect(state.paths[0]).toContain('gri_assessments?user_id=eq.')
  })

  it('without an assessment every score is null — no sample scores', async () => {
    state.rows = []
    const body = await (await call(griGET)).json()
    expect(body.data.hasAssessment).toBe(false)
    expect(body.data.overall).toBeNull()
    expect(Object.values(body.data.categoryScores).every((v) => v === null)).toBe(true)
  })

  it('a failed read (srGet null) is an error, not «клиент не проходил GRI»', async () => {
    state.rows = null
    const res = await call(griGET)
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.data).toBeUndefined()
  })

  it('rejects a malformed client id before querying', async () => {
    expect((await call(griGET, 'x&select=*')).status).toBe(400)
    expect(state.paths).toEqual([])
  })
})

describe('expert Pulse tab', () => {
  it('reports only metrics a source provided; nothing derived from the Point A score or diagnostic date', async () => {
    state.rows = [{ ai_analysis: null }]
    const body = await (await call(pulseGET)).json()
    expect(Object.values(body.data).every((v) => v === null)).toBe(true)
    expect(state.paths[0]).not.toContain('updated_at')
  })

  it('passes through explicit pulse metrics', async () => {
    state.rows = [{ ai_analysis: { pulse: { avgCheck: 120000, riskScore: 35 } } }]
    const body = await (await call(pulseGET)).json()
    expect(body.data).toMatchObject({ avgCheck: 120000, riskScore: 35, daysSince: null })
  })
})
