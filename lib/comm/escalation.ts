/**
 * lib/comm/escalation.ts — the «30-minute rule»
 * (docs/superpowers/specs/2026-10-16-user-communications-design.md §6.4).
 *
 * A user wrote, staff did not answer before the deadline
 * (comm_threads.staff_reply_due_at, set on inbound — lib/comm/state.ts and
 * lib/comm/deadline.ts) → a reminder:
 *
 *   who      the assignee of the conversation (still approved staff whose role
 *            sees the inbox), otherwise every approved staff member with
 *            inbox.manage;
 *   how      the EXPERT Telegram bot (people who linked it, telegram_bot_links
 *            bot = 'expert') with a button to the conversation in GIGA
 *            «Сообщения», and a letter (Resend, brand layout); plus one entry
 *            in the GIGA notification feed (notifyStaff, Telegram threshold
 *            CRITICAL so the admin bot does not repeat the expert bot);
 *   once     escalated_at is CLAIMED before anyone is notified
 *            (UPDATE … WHERE escalated_at IS NULL): two overlapping runs or a
 *            retry never remind twice. A staff reply clears staff_reply_due_at
 *            and escalated_at (threadPatchOnOutbound), so the next unanswered
 *            message starts a new deadline and may remind again.
 *
 * Cost: one indexed query on the waiting threads (partial index of 120 / 122),
 * a small batch, a time budget, no LLM, no transactions. Runs every 5 minutes
 * from Inngest (lib/functions/comm.ts) regardless of «Агенты по расписанию» —
 * it is not an AI agent. Blocked conversations are never escalated.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { hasPermission, isStaffRole, type StaffRole } from '@/lib/admin/rbac'
import { buildCommEscalationEmail } from '@/lib/email/templates'
import { getSiteUrl } from '@/lib/site-url'
import { botToken, sendMessage } from '@/lib/telegram/bots/registry'
import { GIGA_MESSAGES_PATH } from './inbound'
import { previewOf } from './state'
import { THREAD_COLUMNS, type CommThreadRow } from './types'

export const ESCALATION_BATCH = 20
export const ESCALATION_BUDGET_MS = 30_000

export interface StaffContact {
  userId: string
  name: string | null
  email: string | null
  /** Chat with the expert bot, when he linked it. */
  expertChatId: string | null
}

export interface EscalationNotice {
  thread: CommThreadRow
  userName: string
  company: string | null
  /** Last inbound text as staff see it (masked). */
  preview: string | null
  link: string
  url: string
}

export interface EscalationDeps {
  sb: SupabaseClient
  now?: Date
  limit?: number
  budgetMs?: number
  /** The expert bot can send (token set). */
  expertBotReady?: () => boolean
  sendTelegram?: (chatId: string, html: string, button: { text: string; url: string }) => Promise<boolean>
  sendEmail?: (input: { to: string; userId: string; subject: string; content: ReturnType<typeof buildCommEscalationEmail>['content']; dedupeKey: string }) => Promise<boolean>
  /** One entry in the GIGA feed; default notifyStaff. */
  notifyFeed?: (n: EscalationNotice, audience: { userIds: string[] | null }) => Promise<void>
  /** Monotonic clock for the budget (tests). */
  clock?: () => number
}

export interface EscalationReport {
  due: number
  escalated: number
  telegram: number
  email: number
  /** Claimed by another run or answered meanwhile. */
  skipped: number
  budgetExhausted: boolean
}

// ─── Selection ──────────────────────────────────────────────────────────────

/** Threads past the reply deadline, not escalated, not blocked — oldest deadline first. */
export async function selectOverdueThreads(sb: SupabaseClient, now: Date, limit = ESCALATION_BATCH): Promise<CommThreadRow[]> {
  const { data, error } = await sb
    .from('comm_threads')
    .select(THREAD_COLUMNS)
    .eq('status', 'waiting_staff')
    .lt('staff_reply_due_at', now.toISOString())
    .is('escalated_at', null)
    .is('blocked_at', null)
    .order('staff_reply_due_at', { ascending: true })
    .limit(Math.max(1, Math.min(limit, 100)))
  if (error) throw new Error(`comm escalation select: ${error.message?.slice(0, 200)}`)
  return (data ?? []) as CommThreadRow[]
}

/**
 * Take the escalation of one thread: true only for the run that set
 * escalated_at (still waiting, deadline passed, nobody took it before).
 */
export async function claimEscalation(sb: SupabaseClient, thread: Pick<CommThreadRow, 'id'>, now: Date): Promise<boolean> {
  const { data, error } = await sb
    .from('comm_threads')
    .update({ escalated_at: now.toISOString() })
    .eq('id', thread.id)
    .eq('status', 'waiting_staff')
    .is('escalated_at', null)
    .is('blocked_at', null)
    .lt('staff_reply_due_at', now.toISOString())
    .select('id')
  if (error) throw new Error(`comm escalation claim: ${error.message?.slice(0, 200)}`)
  return Array.isArray(data) && data.length > 0
}

// ─── Recipients ─────────────────────────────────────────────────────────────

