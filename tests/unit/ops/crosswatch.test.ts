/**
 * lib/ops/crosswatch.ts — the cross-watch (R4-A1, N4A-2): the agents service checks the portal's
 * readiness and its own database, and alarms straight to Telegram (no database): after two failed
 * checks in a row, then at most every 6 hours, and once «recovered». The portal's address: the
 * private PORTAL_SERVICE_URL first, else the public NEXT_PUBLIC_APP_URL.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { portalTarget, probePortal, resetCrosswatchState, runCrosswatch } from '@/lib/ops/crosswatch'
import type { OpsDirectAlert } from '@/lib/notifications/ops-direct'

const H = 3600_000

function portal(answer: () => Response | Promise<Response>) {
  const calls: string[] = []
  const impl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push(String(url))
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    return answer()
  })
  return { impl: impl as unknown as typeof fetch, calls }
}
const healthy = () => new Response(JSON.stringify({ ok: true }), { status: 200 })
const notReady = () => new Response(JSON.stringify({ ok: false, checks: { db: 'fail', config: 'ok', queue: 'ok', jobs: 'fail' } }), { status: 503 })
const refused = () => { throw new TypeError('fetch failed') }

beforeEach(() => resetCrosswatchState())

describe('portalTarget', () => {
  it('the private address first, then the public one; junk is ignored; a trailing slash is dropped', () => {
    expect(portalTarget({ PORTAL_SERVICE_URL: 'http://portal.railway.internal:8080/', NEXT_PUBLIC_APP_URL: 'https://portal.example.app' }))
      .toEqual({ url: 'http://portal.railway.internal:8080', via: 'private' })
    expect(portalTarget({ PORTAL_SERVICE_URL: 'not a url', NEXT_PUBLIC_APP_URL: 'https://portal.example.app' }))
      .toEqual({ url: 'https://portal.example.app', via: 'public' })
    expect(portalTarget({ PORTAL_SERVICE_URL: 'ftp://x' })).toBeNull()
    expect(portalTarget({})).toBeNull()
  })
})

describe('probePortal', () => {
  it('200 is fine; 503 names the failed checks in Russian; other codes and errors are «down»', async () => {
    expect(await probePortal('http://p', portal(healthy).impl)).toBeNull()
    expect(await probePortal('http://p', portal(notReady).impl)).toEqual({
      key: 'portal:not_ready', title: 'Портал отвечает, но не готов', detail: 'не прошли проверки: база данных, задачи по расписанию',
    })
    expect(await probePortal('http://p', portal(() => new Response('', { status: 502 })).impl)).toMatchObject({ key: 'portal:down', detail: expect.stringContaining('502') })
    expect(await probePortal('http://p', portal(refused).impl)).toMatchObject({ key: 'portal:down', detail: expect.stringContaining('нет соединения') })
    const timeout = portal(() => { throw Object.assign(new Error('aborted'), { name: 'TimeoutError' }) })
    expect(await probePortal('http://p', timeout.impl)).toMatchObject({ key: 'portal:down', detail: 'нет ответа за 10 с' })
  })

  it('calls /api/health of the target', async () => {
    const p = portal(healthy)
    await probePortal('http://portal.railway.internal:8080', p.impl)
    expect(p.calls).toEqual(['http://portal.railway.internal:8080/api/health'])
  })
})

describe('runCrosswatch', () => {
  let clock: number
  let alerts: OpsDirectAlert[]
  let errors: string[]
  let answer: () => Response | Promise<Response>
  let dbOk: boolean

  beforeEach(() => {
    clock = Date.parse('2026-11-16T12:00:00Z')
    alerts = []
    errors = []
    answer = healthy
    dbOk = true
  })

  const run = (env: Record<string, string> = { PORTAL_SERVICE_URL: 'http://portal.railway.internal:8080' }) =>
    runCrosswatch({
      env,
      fetchImpl: portal(() => answer()).impl,
      now: () => new Date(clock),
      checkDb: async () => dbOk,
      alert: async (a) => { alerts.push(a) },
      logError: (l) => errors.push(l),
    })
  const step = (ms = 3 * 60_000) => { clock += ms }

  it('all fine: nothing said', async () => {
    expect(await run()).toEqual({ status: 'ok', target: 'private', problems: [], alerted: [], recovered: [] })
    expect(alerts).toEqual([])
    expect(errors).toEqual([])
  })

  it('one failed check is only a log line; the second in a row is the alarm (CRITICAL, direct)', async () => {
    answer = refused
    const first = await run()
    expect(first).toMatchObject({ status: 'problems', problems: ['portal:down'], alerted: [] })
    expect(alerts).toEqual([])
    expect(errors).toHaveLength(1)

    step()
    const second = await run()
    expect(second.alerted).toEqual(['portal:down'])
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({ level: 'CRITICAL', title: 'Портал не отвечает' })
    expect(alerts[0].lines?.join(' ')).toContain('частная сеть')
  })

  it('a blip (one failure, then fine) never alarms and never says «recovered»', async () => {
    answer = refused
    await run()
    answer = healthy
    step()
    const res = await run()
    expect(res.recovered).toEqual([])
    expect(alerts).toEqual([])
  })

  it('then at most every 6 hours; when it clears, one «recovered»', async () => {
    answer = notReady
    await run(); step(); await run() // alarm
    for (let i = 0; i < 10; i += 1) { step(); await run() } // 30 more minutes
    expect(alerts).toHaveLength(1)
    step(6 * H)
    await run()
    expect(alerts).toHaveLength(2)

    answer = healthy
    step()
    const res = await run()
    expect(res.recovered).toEqual(['portal:not_ready'])
    expect(alerts[2]).toMatchObject({ level: 'SUCCESS' })
    step()
    await run()
    expect(alerts).toHaveLength(3)
  })

  // RB-8: «does not answer» and «not ready» are one series of the portal.
  it('a portal that flips between «no answer» and «not ready» is one series: the alarm comes on the second check', async () => {
    const kinds = [refused, notReady, refused, notReady, refused, notReady]
    const results = []
    for (const kind of kinds) {
      answer = kind
      results.push(await run())
      step()
    }
    expect(results[1].alerted).toEqual(['portal:not_ready'])
    expect(alerts.filter((a) => a.level === 'CRITICAL')).toHaveLength(1)
    // no «recovered» while the portal is still failing, whatever the kind
    expect(alerts.filter((a) => a.level === 'SUCCESS')).toEqual([])
    expect(results.every((r) => r.recovered.length === 0)).toBe(true)

    answer = healthy
    const back = await run()
    expect(back.recovered).toEqual(['portal:not_ready'])
    expect(alerts.filter((a) => a.level === 'SUCCESS')).toHaveLength(1)
  })

  it('its own database not answering is a problem of its own', async () => {
    dbOk = false
    await run(); step()
    const res = await run()
    expect(res.alerted).toEqual(['db:down'])
    expect(alerts[0].title).toMatch(/База данных/)
  })

  it('without a portal address: only the database is checked, the status says not_configured', async () => {
    const res = await run({})
    expect(res).toEqual({ status: 'not_configured', target: null, problems: [], alerted: [], recovered: [] })
  })

  it('a database check that throws counts as down', async () => {
    const res = await runCrosswatch({
      env: {}, now: () => new Date(clock), checkDb: async () => { throw new Error('pool timeout') },
      alert: async (a) => { alerts.push(a) }, logError: () => {},
    })
    expect(res.problems).toEqual(['db:down'])
  })
})
