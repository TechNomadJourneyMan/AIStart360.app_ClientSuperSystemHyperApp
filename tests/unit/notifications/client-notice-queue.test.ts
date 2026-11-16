/**
 * R4 ревью WB-5: массовые «Отклонить» и «Тариф Pro» не ждут письмо Resend на
 * каждого клиента внутри запроса. Уведомления уходят из очереди процесса — не
 * больше двух одновременно (правило проекта для фоновой работы), по порядку.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const g = vi.hoisted(() => ({
  opened: [] as Array<{ userId: string; input: Record<string, unknown> }>,
  release: [] as Array<() => void>,
}))

vi.mock('@/lib/notifications/product', () => ({
  notifyPaidAccessOpened: (userId: string, input: Record<string, unknown>) => new Promise((resolve) => {
    g.opened.push({ userId, input })
    g.release.push(() => resolve({ ok: true, delivered: { inApp: true, email: true, telegram: false } }))
  }),
}))
vi.mock('@/lib/audit', () => ({ logAudit: async () => undefined }))

const queue = await import('@/lib/notifications/client-notice-queue')
const { completePaidAccessGrant } = await import('@/lib/access/paid-access-grant')

function deferred() {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((r) => { resolve = r })
  return { promise, resolve }
}

beforeEach(() => {
  g.opened = []
  g.release = []
})

describe('the queue of client notices', () => {
  it('at most two at a time, the rest wait in order; every one runs', async () => {
    const gates = Array.from({ length: 5 }, deferred)
    const started: number[] = []
    const done = gates.map((gate, i) => queue.enqueueClientNotice('t', async () => { started.push(i); await gate.promise }))
    await vi.waitFor(() => expect(started).toEqual([0, 1]))
    expect(queue.clientNoticeQueueSize()).toEqual({ running: 2, waiting: 3 })
    gates[1].resolve()
    await vi.waitFor(() => expect(started).toEqual([0, 1, 2]))
    for (const gate of gates) gate.resolve()
    await Promise.all(done)
    expect(started).toEqual([0, 1, 2, 3, 4])
    expect(queue.clientNoticeQueueSize()).toEqual({ running: 0, waiting: 0 })
  })

  it('a failing notice frees its slot (the error is logged, never thrown)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await queue.enqueueClientNotice('boom', async () => { throw new Error('resend down') })
    expect(queue.clientNoticeQueueSize()).toEqual({ running: 0, waiting: 0 })
    err.mockRestore()
  })
})

describe('«Доступ открыт» of the bulk «Тариф Pro» leaves from the queue', () => {
  const svc = () => ({
    from: () => {
      const q: Record<string, unknown> = {}
      Object.assign(q, { update: () => q, eq: () => q, in: () => q, select: async () => ({ data: [], error: null }) })
      return q
    },
  })

  it('queueNotice: the grant answers at once, while the e-mail is still being sent', async () => {
    const r = await completePaidAccessGrant({
      userId: 'c1', actor: { id: 'staff', kind: 'session' }, before: { accessTier: 'free' }, after: { accessTier: 'pro', periodEnd: null },
      via: 'bulk', queueNotice: true, svc: svc() as never,
    })
    expect(r).toMatchObject({ noticeQueued: true, notified: false })
    await vi.waitFor(() => expect(g.opened).toHaveLength(1))
    expect(g.opened[0]).toMatchObject({ userId: 'c1', input: { renewed: false } })
    for (const f of g.release) f()
  })

  it('without queueNotice (one client: «Назначить Pro», Биллинг) the answer still says whether the feed got it', async () => {
    const pending = completePaidAccessGrant({
      userId: 'c2', actor: { id: 'staff', kind: 'session' }, before: { accessTier: 'free' }, after: { accessTier: 'pro', periodEnd: null },
      via: 'billing', svc: svc() as never,
    })
    await vi.waitFor(() => expect(g.opened).toHaveLength(1))
    g.release[0]()
    expect(await pending).toMatchObject({ notified: true })
  })
})
