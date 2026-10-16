/**
 * The 30-minute rule (lib/comm/escalation.ts, lib/comm/deadline.ts): the
 * deadline counted in work hours, which threads are picked, who is reminded
 * (assignee, else everyone with inbox.manage) on the expert bot and by email,
 * and that escalated_at makes it happen once. No network, no real database.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/settings/store', () => ({
  getSetting: vi.fn(async (k: string) => (k === 'comm_escalation_minutes' ? 30 : k === 'comm_bot_auto_default' ? false : null)),
}))
vi.mock('@/lib/notifications/staff', () => ({ notifyStaff: vi.fn(async () => ({ eventId: 'e', duplicate: false, deliveries: [] })) }))
vi.mock('@/lib/telegram', () => ({ sendTelegramMessage: vi.fn(async () => true) }))

import { addWorkingMinutes, replyDueAt, type WorkWindow } from '@/lib/comm/deadline'
import { claimEscalation, escalationRecipients, escalationTelegramText, runEscalations, selectOverdueThreads, type EscalationDeps } from '@/lib/comm/escalation'
import { recordInbound } from '@/lib/comm/inbound'
import { threadPatchOnOutbound } from '@/lib/comm/state'
import { buildCommEscalationEmail } from '@/lib/email/templates'
import { commDb, type Row } from './_db'

const USER = '11111111-1111-4111-8111-111111111111'
const USER2 = '22222222-2222-4222-8222-222222222222'
const EXPERT = '33333333-3333-4333-8333-333333333333'
const ADMIN = '44444444-4444-4444-8444-444444444444'
const CRM = '55555555-5555-4555-8555-555555555555'
const SUPPORT = '66666666-6666-4666-8666-666666666666'
const OWNER = '77777777-7777-4777-8777-777777777777'
const FORMER = '88888888-8888-4888-8888-888888888888'
// Friday 2026-10-16 10:00 Asia/Almaty (UTC+5).
const NOW = new Date('2026-10-16T05:00:00.000Z')
const WINDOW: WorkWindow = { days: [1, 2, 3, 4, 5], from: '09:00', to: '19:00', timeZone: 'Asia/Almaty' }

describe('reply deadline in work hours', () => {
  it('inside the window: plain minutes', () => {
    expect(addWorkingMinutes(NOW, 30, WINDOW).toISOString()).toBe('2026-10-16T05:30:00.000Z')
  })

  it('near the end of Friday: the rest moves to Monday morning', () => {
    // Fri 18:50 → 10 min on Friday + 20 min from Mon 09:00 = Mon 09:20 (04:20Z).
    expect(addWorkingMinutes(new Date('2026-10-16T13:50:00.000Z'), 30, WINDOW).toISOString()).toBe('2026-10-19T04:20:00.000Z')
  })

  it('at night / on the weekend: counted from the next window start', () => {
    // Sat 02:00 Almaty → Mon 09:30.
    expect(addWorkingMinutes(new Date('2026-10-16T21:00:00.000Z'), 30, WINDOW).toISOString()).toBe('2026-10-19T04:30:00.000Z')
    // Thu 07:00 Almaty (before the window) → Thu 09:30.
    expect(addWorkingMinutes(new Date('2026-10-15T02:00:00.000Z'), 30, WINDOW).toISOString()).toBe('2026-10-15T04:30:00.000Z')
    // Thu 19:00 sharp (window end is exclusive) → Fri 09:30.
    expect(addWorkingMinutes(new Date('2026-10-15T14:00:00.000Z'), 30, WINDOW).toISOString()).toBe('2026-10-16T04:30:00.000Z')
  })

  it('keeps the seconds of the start and spans several days for long deadlines', () => {
    expect(addWorkingMinutes(new Date('2026-10-16T05:00:42.000Z'), 5, WINDOW).toISOString()).toBe('2026-10-16T05:05:42.000Z')
    // 1440 working minutes from Fri 10:00 = 9 h Fri + 10 h Mon + 5 h Tue → Tue 14:00 (09:00Z).
    expect(addWorkingMinutes(NOW, 1440, WINDOW).toISOString()).toBe('2026-10-20T09:00:00.000Z')
  })

  it('without the setting, or with an unusable window: every minute counts', () => {
    expect(replyDueAt(NOW, 30, null).toISOString()).toBe('2026-10-16T05:30:00.000Z')
    const sat = new Date('2026-10-17T05:00:00.000Z')
    expect(addWorkingMinutes(sat, 30, { ...WINDOW, days: [] }).toISOString()).toBe('2026-10-17T05:30:00.000Z')
    expect(addWorkingMinutes(sat, 30, { ...WINDOW, timeZone: 'Mars/Olympus' }).toISOString()).toBe('2026-10-17T05:30:00.000Z')
    expect(addWorkingMinutes(sat, 30, { ...WINDOW, from: '22:00', to: '06:00' }).toISOString()).toBe('2026-10-17T05:30:00.000Z')
    // from = to: the whole work day; Saturday is still not a work day.
    expect(addWorkingMinutes(sat, 30, { ...WINDOW, from: '00:00', to: '00:00' }).toISOString()).toBe('2026-10-18T19:30:00.000Z')
  })

  it('recordInbound stores the work-hours deadline', async () => {
    const { sb, db } = commDb({ profiles: [{ id: USER, full_name: 'Иван', email: null, phone: null, telegram_chat_id: null, preferences: null }] })
    const sat = new Date('2026-10-17T05:00:00.000Z')
    await recordInbound({ userId: USER, channel: 'app', body: 'Здравствуйте' }, { sb, now: sat, replyDeadline: { minutes: 30, window: WINDOW }, notify: async () => {} })
    expect(db.comm_threads[0].staff_reply_due_at).toBe('2026-10-19T04:30:00.000Z')
  })

  it('a staff reply resets the timer; a bot reply does not', () => {
    const t = { status: 'waiting_staff' as const, staff_reply_due_at: '2026-10-16T05:30:00.000Z', escalated_at: '2026-10-16T05:35:00.000Z', unread_staff: 2, unread_user: 0 }
    expect(threadPatchOnOutbound(t, { authorKind: 'staff', body: 'Ответ', at: NOW })).toMatchObject({ status: 'waiting_user', staff_reply_due_at: null, escalated_at: null })
    expect(threadPatchOnOutbound(t, { authorKind: 'bot', body: 'Ответ', at: NOW })).not.toHaveProperty('escalated_at')
  })
})

// ─── Selection, fan-out, idempotency ────────────────────────────────────────

function thread(p: Partial<Row>): Row {
  return {
    id: 't-x', user_id: USER, company_id: null, assignee_id: null, status: 'waiting_staff', mode: 'manual',
    staff_reply_due_at: '2026-10-16T04:30:00.000Z', escalated_at: null, blocked_at: null,
    last_inbound_at: '2026-10-16T04:00:00.000Z', last_message_preview: 'где отчёт?', ...p,
  }
}

function seed() {
  return commDb({
    profiles: [
      { id: USER, full_name: 'Иван Петров', email: 'ivan@example.com', status: 'approved', role: 'client' },
      { id: USER2, full_name: 'Пётр', email: 'petr@example.com', status: 'approved', role: 'client' },
      { id: EXPERT, full_name: 'Анна Эксперт', email: 'anna@aistart360.kz', status: 'approved', role: 'client' },
      { id: ADMIN, full_name: 'Админ', email: 'admin@aistart360.kz', status: 'approved', role: 'client' },
      { id: CRM, full_name: 'CRM', email: 'crm@aistart360.kz', status: 'approved', role: 'client' },
      { id: SUPPORT, full_name: 'Поддержка', email: 'support@aistart360.kz', status: 'approved', role: 'client' },
      { id: OWNER, full_name: 'Владелец', email: 'owner@aistart360.kz', status: 'approved', role: 'super_admin' },
      { id: FORMER, full_name: 'Бывший', email: 'former@aistart360.kz', status: 'blocked', role: 'client' },
    ],
    staff_roles: [
      { user_id: EXPERT, role: 'super_expert' },
      { user_id: ADMIN, role: 'admin' },
      { user_id: CRM, role: 'crm_manager' },
      { user_id: SUPPORT, role: 'support' },
      { user_id: FORMER, role: 'admin' },
    ],
    telegram_bot_links: [
      { bot: 'expert', user_id: EXPERT, chat_id: '9001', linked_at: '2026-10-01T00:00:00.000Z' },
      { bot: 'expert', user_id: ADMIN, chat_id: '9002', linked_at: '2026-10-01T00:00:00.000Z' },
      { bot: 'expert', user_id: CRM, chat_id: '9003', linked_at: null },
      { bot: 'admin', user_id: OWNER, chat_id: '9004', linked_at: '2026-10-01T00:00:00.000Z' },
    ],
    companies: [{ id: 'c-1', user_id: USER, name: 'ТОО Ромашка' }],
    comm_threads: [
      thread({ id: 't-due', assignee_id: EXPERT }),
      thread({ id: 't-due-unassigned', user_id: USER2, staff_reply_due_at: '2026-10-16T04:40:00.000Z' }),
      thread({ id: 't-not-yet', user_id: 'u3', staff_reply_due_at: '2026-10-16T05:10:00.000Z' }),
      thread({ id: 't-escalated', user_id: 'u4', escalated_at: '2026-10-16T04:35:00.000Z' }),
      thread({ id: 't-blocked', user_id: 'u5', blocked_at: '2026-10-16T03:00:00.000Z' }),
      thread({ id: 't-answered', user_id: 'u6', status: 'waiting_user' }),
    ],
    comm_messages: [
      { id: 'm-1', thread_id: 't-due', direction: 'in', channel: 'telegram', author_kind: 'user', body: 'где отчёт блядь', body_masked: 'где отчёт б****', created_at: '2026-10-16T04:00:00.000Z' },
    ],
  })
}

function deps(sb: EscalationDeps['sb'], extra: Partial<EscalationDeps> = {}) {
  const telegram: Array<{ chatId: string; html: string; url: string }> = []
  const emails: Array<{ to: string; subject: string; dedupeKey: string }> = []
  const feed: Array<{ threadId: string; userIds: string[] | null }> = []
  const d: EscalationDeps = {
    sb, now: NOW,
    expertBotReady: () => true,
    sendTelegram: async (chatId, html, button) => { telegram.push({ chatId, html, url: button.url }); return true },
    sendEmail: async (i) => { emails.push({ to: i.to, subject: i.subject, dedupeKey: i.dedupeKey }); return true },
    notifyFeed: async (n, a) => { feed.push({ threadId: n.thread.id, userIds: a.userIds }) },
    ...extra,
  }
  return { d, telegram, emails, feed }
}

describe('escalation selection', () => {
  it('only waiting, overdue, not escalated, not blocked threads — oldest deadline first', async () => {
    const { sb } = seed()
    const rows = await selectOverdueThreads(sb, NOW)
    expect(rows.map((r) => r.id)).toEqual(['t-due', 't-due-unassigned'])
  })

  it('claim: only once, and not after the thread stopped waiting', async () => {
    const { sb, db } = seed()
    expect(await claimEscalation(sb, { id: 't-due' }, NOW)).toBe(true)
    expect(await claimEscalation(sb, { id: 't-due' }, NOW)).toBe(false)
    expect(db.comm_threads.find((t) => t.id === 't-due')!.escalated_at).toBe(NOW.toISOString())
    expect(await claimEscalation(sb, { id: 't-answered' }, NOW)).toBe(false)
    expect(await claimEscalation(sb, { id: 't-blocked' }, NOW)).toBe(false)
  })
})

describe('escalation recipients', () => {
  it('the assignee when he may see the inbox', async () => {
    const { sb } = seed()
    const r = await escalationRecipients(sb, { assignee_id: EXPERT })
    expect(r.assignee).toBe(true)
    expect(r.recipients).toEqual([{ userId: EXPERT, name: 'Анна Эксперт', email: 'anna@aistart360.kz', expertChatId: '9001' }])
  })

  it('no assignee (or one who is no longer staff) → every approved staff member with inbox.manage', async () => {
    const { sb } = seed()
    for (const assignee of [null, USER2, FORMER]) {
      const r = await escalationRecipients(sb, { assignee_id: assignee })
      expect(r.assignee).toBe(false)
      // admin, crm_manager, the super_admin owner; not support (inbox.view only), not super_expert, not a blocked admin.
      expect(r.recipients.map((x) => x.userId).sort()).toEqual([ADMIN, CRM, OWNER].sort())
    }
    const r = await escalationRecipients(sb, { assignee_id: null })
    expect(r.recipients.find((x) => x.userId === CRM)!.expertChatId).toBeNull()
    expect(r.recipients.find((x) => x.userId === OWNER)!.expertChatId).toBeNull()
  })
})

describe('runEscalations', () => {
  beforeEach(() => vi.clearAllMocks())

  it('notifies on the expert bot and by email with a link to the conversation, then sets escalated_at', async () => {
    const { sb, db } = seed()
    const { d, telegram, emails, feed } = deps(sb)
    const report = await runEscalations(d)
    expect(report).toMatchObject({ due: 2, escalated: 2, skipped: 0, budgetExhausted: false })

    // t-due → the assignee only; t-due-unassigned → admin + crm + owner.
    expect(telegram.map((t) => t.chatId).sort()).toEqual(['9001', '9002'])
    expect(telegram[0].url).toContain('/admin-giga-panel/messages?user=')
    const toAssignee = telegram.find((t) => t.chatId === '9001')!
    expect(toAssignee.html).toContain('Иван Петров')
    expect(toAssignee.html).toContain('ТОО Ромашка')
    expect(toAssignee.html).toContain('б****')
    expect(toAssignee.html).not.toContain('блядь')
    expect(emails.map((e) => e.to).sort()).toEqual(['admin@aistart360.kz', 'anna@aistart360.kz', 'crm@aistart360.kz', 'owner@aistart360.kz'])
    expect(report.telegram).toBe(2)
    expect(report.email).toBe(4)
    expect(feed).toEqual([{ threadId: 't-due', userIds: [EXPERT] }, { threadId: 't-due-unassigned', userIds: null }])

    expect(db.comm_threads.find((t) => t.id === 't-due')!.escalated_at).toBe(NOW.toISOString())
    expect(db.comm_threads.find((t) => t.id === 't-due-unassigned')!.escalated_at).toBe(NOW.toISOString())
    expect(db.comm_threads.find((t) => t.id === 't-not-yet')!.escalated_at).toBeNull()
  })

  it('idempotent: the next run (or an overlapping one) reminds nobody again', async () => {
    const { sb } = seed()
    await runEscalations(deps(sb).d)
    const second = deps(sb)
    const report = await runEscalations(second.d)
    expect(report).toMatchObject({ due: 0, escalated: 0 })
    expect(second.telegram).toHaveLength(0)
    expect(second.emails).toHaveLength(0)
  })

  it('a thread claimed by a parallel run between the select and the claim is skipped', async () => {
    const { sb, db } = seed()
    const { d, telegram } = deps(sb, {
      sendTelegram: async () => true,
    })
    // Another run takes t-due right after our select.
    const orig = sb.from.bind(sb)
    let selects = 0
    ;(sb as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      if (t === 'comm_threads' && selects++ === 0) {
        const q = orig(t)
        const then = (q as unknown as { then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise<unknown> }).then
        ;(q as unknown as { then: unknown }).then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => then((v) => {
          db.comm_threads.find((x) => x.id === 't-due')!.escalated_at = '2026-10-16T04:59:00.000Z'
          return res(v)
        }, rej)
        return q
      }
      return orig(t)
    }
    const report = await runEscalations(d)
    expect(report.skipped).toBe(1)
    expect(report.escalated).toBe(1)
    expect(telegram).toHaveLength(0)
  })

  it('expert bot not configured → email only; a failing channel does not stop the others', async () => {
    const { sb } = seed()
    const { d, telegram, emails } = deps(sb, { expertBotReady: () => false })
    await runEscalations(d)
    expect(telegram).toHaveLength(0)
    expect(emails).toHaveLength(4)

    const s2 = seed()
    const failing = deps(s2.sb, { sendTelegram: async () => { throw new Error('tg down') } })
    const report = await runEscalations(failing.d)
    expect(report.escalated).toBe(2)
    expect(failing.emails).toHaveLength(4)
  })

  it('respects the time budget (no further claims after it)', async () => {
    const { sb, db } = seed()
    let t = 0
    const { d } = deps(sb, { budgetMs: 1_000, clock: () => (t += 800) })
    const report = await runEscalations(d)
    expect(report.budgetExhausted).toBe(true)
    expect(report.escalated).toBe(1)
    expect(db.comm_threads.find((x) => x.id === 't-due-unassigned')!.escalated_at).toBeNull()
  })

  it('nothing due → one query, nothing sent', async () => {
    const { sb, db } = seed()
    db.comm_threads = db.comm_threads.filter((t) => t.id === 't-not-yet')
    const { d, telegram, emails } = deps(sb)
    expect(await runEscalations(d)).toMatchObject({ due: 0, escalated: 0 })
    expect(telegram.length + emails.length).toBe(0)
  })
})

describe('texts', () => {
  it('telegram text escapes HTML; the email has the link and the brand layout content', () => {
    const html = escalationTelegramText({
      thread: { ...thread({}), id: 't' } as never, userName: '<b>Иван</b>', company: null, preview: 'a < b', link: '/x', url: 'https://x',
    }, NOW)
    expect(html).toContain('&lt;b&gt;Иван&lt;/b&gt;')
    expect(html).toContain('a &lt; b')
    expect(html).toMatch(/Ждёт: 60 мин/)
    const mail = buildCommEscalationEmail({ name: 'Анна', userName: 'Иван', company: 'Ромашка', preview: 'где отчёт?', url: 'https://aistart360.kz/admin-giga-panel/messages?user=1' })
    expect(mail.subject).toBe('Ждёт ответа: Иван')
    expect(mail.content.cta).toEqual({ label: 'Открыть диалог', url: 'https://aistart360.kz/admin-giga-panel/messages?user=1' })
  })
})
