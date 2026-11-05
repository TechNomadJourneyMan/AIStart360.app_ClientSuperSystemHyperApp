import { describe, it, expect, vi, beforeEach } from 'vitest'

// A keystroke autosave only queues the recalculation (2026-11-02): no Inngest
// event and no background drain per request — one kick per minute does that.
const executeRaw = vi.fn(async () => 1)
const send = vi.fn(async () => undefined)
vi.mock('@/lib/db', () => ({ prisma: { $executeRaw: executeRaw } }))
vi.mock('@/lib/settings/store', () => ({ getSetting: async () => true }))
vi.mock('@/lib/inngest', () => ({ inngest: { send } }))

describe('requestPointARecalc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.INNGEST_EVENT_KEY = 'test'
  })

  it('kick: false queues (slides the due time) but sends nothing', async () => {
    const { requestPointARecalc } = await import('@/lib/point-a/recalc-queue')
    expect(await requestPointARecalc('co', 'SURVEY_ANSWER_CHANGED', 20_000, { kick: false })).toBe(true)
    expect(executeRaw).toHaveBeenCalledTimes(1)
    expect(send).not.toHaveBeenCalled()
  })

  it('by default it queues and kicks the drain', async () => {
    const { requestPointARecalc } = await import('@/lib/point-a/recalc-queue')
    expect(await requestPointARecalc('co', 'SURVEY_ANSWER_CHANGED')).toBe(true)
    expect(executeRaw).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({ name: 'point-a/recalc.requested', data: { companyId: 'co' } })
  })
})
