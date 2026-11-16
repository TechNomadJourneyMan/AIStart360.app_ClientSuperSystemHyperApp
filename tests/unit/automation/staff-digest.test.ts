/**
 * Утренняя сводка персоналу (F-060): группировка задач по исполнителю,
 * SLA заявок, одна сводка админам в сутки. Ничего реального не уходит.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StaffTask } from '@/lib/automation/data'

const h = vi.hoisted(() => ({
  pending: [] as Array<{ userId: string; createdAt: string }>,
  paid: [] as Array<{ userId: string; createdAt: string }>,
  /** The journal of client notices (automation_sends): what each client was told, and when. */
  journal: [] as Array<{ userId: string; stage: 'd7' | 'd1' | 'ended'; endsAt: string; sentAt: string }>,
  noticesSince: [] as string[],
  tasks: [] as StaffTask[],
  counts: { registrations: 0, surveysCompleted: 0, griCompleted: 0 },
  sends: [] as Array<{ dedupeKey: string | null }>,
  countsRange: [] as string[],
  email: vi.fn(),
  feed: vi.fn(),
  admins: vi.fn(),
}))

vi.mock('@/lib/automation/data', () => ({
  fetchPendingRequests: async () => h.pending,
  fetchOpenPaidRequests: async () => h.paid,
  fetchProNoticesSince: async (since: string) => {
    h.noticesSince.push(since)
    return h.journal.filter((j) => j.sentAt >= since).map(({ userId, stage, endsAt }) => ({ userId, stage, endsAt }))
  },
  fetchOverdueStaffTasks: async () => h.tasks,
  fetchDayCounts: async (from: string, to: string) => {
    h.countsRange = [from, to]
    return h.counts
  },
  fetchProfileLabels: async (ids: string[]) => new Map(ids.map((id) => [id, `Клиент ${id}`])),
}))
vi.mock('@/lib/notifications/store', () => ({
  getRecipient: async (id: string) => ({ id, email: `${id}@team.example`, fullName: null, telegramChatId: null, preferences: {} }),
  countCapTouches: async () => 0,
  claimSend: async (input: { dedupeKey: string | null }) => {
    if (input.dedupeKey && h.sends.some((s) => s.dedupeKey === input.dedupeKey)) return { result: 'duplicate', id: null }
    h.sends.push({ dedupeKey: input.dedupeKey })
    return { result: 'claimed', id: String(h.sends.length) }
  },
  releaseSend: async () => undefined,
}))
vi.mock('@/lib/email/send', () => ({
  sendTransactionalEmail: async (input: unknown) => {
    h.email(input)
    return { ok: true }
  },
}))
vi.mock('@/lib/notifications/create', () => ({
  createNotification: async (input: unknown) => {
    h.feed(input)
    return true
  },
}))
vi.mock('@/lib/telegram', () => ({ sendTelegramMessage: async () => false }))
vi.mock('@/lib/settings/store', () => ({ getSetting: async (key: string) => (key === 'request_sla_hours' ? 4 : undefined) }))
vi.mock('@/lib/notifications', () => ({
  notifyAdmins: async (...args: unknown[]) => {
    h.admins(...args)
  },
}))

const { groupTasksByAssignee, summarizePending, buildStaffSummaryLines, runStaffDigest } = await import('@/lib/automation/staff-digest')

// 08:00 Алматы, 24.09.2026.
const NOW = new Date('2026-09-24T03:00:00Z')
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 3_600_000).toISOString()

const task = (id: string, assigneeId: string | null, dueHoursAgo: number, clientId: string | null = 'c1'): StaffTask => ({
  id, assigneeId, clientId, title: `Задача ${id}`, dueAt: hoursAgo(dueHoursAgo),
})

beforeEach(() => {
  h.pending = []
  h.paid = []
  h.journal = []
  h.noticesSince = []
  h.tasks = []
  h.counts = { registrations: 0, surveysCompleted: 0, griCompleted: 0 }
  h.sends = []
  h.email.mockReset()
  h.feed.mockReset()
  h.admins.mockReset()
})

