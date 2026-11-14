/**
 * R2-B — уведомления SLA экспертов (lib/expert-sla/notify.ts) существующими
 * каналами: лента ГИГА / Telegram сотрудников (notifyStaff) — SuperExpert и
 * Admin; исполнителю — его лента и экспертный бот. Каждый вызов возвращает
 * результат доставки (outbox, п. 6 ревью): сбой ленты, адресатов или записи
 * исполнителю — `ok: false`, а не «отправлено никому».
 */
import { describe, expect, it } from 'vitest'
import { EXPERT_QUEUE_PATH, GIGA_SLA_PATH, createDefaultNotifier, groupKey, type TaskBrief } from '@/lib/expert-sla/notify'
import { slaDeadlines } from '@/lib/expert-sla/policy'
import { slaDb } from './_fake'

const T0 = new Date('2026-11-14T06:00:00.000Z')

function brief(id: string, over: Partial<TaskBrief> = {}): TaskBrief {
  return {
    id, source: 'case', client_id: 'c1', company_id: 'co1', title: `Обращение ${id}`, assignee_id: null,
    received_at: T0.toISOString(), ...slaDeadlines(T0), first_response_at: null, ...over,
  }
}

function setup(opts: { feedEvent?: string | null; inAppOk?: boolean } = {}) {
  const f = slaDb({
    staff_roles: [
      { user_id: 'se1', role: 'super_expert' },
      { user_id: 'ad1', role: 'admin' },
      { user_id: 'sa1', role: 'super_admin' },
      { user_id: 'crm', role: 'crm_manager' },
      { user_id: 'se-off', role: 'super_expert' },
    ],
    profiles: [
      { id: 'se1', status: 'approved', full_name: 'Супер' },
      { id: 'ad1', status: 'approved' },
      { id: 'sa1', status: 'approved' },
      { id: 'crm', status: 'approved' },
      { id: 'se-off', status: 'blocked' },
      { id: 'c1', full_name: 'Иван', organization: null },
      { id: 'e1', role: 'expert', status: 'approved' },
    ],
    companies: [{ user_id: 'c1', name: 'ООО Ромашка' }],
    telegram_bot_links: [{ bot: 'expert', user_id: 'e1', chat_id: 777, linked_at: '2026-11-01T00:00:00Z' }],
  })
  const staff: Array<Record<string, unknown>> = []
  const inApp: Array<Record<string, unknown>> = []
  const bot: Array<{ chatId: string; html: string; url: string }> = []
  const notifier = createDefaultNotifier({
    sb: f.sb,
    notifyStaff: async (n) => { staff.push(n as unknown as Record<string, unknown>); return { eventId: opts.feedEvent === undefined ? 'ev-1' : opts.feedEvent } },
    createNotification: async (n) => { inApp.push(n as unknown as Record<string, unknown>); return opts.inAppOk ?? true },
    sendExpertBot: async (chatId, html, button) => { bot.push({ chatId, html, url: button.url }); return true },
    siteUrl: (p) => `https://portal.test${p}`,
  })
  return { f, notifier, staff, inApp, bot }
}

describe('expert SLA notifier', () => {
  it('24 h escalation: WARNING to SuperExpert + Admin + the assignee, deduped per task; the expert also gets his feed and bot', async () => {
    const { notifier, staff, inApp, bot } = setup()
    expect(await notifier.threshold('escalated', [brief('t1', { assignee_id: 'e1' })])).toEqual({ ok: true })
    expect(staff).toHaveLength(1)
    expect(staff[0]).toMatchObject({
      level: 'WARNING', type: 'expert_sla.escalated', dedupeKey: 'expert_sla.escalated:t1', entityId: 't1', link: GIGA_SLA_PATH, skipCooldown: true,
    })
    expect((staff[0].audienceUserIds as string[]).sort()).toEqual(['ad1', 'e1', 'sa1', 'se1']) // no CRM manager, no blocked SuperExpert
    expect((staff[0].lines as string[])[0]).toContain('ООО Ромашка')
    expect(inApp).toEqual([expect.objectContaining({ userId: 'e1', link: EXPERT_QUEUE_PATH, priority: 'high', category: 'expert' })])
    expect(bot).toEqual([expect.objectContaining({ chatId: '777', url: `https://portal.test${EXPERT_QUEUE_PATH}` })])
  })

  it('48 h breach is CRITICAL with its own dedupe key; a summary group gets the batch key', async () => {
    const { notifier, staff } = setup()
    await notifier.threshold('breached', [brief('t2')])
    expect(staff[0]).toMatchObject({ level: 'CRITICAL', type: 'expert_sla.breached', dedupeKey: 'expert_sla.breached:t2' })
    expect((staff[0].lines as string[])[0]).toContain('без исполнителя')
    const many = Array.from({ length: 8 }, (_, i) => brief(`b${i}`, { assignee_id: 'e1' }))
    expect(groupKey('breached', many)).toBe('expert_sla.breached.batch:b0:8')
  })

  it('п. 5: the assignee gets ONE message for all his new tasks', async () => {
    const { notifier, inApp, bot } = setup()
    const res = await notifier.assigned('e1', [brief('n1', { assignee_id: 'e1' }), brief('n2', { assignee_id: 'e1' }), brief('n3', { assignee_id: 'e1' })])
    expect(res).toEqual({ ok: true })
    expect(inApp).toHaveLength(1)
    expect(inApp[0]).toMatchObject({ userId: 'e1', title: 'Новые задачи: 3' })
    expect(bot).toHaveLength(1)
  })

  it('the common queue goes to SuperExperts (Admins when there is none)', async () => {
    const { notifier, staff } = setup()
    await notifier.queued([brief('q1')])
    expect(staff[0]).toMatchObject({ type: 'expert_sla.queued', dedupeKey: 'expert_sla.queued:q1', audienceUserIds: ['se1'] })
  })

  it('п. 6: an unreadable audience is a failed delivery, not «sent to nobody»', async () => {
    const { f, notifier, staff } = setup()
    f.failing.add('staff_roles')
    const res = await notifier.threshold('escalated', [brief('x')])
    expect(res.ok).toBe(false)
    expect(staff).toEqual([])
  })

  it('п. 6: the feed event not recorded or the assignee\'s feed not written → ok: false', async () => {
    expect((await setup({ feedEvent: null }).notifier.threshold('breached', [brief('x')])).ok).toBe(false)
    expect((await setup({ inAppOk: false }).notifier.threshold('breached', [brief('x', { assignee_id: 'e1' })])).ok).toBe(false)
    expect((await setup({ inAppOk: false }).notifier.assigned('e1', [brief('x', { assignee_id: 'e1' })])).ok).toBe(false)
  })

  it('a throwing channel never escapes the notifier', async () => {
    const f = slaDb({})
    const notifier = createDefaultNotifier({ sb: f.sb, notifyStaff: async () => { throw new Error('down') }, createNotification: async () => false })
    await expect(notifier.threshold('breached', [brief('x')])).resolves.toMatchObject({ ok: false, error: 'down' })
    await expect(notifier.syncFailed('boom', T0)).resolves.toBeUndefined()
  })
})