/** Approved staff (staff_roles + profile super_admins) with their role. */
async function staffRoles(sb: SupabaseClient, onlyIds?: string[]): Promise<Map<string, StaffRole>> {
  let rolesQ = sb.from('staff_roles').select('user_id, role')
  let supersQ = sb.from('profiles').select('id').eq('role', 'super_admin')
  if (onlyIds) {
    rolesQ = rolesQ.in('user_id', onlyIds)
    supersQ = supersQ.in('id', onlyIds)
  }
  const [{ data: roles }, { data: supers }] = await Promise.all([rolesQ, supersQ])
  const out = new Map<string, StaffRole>()
  for (const r of (roles ?? []) as Array<{ user_id: string; role: string }>) if (isStaffRole(r.role)) out.set(r.user_id, r.role)
  for (const s of (supers ?? []) as Array<{ id: string }>) out.set(s.id, 'super_admin')
  return out
}

async function contactsOf(sb: SupabaseClient, ids: string[]): Promise<StaffContact[]> {
  if (!ids.length) return []
  const [{ data: people }, { data: links }] = await Promise.all([
    sb.from('profiles').select('id, full_name, email, status').in('id', ids),
    sb.from('telegram_bot_links').select('user_id, chat_id, linked_at').eq('bot', 'expert').in('user_id', ids),
  ])
  const chatOf = new Map<string, string>()
  for (const l of (links ?? []) as Array<{ user_id: string; chat_id: string | null; linked_at: string | null }>) {
    if (l.chat_id && l.linked_at) chatOf.set(l.user_id, String(l.chat_id))
  }
  return ((people ?? []) as Array<{ id: string; full_name: string | null; email: string | null; status: string | null }>)
    .filter((p) => p.status === 'approved')
    .map((p) => ({ userId: p.id, name: p.full_name?.trim() || null, email: p.email?.trim() || null, expertChatId: chatOf.get(p.id) ?? null }))
}

/**
 * Who is reminded about this thread: the assignee when he still may see the
 * inbox (approved staff with inbox.view), otherwise everyone with inbox.manage.
 * `managers` caches the second list within one run.
 */
export async function escalationRecipients(
  sb: SupabaseClient,
  thread: Pick<CommThreadRow, 'assignee_id'>,
  cache: { managers?: StaffContact[] } = {},
): Promise<{ recipients: StaffContact[]; assignee: boolean }> {
  if (thread.assignee_id) {
    const roles = await staffRoles(sb, [thread.assignee_id])
    if (hasPermission(roles.get(thread.assignee_id), 'inbox.view')) {
      const people = await contactsOf(sb, [thread.assignee_id])
      if (people.length) return { recipients: people, assignee: true }
    }
  }
  if (!cache.managers) {
    const roles = await staffRoles(sb)
    const ids = Array.from(roles.entries()).filter(([, role]) => hasPermission(role, 'inbox.manage')).map(([id]) => id)
    cache.managers = await contactsOf(sb, ids)
  }
  return { recipients: cache.managers, assignee: false }
}

// ─── Text ───────────────────────────────────────────────────────────────────

