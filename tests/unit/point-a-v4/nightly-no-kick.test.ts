/**
 * N4A-13 (R4-A2) — the nightly Point A pass (Inngest cron point-a-nightly, 22:00 UTC) queued every
 * company with an answered questionnaire AND sent one Inngest event per company. Those events started
 * N runs of point-a-recalc at once, and nearly all of them found nothing due: the rows are spread over
 * the hour. Now the pass only queues (`kick: false`); the minute drain of the agents loop takes each
 * row when it is due (every minute, also in the quiet mode — tests/unit/agents/cron-route.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  send: vi.fn(async () => ({ ids: ['e'] })),
  executeRaw: vi.fn(async () => 1),
  queryRaw: vi.fn(async () => [] as Array<{ id: string }>),
}))

vi.mock('@/lib/db', () => ({ prisma: { $executeRaw: h.executeRaw, $queryRaw: h.queryRaw } }))
vi.mock('@/lib/settings/store', () => ({ getSetting: async () => true }))
vi.mock('@/lib/inngest', () => ({
  inngest: {
    createFunction: (opts: unknown, fn: unknown) => ({ opts, fn }),
    send: h.send,
  },
}))

const { pointANightly } = await import('@/lib/functions/point-a')
const nightly = pointANightly as unknown as { fn: () => Promise<{ companies: number; queued: number }>; opts: { triggers: unknown } }

beforeEach(() => {
  vi.clearAllMocks()
  // Inngest is configured: before the change every queued company was also sent as an event
  vi.stubEnv('INNGEST_EVENT_KEY', 'test-key')
  h.queryRaw.mockResolvedValue(Array.from({ length: 13 }, (_, i) => ({ id: `company-${i}` })))
})

describe('N4A-13 point-a-nightly', () => {
  it('queues every company (13, as on production) and sends no event at all', async () => {
    const result = await nightly.fn()

    expect(result).toMatchObject({ companies: 13, queued: 13 })
    expect(h.send).not.toHaveBeenCalled()
    // 13 queue upserts + the snapshot retention
    expect(h.executeRaw).toHaveBeenCalledTimes(14)
  })

  it('still runs at 22:00 UTC', () => {
    expect(nightly.opts.triggers).toEqual([{ cron: '0 22 * * *' }])
  })
})
