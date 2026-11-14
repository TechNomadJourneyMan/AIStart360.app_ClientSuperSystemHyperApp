/**
 * lib/expert-sla/notify.ts — уведомления SLA экспертов существующими каналами
 * (новых каналов нет):
 *   персонал   notifyStaff (лента ГИГА + Telegram/WhatsApp сотрудникам по их
 *              правилам; CRITICAL — ещё и письмо ADMIN_NOTIFICATION_EMAIL);
 *              адресаты Telegram — SuperExpert и Admin / Super Admin;
 *   исполнитель запись в его ленте (app_notifications, createNotification) и
 *              экспертный Telegram-бот, если он привязан (telegram_bot_links
 *              bot = 'expert') — как напоминание «30 минут» (lib/comm/escalation).
 *
 * Каждый вызов ВОЗВРАЩАЕТ результат доставки (п. 6 ревью): run.ts отмечает
 * задачу «уведомлено» (expert_sla_mark_notified, миграция 146) только при
 * успехе, иначе считает попытку и повторяет на следующем проходе. Успех:
 * запись в ленте ГИГА создана (notifyStaff вернул eventId) и, если есть
 * исполнитель, запись в его ленте создана. Telegram эксперта — по возможности
 * (сбой логируется, повтор не вызывает). Повтор безопасен: dedupe_key ленты
 * (`expert_sla.<порог>:<id>`) не даёт второй записи, notifyStaff доотправляет
 * только тем, кому не дошло. Группировку (одна задача / сводка) решает run.ts.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { GIGA_BASE } from '@/lib/admin/nav'
import { SOURCE_LABELS, chunked, type ExpertSlaSource } from './policy'

/** Больше стольких задач за раз — одна сводка вместо лавины. */
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
export type Delivery = { ok: true } | { ok: false; error: string }

export interface SlaNotifier {
  /** Новые задачи исполнителя — ОДНИМ сообщением на исполнителя. */
  assigned(assigneeId: string, tasks: TaskBrief[]): Promise<Delivery>
  /** Задачи без исполнителя (одна или сводка) — SuperExpert, без них Admin. */
  queued(tasks: TaskBrief[]): Promise<Delivery>
  /** Порог пройден (одна задача или сводка): 24 ч без реакции / 48 ч без ответа. */
  threshold(stage: SlaThreshold, tasks: TaskBrief[]): Promise<Delivery>
  /** Синхронизация источников упала (не чаще раза в час) — Admin / Super Admin. */
  syncFailed(message: string, now: Date): Promise<void>
}

type Sb = Pick<SupabaseClient, 'from'>
type StaffNotice = Parameters<typeof import('@/lib/notifications/staff').notifyStaff>[0]

function almaty(iso: string): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return iso
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Almaty', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d)
}

function esc(v: unknown): string {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function errText(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 300)
}

/** Строка задачи для уведомления: «Отчёт на проверке · ООО Ромашка · ответ до 16.11, 14:00». */
export function taskLine(t: TaskBrief, client: string | undefined): string {
  return `${SOURCE_LABELS[t.source]} · ${client ?? 'клиент'} · ответ до ${almaty(t.answer_due_at)} (Алматы)`
}

export function thresholdTitle(stage: SlaThreshold, count: number, first?: { title: string }): string {
  if (count > 1) return stage === 'breached' ? `Просрочка SLA экспертов: ${count} задач без ответа 48 ч` : `Эскалация: ${count} задач без реакции эксперта 24 ч`
  return (stage === 'breached' ? `Просрочка SLA: ${first?.title ?? 'задача'}` : `Нет реакции эксперта: ${first?.title ?? 'задача'}`).slice(0, 200)
}

/** Ключ дедупликации ленты: одна задача — по её id; сводка — по первой задаче и размеру. */
export function groupKey(kind: string, tasks: Array<{ id: string }>): string {
  return tasks.length === 1 ? `expert_sla.${kind}:${tasks[0].id}` : `expert_sla.${kind}.batch:${tasks[0].id}:${tasks.length}`
}

export interface DefaultNotifierDeps {
  sb: Sb
  notifyStaff?: (n: StaffNotice) => Promise<unknown>
  createNotification?: (n: Parameters<typeof import('@/lib/notifications/create').createNotification>[0]) => Promise<boolean>
  sendExpertBot?: (chatId: string, html: string, button: { text: string; url: string }) => Promise<boolean>
  siteUrl?: (path: string) => string | Promise<string>
}

