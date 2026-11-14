/**
 * lib/expert-sla/notify.ts — уведомления SLA экспертов существующими каналами
 * (новых каналов нет):
 *   персонал   notifyStaff (лента ГИГА + Telegram/WhatsApp сотрудникам по их
 *              правилам; CRITICAL — ещё и письмо ADMIN_NOTIFICATION_EMAIL);
 *              адресаты Telegram — SuperExpert и Admin / Super Admin;
 *   эксперт    запись в его ленте (app_notifications, createNotification) и
 *              экспертный Telegram-бот, если он привязан (telegram_bot_links
 *              bot = 'expert') — как напоминание «30 минут» (lib/comm/escalation).
 * Один раз на порог: вызывающий (run.ts) уже ЗАХВАТИЛ задачу в базе
 * (expert_sla_claim), а dedupe_key ленты (`expert_sla.<порог>:<id>`) не даст
 * второй записи даже при повторе. Больше BATCH задач за проход — одна сводка
 * вместо лавины (бэклог при включении).
 * Никогда не бросает: уведомление не должно ломать проход.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { GIGA_BASE } from '@/lib/admin/nav'
import { SOURCE_LABELS, type ExpertSlaSource } from './policy'

export const BATCH = 5
export const EXPERT_QUEUE_PATH = '/expert/queue'
export const GIGA_SLA_PATH = `${GIGA_BASE}/expert-sla`

export interface TaskBrief {
  id: string
  source: ExpertSlaSource
  client_id: string
  company_id: string | null
  title: string
  assignee_id: string | null
  received_at: string
  reaction_due_at: string
  answer_due_at: string
  first_response_at: string | null
}

export type SlaThreshold = 'escalated' | 'breached'

export interface SlaNotifier {
  /** Задача назначена исполнителю (авто или ответственный клиента). */
  assigned(task: TaskBrief): Promise<void>
  /** Задачи без исполнителя — в общей очереди SuperExpert. */
  queued(tasks: TaskBrief[]): Promise<void>
  /** Порог пройден: 24 ч без реакции / 48 ч без ответа. */
  threshold(stage: SlaThreshold, tasks: TaskBrief[]): Promise<void>
}

type Sb = Pick<SupabaseClient, 'from'>

function almaty(iso: string): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return iso
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Almaty', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d)
}

