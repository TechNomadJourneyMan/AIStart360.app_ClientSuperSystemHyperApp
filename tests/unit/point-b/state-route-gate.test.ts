/**
 * GET /api/v1/point-b/state: the Pro gate and the page read go out together (W4) — and the gate still
 * decides: a gated user gets the 402 (never the data, never a 500 from the read).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const s = vi.hoisted(() => ({
  started: [] as string[],
  gate: null as null | 'upgrade',
  load: 'ok' as 'ok' | 'fail',
}))

vi.mock('@/lib/supabase-server', () => ({ createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) } }) }))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => ({}) }))
vi.mock('@/lib/events/server', () => ({ trackUserAction: async () => undefined }))
vi.mock('@/lib/access/gate', () => ({
  gateFeature: async () => {
    s.started.push('gate')
    await new Promise((r) => setTimeout(r, 0))
    return s.gate ? NextResponse.json({ ok: false, error: 'upgrade_required' }, { status: 402 }) : null
  },
}))
vi.mock('@/lib/point-b/model/load', () => ({
  loadPointBState: async () => {
    s.started.push('load')
    await new Promise((r) => setTimeout(r, 0))
    if (s.load === 'fail') throw new Error('db down')
    return { access: 'ok', overview: { result: { level: 1 } }, plan: { status: 'none' } }
  },
}))

const route = await import('@/app/api/v1/point-b/state/route')

beforeEach(() => {
  s.started = []
  s.gate = null
  s.load = 'ok'
})

describe('GET /api/v1/point-b/state — gate and read together (W4)', () => {
  it('both start before either answers; the data comes back', async () => {
    const res = await route.GET()
    expect(res.status).toBe(200)
    expect(s.started.sort()).toEqual(['gate', 'load'])
    expect((await res.json()).data.access).toBe('ok')
  })

  it('a gated user gets the 402 — also when the read failed', async () => {
    s.gate = 'upgrade'
    expect((await route.GET()).status).toBe(402)
    s.load = 'fail'
    const res = await route.GET()
    expect(res.status).toBe(402)
    expect(JSON.stringify(await res.json())).not.toContain('access')
  })

  it('a failed read without a gate is the usual 500 without internals', async () => {
    s.load = 'fail'
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await route.GET()
    err.mockRestore()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ ok: false, error: 'Не удалось загрузить Точку Б' })
  })
})