function esc(v: unknown): string {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function almaty(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return null
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Almaty', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d)
}

export function escalationTelegramText(n: EscalationNotice, now: Date): string {
  const since = n.thread.last_inbound_at ? new Date(n.thread.last_inbound_at).getTime() : NaN
  const waited = Number.isFinite(since) ? Math.max(1, Math.round((now.getTime() - since) / 60_000)) : null
  return [
    `⏰ <b>[AIStart360 · эксперт]</b> Пользователь ждёт ответа`,
    '',
    `<b>${esc(n.userName)}</b>${n.company ? ` · ${esc(n.company)}` : ''}`,
    ...(n.preview ? [`«${esc(n.preview)}»`] : []),
    ...(waited !== null ? [`Ждёт: ${waited} мин${almaty(n.thread.last_inbound_at) ? ` (написал(а) ${almaty(n.thread.last_inbound_at)}, Алматы)` : ''}`] : []),
    'Ответьте в GIGA «Сообщения» — ответ снимет напоминание.',
  ].join('\n')
}

// ─── Defaults (network) ─────────────────────────────────────────────────────

async function defaultSendTelegram(chatId: string, html: string, button: { text: string; url: string }): Promise<boolean> {
  const res = await sendMessage('expert', chatId, html, { inline_keyboard: [[button]] })
  if (!res.ok) console.error('[comm/escalation] expert bot send failed', res.description?.slice(0, 120))
  return res.ok
}

function defaultExpertBotReady(): boolean {
  return !!botToken('expert')
}

async function defaultSendEmail(input: Parameters<NonNullable<EscalationDeps['sendEmail']>>[0]): Promise<boolean> {
  const { sendTransactionalEmail } = await import('@/lib/email/send')
  const res = await sendTransactionalEmail({
    kind: 'comm_escalation', to: input.to, subject: input.subject, content: input.content,
    userId: input.userId, dedupeKey: input.dedupeKey,
  })
  return res.ok
}

async function defaultNotifyFeed(n: EscalationNotice, audience: { userIds: string[] | null }): Promise<void> {
  const { notifyStaff } = await import('@/lib/notifications/staff')
  await notifyStaff({
    level: 'WARNING',
    type: 'comm.escalation',
    title: `Ждёт ответа: ${n.userName}`.slice(0, 200),
    lines: [...(n.company ? [`Компания: ${n.company}`] : []), ...(n.preview ? [`«${n.preview}»`] : []), 'Срок ответа прошёл'],
    companyId: n.thread.company_id,
    entityType: 'comm_thread',
    entityId: n.thread.id,
    link: n.link,
    dedupeKey: `comm.escalation:${n.thread.id}:${n.thread.staff_reply_due_at ?? ''}`,
    audienceUserIds: audience.userIds,
    audiencePermission: audience.userIds ? 'inbox.view' : 'inbox.manage',
    skipCooldown: true,
    // The expert bot already carried it — the admin bot does not repeat it.
    telegramMinLevel: 'CRITICAL',
  })
}

// ─── Run ────────────────────────────────────────────────────────────────────

async function noticeFor(sb: SupabaseClient, thread: CommThreadRow): Promise<EscalationNotice> {
  const [{ data: person }, { data: company }, { data: last }] = await Promise.all([
    sb.from('profiles').select('full_name, email').eq('id', thread.user_id).maybeSingle(),
    sb.from('companies').select('name').eq('user_id', thread.user_id).limit(1).maybeSingle(),
    sb.from('comm_messages').select('body, body_masked').eq('thread_id', thread.id).eq('direction', 'in')
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  const p = person as { full_name?: string | null; email?: string | null } | null
  const m = last as { body?: string; body_masked?: string | null } | null
  const link = `${GIGA_MESSAGES_PATH}?user=${thread.user_id}`
  return {
    thread,
    userName: p?.full_name?.trim() || p?.email?.trim() || 'Пользователь',
    company: (company as { name?: string | null } | null)?.name ?? null,
    preview: m ? previewOf(m.body_masked ?? m.body ?? '') || null : thread.last_message_preview,
    link,
    url: getSiteUrl(link),
  }
}

/** One pass of the 30-minute rule (Inngest cron, every 5 minutes). */
export async function runEscalations(deps: EscalationDeps): Promise<EscalationReport> {
  const { sb } = deps
  const now = deps.now ?? new Date()
  const clock = deps.clock ?? Date.now
  const started = clock()
  const budget = deps.budgetMs ?? ESCALATION_BUDGET_MS
  const report: EscalationReport = { due: 0, escalated: 0, telegram: 0, email: 0, skipped: 0, budgetExhausted: false }

  const due = await selectOverdueThreads(sb, now, deps.limit ?? ESCALATION_BATCH)
  report.due = due.length
  if (!due.length) return report

  const botReady = (deps.expertBotReady ?? defaultExpertBotReady)()
  const sendTelegram = deps.sendTelegram ?? defaultSendTelegram
  const sendEmail = deps.sendEmail ?? defaultSendEmail
  const notifyFeed = deps.notifyFeed ?? defaultNotifyFeed
  const cache: { managers?: StaffContact[] } = {}

  for (const thread of due) {
    if (clock() - started > budget) { report.budgetExhausted = true; break }
    if (!(await claimEscalation(sb, thread, now))) { report.skipped++; continue }
    report.escalated++
    try {
      const notice = await noticeFor(sb, thread)
      const { recipients, assignee } = await escalationRecipients(sb, thread, cache)
      const button = { text: 'Открыть диалог', url: notice.url }
      const html = escalationTelegramText(notice, now)
      for (const r of recipients) {
        if (botReady && r.expertChatId) {
          try { if (await sendTelegram(r.expertChatId, html, button)) report.telegram++ } catch (err) {
            console.error('[comm/escalation] telegram', err instanceof Error ? err.message.slice(0, 120) : err)
          }
        }
        if (r.email) {
          const built = buildCommEscalationEmail({
            name: r.name, userName: notice.userName, company: notice.company, preview: notice.preview,
            waitingSince: thread.last_inbound_at, dueAt: thread.staff_reply_due_at, url: notice.url,
          })
          try {
            const ok = await sendEmail({
              to: r.email, userId: r.userId, subject: built.subject, content: built.content,
              dedupeKey: `comm-escalation:${thread.id}:${thread.staff_reply_due_at ?? ''}:${r.userId}`,
            })
            if (ok) report.email++
          } catch (err) {
            console.error('[comm/escalation] email', err instanceof Error ? err.message.slice(0, 120) : err)
          }
        }
      }
      await notifyFeed(notice, { userIds: assignee ? recipients.map((r) => r.userId) : null }).catch((err: unknown) => {
        console.error('[comm/escalation] feed', err instanceof Error ? err.message.slice(0, 120) : err)
      })
    } catch (err) {
      // escalated_at stays set: a broken recipient lookup must not remind every 5 minutes.
      console.error('[comm/escalation] thread failed', thread.id, err instanceof Error ? err.message.slice(0, 160) : err)
    }
  }
  return report
}