function esc(v: unknown): string {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Строка задачи для уведомления: «Отчёт на проверке · ООО Ромашка · ответ до 16.11, 14:00». */
export function taskLine(t: TaskBrief, client: string | undefined): string {
  return `${SOURCE_LABELS[t.source]} · ${client ?? 'клиент'} · ответ до ${almaty(t.answer_due_at)} (Алматы)`
}

export function thresholdTitle(stage: SlaThreshold, count: number, first?: { title: string }): string {
  if (count > 1) return stage === 'breached' ? `Просрочка SLA экспертов: ${count} задач без ответа 48 ч` : `Эскалация: ${count} задач без реакции эксперта 24 ч`
  return (stage === 'breached' ? `Просрочка SLA: ${first?.title ?? 'задача'}` : `Нет реакции эксперта: ${first?.title ?? 'задача'}`).slice(0, 200)
}

export interface DefaultNotifierDeps {
  sb: Sb
  notifyStaff?: (n: Parameters<typeof import('@/lib/notifications/staff').notifyStaff>[0]) => Promise<unknown>
  createNotification?: (n: Parameters<typeof import('@/lib/notifications/create').createNotification>[0]) => Promise<boolean>
  sendExpertBot?: (chatId: string, html: string, button: { text: string; url: string }) => Promise<boolean>
  siteUrl?: (path: string) => string | Promise<string>
}

async function defaultNotifyStaff(n: Parameters<typeof import('@/lib/notifications/staff').notifyStaff>[0]): Promise<unknown> {
  const { notifyStaff } = await import('@/lib/notifications/staff')
  return notifyStaff(n)
}

async function defaultCreateNotification(n: Parameters<typeof import('@/lib/notifications/create').createNotification>[0]): Promise<boolean> {
  const { createNotification } = await import('@/lib/notifications/create')
  return createNotification(n)
}

async function defaultSendExpertBot(chatId: string, html: string, button: { text: string; url: string }): Promise<boolean> {
  const { botToken, sendMessage } = await import('@/lib/telegram/bots/registry')
  if (!botToken('expert')) return false
  const res = await sendMessage('expert', chatId, html, { inline_keyboard: [[button]] })
  return res.ok
}

async function defaultSiteUrl(path: string): Promise<string> {
  const { getSiteUrl } = await import('@/lib/site-url')
  return getSiteUrl(path)
}

/** Одобренные SuperExpert и Admin / Super Admin (staff_roles) — адресаты эскалаций. */
export async function slaStaffAudience(sb: Sb): Promise<{ superExperts: string[]; admins: string[] }> {
  const { data: roles } = await sb.from('staff_roles').select('user_id, role').in('role', ['super_expert', 'admin', 'super_admin'])
  const rows = (roles ?? []) as Array<{ user_id: string; role: string }>
  if (!rows.length) return { superExperts: [], admins: [] }
  const { data: people } = await sb.from('profiles').select('id, status').in('id', rows.map((r) => r.user_id))
  const approved = new Set(((people ?? []) as Array<{ id: string; status: string | null }>).filter((p) => p.status === 'approved').map((p) => p.id))
  return {
    superExperts: rows.filter((r) => r.role === 'super_expert' && approved.has(r.user_id)).map((r) => r.user_id),
    admins: rows.filter((r) => r.role !== 'super_expert' && approved.has(r.user_id)).map((r) => r.user_id),
  }
}

/** Имена клиентов: компания, иначе ФИО, иначе «клиент». */
async function clientNames(sb: Sb, tasks: TaskBrief[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(tasks.map((t) => t.client_id)))
  const out = new Map<string, string>()
  if (!ids.length) return out
  const [{ data: people }, { data: companies }] = await Promise.all([
    sb.from('profiles').select('id, full_name, organization').in('id', ids),
    sb.from('companies').select('user_id, name').in('user_id', ids),
  ])
  for (const p of (people ?? []) as Array<{ id: string; full_name: string | null; organization: string | null }>) {
    const n = p.organization?.trim() || p.full_name?.trim()
    if (n) out.set(p.id, n)
  }
  for (const c of (companies ?? []) as Array<{ user_id: string; name: string | null }>) if (c.name?.trim()) out.set(c.user_id, c.name.trim())
  return out
}

export function createDefaultNotifier(deps: DefaultNotifierDeps): SlaNotifier {
  const { sb } = deps
  const notifyStaff = deps.notifyStaff ?? defaultNotifyStaff
  const createNotification = deps.createNotification ?? defaultCreateNotification
  const sendBot = deps.sendExpertBot ?? defaultSendExpertBot
  const siteUrl = deps.siteUrl ?? defaultSiteUrl
  let audience: Promise<{ superExperts: string[]; admins: string[] }> | null = null
  const getAudience = () => (audience ??= slaStaffAudience(sb).catch(() => ({ superExperts: [], admins: [] })))

  /** Эксперт (не staff) работает в /expert, сотрудник — в ГИГА. */
  async function isStaff(userId: string): Promise<boolean> {
    const { data } = await sb.from('staff_roles').select('role').eq('user_id', userId).maybeSingle()
    return !!(data as { role?: string } | null)?.role
  }

  async function remind(userId: string, title: string, body: string, priority: 'high' | 'critical' | 'medium', html: string): Promise<void> {
    const link = (await isStaff(userId)) ? GIGA_SLA_PATH : EXPERT_QUEUE_PATH
    await createNotification({ userId, category: 'expert', priority, title: title.slice(0, 200), body: body.slice(0, 1000), link, metadata: { kind: 'expert_sla' } })
    const { data: bot } = await sb.from('telegram_bot_links').select('chat_id, linked_at').eq('bot', 'expert').eq('user_id', userId).maybeSingle()
    const b = bot as { chat_id?: string | number | null; linked_at?: string | null } | null
    if (b?.chat_id && b.linked_at) {
      const url = await Promise.resolve(siteUrl(link))
      await sendBot(String(b.chat_id), html, { text: 'Открыть очередь', url }).catch(() => false)
    }
  }

  const safe = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn()
    } catch (err) {
      console.error(`[expert-sla/notify] ${label}`, err instanceof Error ? err.message.slice(0, 160) : err)
    }
  }

  return {
    async assigned(task) {
      if (!task.assignee_id) return
      await safe('assigned', async () => {
        const names = await clientNames(sb, [task])
        const line = taskLine(task, names.get(task.client_id))
        await remind(task.assignee_id!, `Новая задача: ${task.title}`, line, 'high',
          `🧑‍💼 <b>[AIStart360 · эксперт]</b> Новая задача\n\n<b>${esc(task.title)}</b>\n${esc(line)}`)
      })
    },

    async queued(tasks) {
      if (!tasks.length) return
      await safe('queued', async () => {
        const { superExperts, admins } = await getAudience()
        const audienceUserIds = superExperts.length ? superExperts : admins
        const names = await clientNames(sb, tasks)
        const groups = tasks.length > BATCH ? [tasks] : tasks.map((t) => [t])
        for (const group of groups) {
          const first = group[0]
          await notifyStaff({
            level: 'WARNING',
            type: 'expert_sla.queued',
            title: group.length > 1 ? `В очереди экспертов ${group.length} задач без исполнителя` : `Задача без эксперта: ${first.title}`.slice(0, 200),
            lines: [...group.slice(0, 10).map((t) => taskLine(t, names.get(t.client_id))), ...(group.length > 10 ? [`…и ещё ${group.length - 10}`] : []),
              'Возьмите задачу себе или назначьте эксперта в «SLA экспертов».'],
            companyId: group.length === 1 ? first.company_id : null,
            entityType: 'expert_sla_task',
            entityId: group.length === 1 ? first.id : null,
            link: GIGA_SLA_PATH,
            dedupeKey: group.length === 1 ? `expert_sla.queued:${first.id}` : `expert_sla.queued.batch:${first.id}:${group.length}`,
            audienceUserIds,
            skipCooldown: true,
          })
        }
      })
    },

    async threshold(stage, tasks) {
      if (!tasks.length) return
      await safe(stage, async () => {
        const { superExperts, admins } = await getAudience()
        const names = await clientNames(sb, tasks)
        const groups = tasks.length > BATCH ? [tasks] : tasks.map((t) => [t])
        for (const group of groups) {
          const first = group[0]
          const assignees = Array.from(new Set(group.map((t) => t.assignee_id).filter((x): x is string => !!x)))
          await notifyStaff({
            level: stage === 'breached' ? 'CRITICAL' : 'WARNING',
            type: `expert_sla.${stage}`,
            title: thresholdTitle(stage, group.length, first),
            lines: [
              ...group.slice(0, 10).map((t) => `${taskLine(t, names.get(t.client_id))}${t.assignee_id ? '' : ' · без исполнителя'}`),
              ...(group.length > 10 ? [`…и ещё ${group.length - 10}`] : []),
              stage === 'breached' ? 'Срок ответа клиенту прошёл.' : 'Эксперт не отреагировал за отведённое время.',
            ],
            companyId: group.length === 1 ? first.company_id : null,
            entityType: 'expert_sla_task',
            entityId: group.length === 1 ? first.id : null,
            link: GIGA_SLA_PATH,
            dedupeKey: group.length === 1 ? `expert_sla.${stage}:${first.id}` : `expert_sla.${stage}.batch:${first.id}:${group.length}`,
            audienceUserIds: Array.from(new Set([...superExperts, ...admins, ...assignees])),
            skipCooldown: true,
          })
        }
        // The assignee hears about his own tasks (once per threshold: the claim is in the database).
        const byAssignee = new Map<string, TaskBrief[]>()
        for (const t of tasks) if (t.assignee_id) byAssignee.set(t.assignee_id, [...(byAssignee.get(t.assignee_id) ?? []), t])
        for (const [assignee, own] of Array.from(byAssignee.entries())) {
          const head = stage === 'breached' ? 'Срок ответа клиенту прошёл' : 'Задача ждёт вашей реакции'
          const title = own.length > 1 ? `${head}: ${own.length} задач` : `${head}: ${own[0].title}`
          const lines = own.slice(0, 5).map((t) => taskLine(t, names.get(t.client_id)))
          await remind(assignee, title, lines.join('\n'), stage === 'breached' ? 'critical' : 'high',
            `⏰ <b>[AIStart360 · эксперт]</b> ${esc(head)}\n\n${lines.map(esc).join('\n')}`)
        }
      })
    },
  }
}
