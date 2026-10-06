/**
 * GET /api/health reports only what it measures (shared with /intelligence via
 * lib/health/platform.ts): database round-trip and configuration completeness.
 * No made-up uptime, no names of missing variables.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ dbFails: false, missing: [] as string[] }))
vi.mock('@/lib/db', () => ({
  prisma: {
    $queryRaw: async () => {
      if (state.dbFails) throw new Error('connection refused')
      return [{ '?column?': 1 }]
    },
  },
}))
vi.mock('@/lib/env', () => ({ getMissingServerEnv: () => state.missing }))

import { GET } from '@/app/api/health/route'

beforeEach(() => { state.dbFails = false; state.missing = [] })

describe('GET /api/health', () => {
  it('all checks pass', async () => {
    const body = await (await GET()).json()
    expect(body.allOnline).toBe(true)
    expect(body.services.map((s: { name: string }) => s.name)).toEqual(['База данных', 'Конфигурация сервера'])
    expect(body.services.every((s: { uptime: string }) => s.uptime === 'не измеряется')).toBe(true)
  })

  it('missing configuration is counted, never named', async () => {
    state.missing = ['SUPABASE_SERVICE_ROLE_KEY', 'GIGA_COOKIE_SECRET']
    const res = await GET()
    const text = await res.text()
    const body = JSON.parse(text)
    expect(body.allOnline).toBe(false)
    expect(body.missingEnvCount).toBe(2)
    expect(text).not.toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(res.headers.get('cache-control')).toContain('no-store')
  })

  it('a failed database round-trip is reported offline', async () => {
    state.dbFails = true
    const body = await (await GET()).json()
    expect(body.services[0]).toMatchObject({ name: 'База данных', status: 'offline' })
    expect(body.allOnline).toBe(false)
  })
})