async function defaultNotifyStaff(n: StaffNotice): Promise<unknown> {
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

/**
 * Одобренные SuperExpert и Admin / Super Admin (staff_roles) — адресаты
 * эскалаций. Ошибка чтения — исключение: отправка «никому» не считается
 * доставкой (п. 6 ревью).
 */
export async function slaStaffAudience(sb: Sb): Promise<{ superExperts: string[]; admins: string[] }> {
  const { data: roles, error } = await sb.from('staff_roles').select('user_id, role').in('role', ['super_expert', 'admin', 'super_admin'])
  if (error) throw new Error(`staff audience: ${error.message?.slice(0, 120)}`)
  const rows = (roles ?? []) as Array<{ user_id: string; role: string }>
  if (!rows.length) return { superExperts: [], admins: [] }
  const approved = new Set<string>()
  for (const part of chunked(rows.map((r) => r.user_id))) {
    const { data: people, error: pErr } = await sb.from('profiles').select('id, status').in('id', part)
    if (pErr) throw new Error(`staff audience: ${pErr.message?.slice(0, 120)}`)
    for (const p of (people ?? []) as Array<{ id: string; status: string | null }>) if (p.status === 'approved') approved.add(p.id)
  }
  return {
    superExperts: rows.filter((r) => r.role === 'super_expert' && approved.has(r.user_id)).map((r) => r.user_id),
    admins: rows.filter((r) => r.role !== 'super_expert' && approved.has(r.user_id)).map((r) => r.user_id),
  }
}

/** Имена клиентов: компания, иначе ФИО, иначе «клиент». Чанки по 100 id; ошибка — без имён. */
async function clientNames(sb: Sb, tasks: TaskBrief[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const part of chunked(Array.from(new Set(tasks.map((t) => t.client_id))))) {
    const [{ data: people }, { data: companies }] = await Promise.all([
      sb.from('profiles').select('id, full_name, organization').in('id', part),
      sb.from('companies').select('user_id, name').in('user_id', part),
    ])
    for (const p of (people ?? []) as Array<{ id: string; full_name: string | null; organization: string | null }>) {
      const n = p.organization?.trim() || p.full_name?.trim()
      if (n) out.set(p.id, n)
    }
    for (const c of (companies ?? []) as Array<{ user_id: string; name: string | null }>) if (c.name?.trim()) out.set(c.user_id, c.name.trim())
  }
  return out
}

function lines(tasks: TaskBrief[], names: Map<string, string>, extra: (t: TaskBrief) => string = () => ''): string[] {
  return [
    ...tasks.slice(0, 10).map((t) => `${taskLine(t, names.get(t.client_id))}${extra(t)}`),
    ...(tasks.length > 10 ? [`…и ещё ${tasks.length - 10}`] : []),
  ]
}

export function createDefaultNotifier(deps: DefaultNotifierDeps): SlaNotifier {
  const { sb } = deps
  const notifyStaff = deps.notifyStaff ?? defaultNotifyStaff
  const createNotification = deps.createNotification ?? defaultCreateNotification
  const sendBot = deps.sendExpertBot ?? defaultSendExpertBot
  const siteUrl = deps.siteUrl ?? defaultSiteUrl
  let audience: Promise<{ superExperts: string[]; admins: string[] }> | null = null
  const getAudience = () => {
    audience ??= slaStaffAudience(sb).catch((err: unknown) => { audience = null; throw err })
    return audience
  }

  /** Лента ГИГА: успех — только когда событие записано (есть eventId). */
  async function feed(n: StaffNotice): Promise<void> {
    const res = (await notifyStaff(n)) as { eventId?: string | null } | null | undefined
    if (!res?.eventId) throw new Error('staff feed: event not recorded')
  }

  /** Лента исполнителя (обязательно) + экспертный бот (по возможности). */
  async function remind(userId: string, title: string, body: string, priority: 'high' | 'critical' | 'medium', html: string): Promise<void> {
    const { data: staffRow } = await sb.from('staff_roles').select('role').eq('user_id', userId).maybeSingle()
    const link = (staffRow as { role?: string } | null)?.role ? GIGA_SLA_PATH : EXPERT_QUEUE_PATH
    const ok = await createNotification({ userId, category: 'expert', priority, title: title.slice(0, 200), body: body.slice(0, 1000), link, metadata: { kind: 'expert_sla' } })
    if (!ok) throw new Error(`assignee feed: not written for ${userId}`)
    try {
      const { data: bot } = await sb.from('telegram_bot_links').select('chat_id, linked_at').eq('bot', 'expert').eq('user_id', userId).maybeSingle()
      const b = bot as { chat_id?: string | number | null; linked_at?: string | null } | null
      if (b?.chat_id && b.linked_at) {
        const sent = await sendBot(String(b.chat_id), html, { text: 'Открыть очередь', url: await Promise.resolve(siteUrl(link)) })
        if (!sent) console.error('[expert-sla/notify] expert bot: not sent', userId)
      }
    } catch (err) {
      console.error('[expert-sla/notify] expert bot', errText(err))
    }
  }

  async function deliver(label: string, fn: () => Promise<void>): Promise<Delivery> {
    try {
      await fn()
      return { ok: true }
    } catch (err) {
      const error = errText(err)
      console.error(`[expert-sla/notify] ${label}: ${error}`)
      return { ok: false, error }
    }
  }

  return {
    assigned(assigneeId, tasks) {
      return deliver('assigned', async () => {
        if (!tasks.length) return
        const names = await clientNames(sb, tasks)
        const body = lines(tasks, names)
        const title = tasks.length > 1 ? `Новые задачи: ${tasks.length}` : `Новая задача: ${tasks[0].title}`
        await remind(assigneeId, title, body.join('\n'), 'high',
          `🧑‍💼 <b>[AIStart360 · эксперт]</b> ${esc(title)}\n\n${body.map(esc).join('\n')}`)
      })
    },

    queued(tasks) {
      return deliver('queued', async () => {
        if (!tasks.length) return
        const { superExperts, admins } = await getAudience()
        const audienceUserIds = superExperts.length ? superExperts : admins
        const names = await clientNames(sb, tasks)
        const first = tasks[0]
        await feed({
          level: 'WARNING',
          type: 'expert_sla.queued',
          title: tasks.length > 1 ? `В очереди экспертов ${tasks.length} задач без исполнителя` : `Задача без эксперта: ${first.title}`.slice(0, 200),
          lines: [...lines(tasks, names), 'Возьмите задачу себе или назначьте эксперта в «SLA экспертов».'],
          companyId: tasks.length === 1 ? first.company_id : null,
          entityType: 'expert_sla_task',
          entityId: tasks.length === 1 ? first.id : null,
          link: GIGA_SLA_PATH,
          dedupeKey: groupKey('queued', tasks),
          audienceUserIds: audienceUserIds.length ? audienceUserIds : null,
          skipCooldown: true,
        })
      })
    },

    threshold(stage, tasks) {
      return deliver(stage, async () => {
        if (!tasks.length) return
        const { superExperts, admins } = await getAudience()
        const names = await clientNames(sb, tasks)
        const first = tasks[0]
        const assignees = Array.from(new Set(tasks.map((t) => t.assignee_id).filter((x): x is string => !!x)))
        const audienceUserIds = Array.from(new Set([...superExperts, ...admins, ...assignees]))
        await feed({
          level: stage === 'breached' ? 'CRITICAL' : 'WARNING',
          type: `expert_sla.${stage}`,
          title: thresholdTitle(stage, tasks.length, first),
          lines: [
            ...lines(tasks, names, (t) => (t.assignee_id ? '' : ' · без исполнителя')),
            stage === 'breached' ? 'Срок ответа клиенту прошёл.' : 'Эксперт не отреагировал за отведённое время.',
          ],
          companyId: tasks.length === 1 ? first.company_id : null,
          entityType: 'expert_sla_task',
          entityId: tasks.length === 1 ? first.id : null,
          link: GIGA_SLA_PATH,
          dedupeKey: groupKey(stage, tasks),
          audienceUserIds: audienceUserIds.length ? audienceUserIds : null,
          skipCooldown: true,
        })
        // The assignee hears about his own tasks — one message per assignee.
        for (const assignee of assignees) {
          const own = tasks.filter((t) => t.assignee_id === assignee)
          const head = stage === 'breached' ? 'Срок ответа клиенту прошёл' : 'Задача ждёт вашей реакции'
          const title = own.length > 1 ? `${head}: ${own.length} задач` : `${head}: ${own[0].title}`
          const body = lines(own, names)
          await remind(assignee, title, body.join('\n'), stage === 'breached' ? 'critical' : 'high',
            `⏰ <b>[AIStart360 · эксперт]</b> ${esc(head)}\n\n${body.map(esc).join('\n')}`)
        }
      })
    },

    async syncFailed(message, now) {
      try {
        const { admins } = await getAudience().catch(() => ({ admins: [] as string[] }))
        await notifyStaff({
          level: 'WARNING',
          type: 'expert_sla.sync_failed',
          title: 'SLA экспертов: не удалось обновить задачи',
          lines: [message.slice(0, 300), 'Пороги 24/48 ч по уже открытым задачам продолжают работать.'],
          link: GIGA_SLA_PATH,
          dedupeKey: `expert_sla.sync_failed:${now.toISOString().slice(0, 13)}`,
          audienceUserIds: admins.length ? admins : null,
          skipCooldown: true,
        })
      } catch (err) {
        console.error('[expert-sla/notify] sync_failed', errText(err))
      }
    },
  }
}