describe('staff digest — чистые функции', () => {
  it('группирует задачи по исполнителю, старые первыми; без исполнителя — отдельно', () => {
    const g = groupTasksByAssignee([task('a', 'm1', 2), task('b', 'm2', 30), task('c', 'm1', 50), task('d', null, 5)])
    expect(g.get('m1')!.map((t) => t.id)).toEqual(['c', 'a'])
    expect(g.get('m2')!.map((t) => t.id)).toEqual(['b'])
    expect(g.get(null)!.map((t) => t.id)).toEqual(['d'])
  })

  it('SLA: считает заявки старше срока и возраст самой старой', () => {
    const s = summarizePending([{ userId: 'x', createdAt: hoursAgo(2) }, { userId: 'y', createdAt: hoursAgo(6) }, { userId: 'z', createdAt: hoursAgo(30) }], 4, NOW)
    expect(s).toEqual({ pending: 3, overdue: 2, oldestHours: 30 })
  })

  it('пустая сводка, когда сказать нечего', () => {
    expect(buildStaffSummaryLines({ sla: { pending: 0, overdue: 0, oldestHours: null }, slaHours: 4, yesterday: { registrations: 0, surveysCompleted: 0, griCompleted: 0 }, unassignedOverdue: 0 })).toEqual([])
  })
})

