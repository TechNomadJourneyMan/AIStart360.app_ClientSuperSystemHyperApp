/**
 * POST /api/internal/agents/kick — the portal (PORTAL_ROLE=web) tells the agents service that a
 * task has just been queued (lib/agents/remote-kick.ts); the service starts it in the background
 * and answers at once. The secret is the cron one, checked exactly as the cron routes check it.
 * A process that does not run agent work (the web role) does not have this route at all.
 * The queue is a stub; nothing touches a database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({ executeTaskById: vi.fn() }))
vi.mock('@/lib/agents/queue', () => ({ executeTaskById: h.executeTaskById }))

import * as route from '@/app/api/internal/agents/kick/route'
import { pendingBackgroundCount, waitForBackgroundWork } from '@/lib/background'

const TASK = '3f2b7c1e-8a54-4d0b-9c6e-1f2a3b4c5d6e'
const SECRET = 'cron-secret-for-tests'
const PENDING_WORK = Symbol.for('aistart360.background.pending')

function request(body: unknown, auth: string | null = `Bearer ${SECRET}`): NextRequest {
  return new NextRequest('http://agents.railway.internal:8080/api/internal/agents/kick', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}
const kick = (body: unknown = { taskId: TASK }, auth?: string | null) => route.POST(request(body, auth))
const settled = () => waitForBackgroundWork(1000)

beforeEach(() => {
  h.executeTaskById.mockReset()
  h.executeTaskById.mockResolvedValue(null)
  vi.stubEnv('CRON_SECRET', SECRET)
  vi.stubEnv('PORTAL_ROLE', 'agents')
})

afterEach(async () => {
  await settled()
  delete (globalThis as Record<symbol, unknown>)[PENDING_WORK]
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('POST /api/internal/agents/kick', () => {
  it('is a Node route that is never cached and may run as long as the cron routes', () => {
    expect(route.runtime).toBe('nodejs')
    expect(route.dynamic).toBe('force-dynamic')
    expect(route.maxDuration).toBe(300)
    expect(Object.keys(route).sort()).toEqual(['POST', 'dynamic', 'maxDuration', 'runtime'])
  })

  it('starts the task in the background and answers 202 { ok: true }', async () => {
    const res = await kick()

    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ ok: true })
    await settled()
    expect(h.executeTaskById).toHaveBeenCalledTimes(1)
    expect(h.executeTaskById).toHaveBeenCalledWith(TASK)
  })

  it('does not wait for the task: the answer comes while the run is still going, and the run is tracked', async () => {
    let finish!: () => void
    h.executeTaskById.mockReturnValue(new Promise((resolve) => { finish = () => resolve(null) }))

    const res = await kick()

    expect(res.status).toBe(202)
    expect(h.executeTaskById).toHaveBeenCalledWith(TASK)
    expect(pendingBackgroundCount()).toBe(1) // a shutdown waits for it (lib/background.ts)

    finish()
    await settled()
    expect(pendingBackgroundCount()).toBe(0)
  })

  it('a run that fails is logged with its task and does not reach the caller', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.executeTaskById.mockRejectedValue(new Error('claim failed'))

    const res = await kick()
    await settled()

    expect(res.status).toBe(202)
    expect(error).toHaveBeenCalledWith(`[background:agent-task:${TASK}]`, 'claim failed')
  })

  it('works in one process for everything as well (PORTAL_ROLE unset)', async () => {
    vi.stubEnv('PORTAL_ROLE', '')
    expect((await kick()).status).toBe(202)
    await settled()
    expect(h.executeTaskById).toHaveBeenCalledWith(TASK)
  })
})

describe('POST /api/internal/agents/kick: the web role does not have this route', () => {
  beforeEach(() => {
    vi.stubEnv('PORTAL_ROLE', 'web')
  })

  it('404 for a correct call: agent work does not run in the portal process', async () => {
    const res = await kick()

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ ok: false, error: 'Not found' })
    await settled()
    expect(h.executeTaskById).not.toHaveBeenCalled()
  })

  it('404 before anything else: without the secret, with a bad body, without CRON_SECRET', async () => {
    expect((await kick({ taskId: TASK }, null)).status).toBe(404)
    expect((await kick({ taskId: TASK }, 'Bearer wrong')).status).toBe(404)
    expect((await kick('not json')).status).toBe(404)
    vi.stubEnv('CRON_SECRET', '')
    expect((await kick()).status).toBe(404)
    expect(h.executeTaskById).not.toHaveBeenCalled()
  })
})

describe('POST /api/internal/agents/kick: authorisation, as on the cron routes', () => {
  it('401 without the bearer secret or with a wrong one', async () => {
    for (const auth of [null, 'Bearer wrong', SECRET, `Basic ${SECRET}`, `bearer ${SECRET}`, `Bearer ${SECRET}x`]) {
      const res = await kick({ taskId: TASK }, auth)
      expect(res.status, String(auth)).toBe(401)
      expect(await res.json()).toEqual({ ok: false, error: 'Unauthorized' })
    }
    await settled()
    expect(h.executeTaskById).not.toHaveBeenCalled()
  })

  it('503 when CRON_SECRET is not configured: it fails closed', async () => {
    vi.stubEnv('CRON_SECRET', '')

    const res = await kick()

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ ok: false, error: 'CRON_SECRET не настроен' })
    expect(h.executeTaskById).not.toHaveBeenCalled()
  })

  it('the secret is checked before the body is read', async () => {
    expect((await kick('not json', 'Bearer wrong')).status).toBe(401)
  })
})

describe('POST /api/internal/agents/kick: the body is { taskId: uuid } and nothing else', () => {
  it('400 for anything else, and nothing is started', async () => {
    const bad: unknown[] = [
      'not json',
      '',
      {},
      { taskId: 'not-a-uuid' },
      { taskId: '' },
      { taskId: 42 },
      { taskId: null },
      { taskId: [TASK] },
      { taskId: `${TASK} ` },
      { taskId: TASK, extra: true }, // strict: an unknown key is refused
      { taskid: TASK },
      [TASK],
      TASK, // a bare JSON-less string
      null,
    ]
    for (const body of bad) {
      const res = await kick(body)
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect(await res.json()).toEqual({ ok: false, error: 'Bad request' })
    }
    await settled()
    expect(h.executeTaskById).not.toHaveBeenCalled()
  })

  it('a 400 says nothing about what was sent', async () => {
    const res = await kick({ taskId: 'secret-looking-value', token: 'another-one' })
    const text = await res.text()
    expect(res.status).toBe(400)
    expect(text).not.toContain('secret-looking-value')
    expect(text).not.toContain('another-one')
  })
})
