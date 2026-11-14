/**
 * R2-B — уведомления SLA экспертов (lib/expert-sla/notify.ts) существующими
 * каналами: лента ГИГА / Telegram сотрудников (notifyStaff) — SuperExpert и
 * Admin; исполнителю — его лента и экспертный бот. Одна запись на порог
 * (dedupe_key по задаче), бэклог — одной сводкой.
 */
import { describe, expect, it } from 'vitest'
import { BATCH, createDefaultNotifier, EXPERT_QUEUE_PATH, GIGA_SLA_PATH, type TaskBrief } from '@/lib/expert-sla/notify'
import { slaDeadlines } from '@/lib/expert-sla/policy'
import { slaDb } from './_fake'

const T0 = new Date('2026-11-14T06:00:00.000Z')

function brief(id: string, over: Partial<TaskBrief> = {}): TaskBrief {
  return {
    id, source: 'case', client_id: 'c1', company_id: 'co1', title: `Обращение ${id}`, assignee_id: null,
    received_at: T0.toISOString(), ...slaDeadlines(T0), first_response_at: null, ...over,
  }
}

function setup() {
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
    notifyStaff: async (n) => { staff.push(n as unknown as Record<string, unknown>) },
    createNotification: async (n) => { inApp.push(n as unknown as Record<string, unknown>); return true },
    sendExpertBot: async (chatId, html, button) => { bot.push({ chatId, html, url: button.url }); return true },
    siteUrl: (p) => `https://portal.test${p}`,
  })
  return { notifier, staff, inApp, bot }
}

describe('expert SLA notifier', () => {
  it('24 h escalation: WARNING to SuperExpert + Admin + the assignee, deduped per task; the expert also gets his feed and bot', async () => {
    const { notifier, staff, inApp, bot } = setup()
    await notifier.threshold('escalated', [brief('t1', { assignee_id: 'e1' })])
    expect(staff).toHaveLength(1)
    expect(staff[0]).toMatchObject({
      level: 'WARNING', type: 'expert_sla.escalated', dedupeKey: 'expert_sla.escalated:t1', entityId: 't1', link: GIGA_SLA_PATH, skipCooldown: true,
    })
    expect((staff[0].audienceUserIds as string[]).sort()).toEqual(['ad1', 'e1', 'sa1', 'se1']) // no CRM manager, no blocked SuperExpert
    expect((staff[0].lines as string[])[0]).toContain('ООО Ромашка')
    expect(inApp).toEqual([expect.objectContaining({ userId: 'e1', link: EXPERT_QUEUE_PATH, priority: 'high', category: 'expert' })])
    expect(bot).toEqual([expect.objectContaining({ chatId: '777', url: `https://portal.test${EXPERT_QUEUE_PATH}` })])
  })

  it('48 h breach is CRITICAL with its own dedupe key; a task in the queue says «без исполнителя»', async () => {
    const { notifier, staff, inApp } = setup()
    await notifier.threshold('breached', [brief('t2')])
    expect(staff[0]).toMatchObject({ level: 'CRITICAL', type: 'expert_sla.breached', dedupeKey: 'expert_sla.breached:t2' })
    expect((staff[0].lines as string[])[0]).toContain('без исполнителя')
    expect(inApp).toEqual([])
  })

  it(`more than ${BATCH} tasks at once (a backlog) → one summary instead of an avalanche`, async () => {
    const { notifier, staff, inApp } = setup()
    const tasks = Array.from({ length: BATCH + 3 }, (_, i) => brief(`b${i}`, { assignee_id: 'e1' }))
    await notifier.threshold('breached', tasks)
    expect(staff).toHaveLength(1)
    expect(staff[0].title).toContain(`${BATCH + 3} задач`)
    expect(staff[0].dedupeKey).toBe(`expert_sla.breached.batch:b0:${BATCH + 3}`)
    expect(inApp).toHaveLength(1) // one reminder per assignee, not per task
  })

  it('the common queue goes to SuperExperts; a new assignment to the assignee', async () => {
    const { notifier, staff, inApp } = setup()
    await notifier.queued([brief('q1')])
    expect(staff[0]).toMatchObject({ type: 'expert_sla.queued', dedupeKey: 'expert_sla.queued:q1', audienceUserIds: ['se1'] })
    await notifier.assigned(brief('n1', { assignee_id: 'e1' }))
    expect(inApp[0]).toMatchObject({ userId: 'e1', title: 'Новая задача: Обращение n1' })
    await notifier.queued([])
    await notifier.threshold('escalated', [])
    expect(staff).toHaveLength(1)
  })

  it('a failing channel never throws out of the notifier', async () => {
    const f = slaDb({})
    const notifier = createDefaultNotifier({ sb: f.sb, notifyStaff: async () => { throw new Error('down') }, createNotification: async () => false })
    await expect(notifier.threshold('breached', [brief('x')])).resolves.toBeUndefined()
  })
})