describe('runStaffDigest', () => {
  it('каждому исполнителю — свой список; админам — одна сводка', async () => {
    h.tasks = [task('a', 'm1', 2), task('b', 'm2', 30, 'c2'), task('c', 'm1', 50), task('d', null, 5)]
    h.pending = [{ userId: 'p1', createdAt: hoursAgo(10) }]
    h.counts = { registrations: 3, surveysCompleted: 1, griCompleted: 0 }

    const stats = await runStaffDigest(NOW)

    expect(stats.assigneesNotified).toBe(2)
    const mails = h.email.mock.calls.map((c) => c[0] as { to: string; dedupeKey: string; kind: string; subject: string })
    expect(mails.map((m) => m.dedupeKey).sort()).toEqual(['staff_tasks:m1:2026-09-24', 'staff_tasks:m2:2026-09-24'])
    expect(mails.every((m) => m.kind === 'staff_tasks')).toBe(true)
    const m1 = mails.find((m) => m.to === 'm1@team.example')!
    expect(m1.subject).toContain('Просроченных задач: 2')
    // Лента исполнителя — категория team, ссылка на карточку клиента самой старой задачи.
    const feed = h.feed.mock.calls.map((c) => c[0] as { userId: string; category: string; link: string }).find((f) => f.userId === 'm1')!
    expect(feed).toMatchObject({ category: 'team', link: '/admin-giga-panel/users/c1' })

    expect(h.admins).toHaveBeenCalledTimes(1)
    const [type, data] = h.admins.mock.calls[0] as [string, { lines: string[]; title: string }]
    expect(type).toBe('staff_digest')
    // R4 (N4B-1): a pending REGISTRATION is called a registration, not a request for access.
    expect(data.title).toContain('1 регистрация ждёт одобрения')
    expect(data.lines.join('\n')).toContain('Регистрации ждут одобрения — дольше 4 ч: 1 из 1. Самая старая — 10 часов')
    expect(data.lines.join('\n')).not.toContain('Заявки на оплату')
    expect(data.lines.join('\n')).toContain('без исполнителя: 1')
    expect(data.lines.join('\n')).toContain('регистраций — 3')
    // «Вчера» — сутки по Алматы: 23.09 00:00 (UTC+5) … 24.09 00:00.
    expect(h.countsRange).toEqual(['2026-09-22T19:00:00.000Z', '2026-09-23T19:00:00.000Z'])
  })

  it('повторный запуск в те же сутки ничего не дублирует', async () => {
    h.tasks = [task('a', 'm1', 2)]
    h.pending = [{ userId: 'p1', createdAt: hoursAgo(10) }]
    await runStaffDigest(NOW)
    await runStaffDigest(NOW)
    expect(h.email).toHaveBeenCalledTimes(1)
    expect(h.admins).toHaveBeenCalledTimes(1)
  })

  it('R4 (N4B-1): заявки на ОПЛАТУ — отдельной строкой и в заголовке; регистрации — своей', async () => {
    h.paid = [{ userId: 'c1', createdAt: hoursAgo(30) }, { userId: 'c2', createdAt: hoursAgo(2) }]
    h.pending = [{ userId: 'p1', createdAt: hoursAgo(1) }]
    const stats = await runStaffDigest(NOW)
    expect(stats).toMatchObject({ paidPending: 2, paidOverSla: 1, pending: 1, pendingOverSla: 0 })
    const [, data] = h.admins.mock.calls[0] as [string, { lines: string[]; title: string }]
    expect(data.title).toBe('Утренняя сводка: 1 заявка на оплату ждёт')
    expect(data.lines[0]).toBe('💳 Заявки на оплату — дольше 4 ч: 1 из 2. Самая старая — 30 часов.')
    expect(data.lines[1]).toBe('Регистрации ждут одобрения: 1 (все моложе 4 ч).')
  })

  it('R4 (N4B-10, ревью WB-3): окончание Pro — каждый клиент и этап ОДИН раз (7 дней / сутки / закончился), как клиенту', async () => {
    const END = '2026-09-30T23:59:59.000Z'
    // Ночью 24.09 (00:15 UTC) клиент c1 получил «через 7 дней», c2 — «закончился».
    h.journal = [
      { userId: 'c1', stage: 'd7', endsAt: END, sentAt: '2026-09-24T00:15:00.000Z' },
      { userId: 'c2', stage: 'ended', endsAt: '2026-09-23T23:59:59.000Z', sentAt: '2026-09-24T00:15:00.000Z' },
    ]
    const first = await runStaffDigest(NOW)
    expect(first).toMatchObject({ proEnding: 1, proEnded: 1, adminSummarySent: true })
    // окно — сутки до сводки
    expect(h.noticesSince).toEqual([new Date(NOW.getTime() - 24 * 3_600_000).toISOString()])
    const text = (h.admins.mock.calls[0][1] as { lines: string[] }).lines.join('\n')
    expect(text).toContain('Платный доступ кончается в течение недели (клиент предупреждён): 1 — Клиент c1 (30 сентября)')
    expect(text).toContain('Платный доступ закончился, кабинет переведён на бесплатный: 1 — Клиент c2 (23 сентября)')

    // Следующие утра: c1 всё ещё в 7-дневном окне, но нового предупреждения нет → в сводке его нет.
    for (let day = 1; day <= 5; day += 1) {
      const next = await runStaffDigest(new Date(NOW.getTime() + day * 24 * 3_600_000))
      expect(next.proEnding, `day +${day}`).toBe(0)
      expect(next.proEnded, `day +${day}`).toBe(0)
    }
    // За сутки до конца клиент получил «меньше чем через сутки» — и персонал видит это один раз.
    h.journal.push({ userId: 'c1', stage: 'd1', endsAt: END, sentAt: '2026-09-30T00:15:00.000Z' })
    h.pending = [{ userId: 'p1', createdAt: '2026-09-30T00:00:00.000Z' }] // чтобы сводка вообще ушла
    h.admins.mockReset()
    const d1 = await runStaffDigest(new Date('2026-09-30T03:00:00Z'))
    expect(d1.proEnding).toBe(1)
    expect((h.admins.mock.calls[0][1] as { lines: string[] }).lines.join('\n')).toContain('Платный доступ кончается в течение суток (клиент предупреждён): 1 — Клиент c1 (30 сентября)')
  })

  it('тихий день — без сводки админам', async () => {
    const stats = await runStaffDigest(NOW)
    expect(stats.adminSummarySent).toBe(false)
    expect(h.admins).not.toHaveBeenCalled()
  })
})
