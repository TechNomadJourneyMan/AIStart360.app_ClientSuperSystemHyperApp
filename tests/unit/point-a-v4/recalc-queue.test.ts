import { afterEach, describe, it, expect, vi } from 'vitest'
import { drainPointARecalc, POINT_A_TRIGGER_EVENTS, type DrainDeps } from '@/lib/point-a/recalc-queue'

vi.mock('@/lib/db', () => ({ prisma: {} }))
// drainInBackground must never reach the real drain (it talks to the database): only record that it was started.
const background = vi.hoisted(() => ({ run: vi.fn(async () => {}) }))
vi.mock('@/lib/background', () => ({ runInBackground: background.run }))

function deps(queue: Array<{ company_id: string; reasons: string[] }>, build: DrainDeps['build']) {
  const finished: string[] = []
  const failed: Array<{ id: string; error: string }> = []
  const d: DrainDeps = {
    claim: vi.fn(async (limit: number, companyId?: string) => {
      const picked = queue.filter((q) => !companyId || q.company_id === companyId).slice(0, limit)
      for (const p of picked) queue.splice(queue.indexOf(p), 1)
      return picked.map((p) => ({ ...p, started_at: new Date(), attempts: 1 }))
    }) as unknown as DrainDeps['claim'],
    finish: vi.fn(async (c) => { finished.push(c.company_id) }) as unknown as DrainDeps['finish'],
    fail: vi.fn(async (c, error: string) => { failed.push({ id: c.company_id, error }) }) as unknown as DrainDeps['fail'],
    build,
  }
  return { d, finished, failed }
}

describe('drainPointARecalc', () => {
  it('builds every due company once and finishes it', async () => {
    const build = vi.fn(async () => ({ status: 'written' }))
    const { d, finished } = deps([{ company_id: 'a', reasons: ['SURVEY_ANSWER_CHANGED'] }, { company_id: 'b', reasons: ['FILE_PROCESSED', 'METRIC_UPDATED'] }], build)
    const r = await drainPointARecalc({ budgetMs: 5_000 }, d)
    expect(build).toHaveBeenCalledWith('b', ['FILE_PROCESSED', 'METRIC_UPDATED'])
    expect(finished.sort()).toEqual(['a', 'b'])
    expect(r.done).toHaveLength(2)
  })

  it('a failed build is retried later, the rest goes on', async () => {
    const build = vi.fn(async (id: string) => { if (id === 'a') throw new Error('boom'); return { status: 'unchanged' } })
    const { d, finished, failed } = deps([{ company_id: 'a', reasons: [] }, { company_id: 'b', reasons: [] }], build)
    const r = await drainPointARecalc({ budgetMs: 5_000 }, d)
    expect(failed).toEqual([{ id: 'a', error: 'boom' }])
    expect(finished).toEqual(['b'])
    expect(r.failed).toHaveLength(1)
  })

  it('one company only (the debounced Inngest function)', async () => {
    const build = vi.fn(async () => ({ status: 'written' }))
    const { d } = deps([{ company_id: 'a', reasons: [] }, { company_id: 'b', reasons: [] }], build)
    await drainPointARecalc({ companyId: 'b' }, d)
    expect(build).toHaveBeenCalledTimes(1)
    expect(build).toHaveBeenCalledWith('b', [])
  })

  it('trigger events: data changes, never the recalculation\'s own POINT_A_UPDATED / DISCREPANCY_FOUND', () => {
    expect(POINT_A_TRIGGER_EVENTS.has('SURVEY_ANSWER_CHANGED')).toBe(true)
    expect(POINT_A_TRIGGER_EVENTS.has('DOCUMENT_DELETED')).toBe(true)
    expect(POINT_A_TRIGGER_EVENTS.has('POINT_A_UPDATED')).toBe(false)
    expect(POINT_A_TRIGGER_EVENTS.has('DISCREPANCY_FOUND')).toBe(false)
  })
})

describe('drainInBackground', () => {
  it('does nothing outside Vercel (tests, local dev on the production DB)', async () => {
    const { drainInBackground } = await import('@/lib/point-a/recalc-queue')
    const prev = process.env.VERCEL
    delete process.env.VERCEL
    expect(() => drainInBackground('co')).not.toThrow()
    process.env.VERCEL = prev
  })

  describe('where the work outlives the response', () => {
    afterEach(() => {
      vi.unstubAllEnvs()
      background.run.mockClear()
    })
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

    it('starts the background drain on Vercel', async () => {
      const { drainInBackground } = await import('@/lib/point-a/recalc-queue')
      vi.stubEnv('VERCEL', '1')
      drainInBackground('co')
      await flush()
      expect(background.run).toHaveBeenCalledWith('point-a-recalc', expect.any(Function))
    })

    it('starts the background drain on a persistent server (PERSISTENT_SERVER=1)', async () => {
      const { drainInBackground } = await import('@/lib/point-a/recalc-queue')
      vi.stubEnv('VERCEL', '')
      vi.stubEnv('PERSISTENT_SERVER', '1')
      drainInBackground('co')
      await flush()
      expect(background.run).toHaveBeenCalledWith('point-a-recalc', expect.any(Function))
    })

    it('starts nothing without a flag', async () => {
      const { drainInBackground } = await import('@/lib/point-a/recalc-queue')
      vi.stubEnv('VERCEL', '')
      vi.stubEnv('PERSISTENT_SERVER', '')
      drainInBackground('co')
      await flush()
      expect(background.run).not.toHaveBeenCalled()
    })
  })
})
