/**
 * lib/notifications/staff.ts — tell the team about something that matters.
 *
 * notifyStaff() records a notification_events row (the admin feed, deduped by
 * key) and delivers it per channel rules (levels.ts):
 *   telegram  linked staff whose own threshold and the platform threshold the
 *             level reaches; approvals go only to staff with approvals.decide,
 *             with Approve / Reject buttons. Legacy TELEGRAM_ADMIN_CHAT_IDS get
 *             the same text without buttons.
 *   email     ADMIN_NOTIFICATION_EMAIL for CRITICAL (by default).
 *   in_app    the event row itself (GIGA feed).
 * Every attempt is a notification_deliveries row (status, error, message id).
 * A per-type, per-company cooldown keeps repeated warnings out of Telegram.
 */
import { prisma } from '@/lib/db'
import { hasPermission, isStaffRole, type StaffRole } from '@/lib/admin/rbac'
import { sendNotificationEmail } from '@/lib/email/notification'
import { getSiteUrl } from '@/lib/site-url'
import { sendBotMessage, tgEscape, type InlineButton } from '@/lib/telegram/bot-api'
import { approvalCallbackData } from './approval-callback'
import { inQuietHours, LEVEL_ICONS, LEVEL_LABELS, reaches, routingConfig, type NotificationLevel, type OrderedLevel } from './levels'

export interface StaffNotification {
  level: NotificationLevel
  /** dotted snake key, e.g. 'agent.failed', 'diagnostic.completed'. */
  type: string
  title: string
  /** Plain-text lines (escaped for Telegram/email). */
  lines?: string[]
  companyId?: string | null
  entityType?: string | null
  entityId?: string | null
  approvalId?: string | null
  agentKey?: string | null
  data?: Record<string, unknown>
  dedupeKey?: string | null
  /** Admin-panel path for the "open" link, e.g. '/admin-giga-panel/agents/runs/<id>'. */
  link?: string | null
}

export interface NotifyResult {
  eventId: string | null
  duplicate: boolean
  deliveries: Array<{ channel: string; target: string; status: string; reason?: string }>
}

/** Telegram cooldown per (type, company) for INFO..WARNING. */
const COOLDOWN_MINUTES = Number(process.env.NOTIFY_COOLDOWN_MINUTES ?? 30)

interface Recipient {
  userId: string
  chatId: string
  minLevel: OrderedLevel
  role: StaffRole | null
  mutedUntil: Date | null
}

async function linkedStaff(): Promise<Recipient[]> {
  const rows = await prisma.$queryRaw<Array<{
    user_id: string; chat_id: string; min_level: OrderedLevel; muted_until: Date | null; profile_role: string | null; staff_role: string | null
  }>>`
    SELECT l.user_id, l.chat_id, l.min_level, l.muted_until, p.role AS profile_role, s.role AS staff_role
    FROM public.staff_telegram_links l
    JOIN public.profiles p ON p.id = l.user_id AND p.status = 'approved'
    LEFT JOIN public.staff_roles s ON s.user_id = l.user_id
    WHERE l.linked_at IS NOT NULL AND l.chat_id IS NOT NULL`
  return rows
    .map((r) => {
      const role: StaffRole | null = r.profile_role === 'super_admin' ? 'super_admin' : isStaffRole(r.staff_role) ? r.staff_role : null
      return { userId: r.user_id, chatId: r.chat_id, minLevel: r.min_level, role, mutedUntil: r.muted_until }
    })
    .filter((r) => r.role !== null)
}

function legacyChatIds(): string[] {
  const raw = process.env.TELEGRAM_ADMIN_CHAT_IDS || process.env.TELEGRAM_CHAT_ID || ''
  return raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
}

export function formatTelegram(n: StaffNotification): string {
  const head = `${LEVEL_ICONS[n.level]} <b>[AIStart360]</b> ${tgEscape(LEVEL_LABELS[n.level])}`
  const body = [`<b>${tgEscape(n.title)}</b>`, ...(n.lines ?? []).map(tgEscape)]
  const link = n.link ? `\n<a href="${tgEscape(getSiteUrl(n.link))}">Открыть в панели</a>` : ''
  return `${head}\n\n${body.join('\n')}${link}`
}

async function recordDelivery(eventId: string, channel: string, target: string, status: string, extra: {
  reason?: string | null; error?: string | null; messageId?: string | null
} = {}): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO public.notification_deliveries (event_id, channel, target, status, skip_reason, error, provider_message_id, attempts, sent_at)
    VALUES (${eventId}::uuid, ${channel}, ${target}, ${status}, ${extra.reason ?? null}, ${extra.error ?? null},
            ${extra.messageId ?? null}, ${status === 'skipped' ? 0 : 1}, ${status === 'sent' ? new Date() : null})
    ON CONFLICT (event_id, channel, target) DO UPDATE
      SET status = EXCLUDED.status, error = EXCLUDED.error, provider_message_id = EXCLUDED.provider_message_id,
          attempts = public.notification_deliveries.attempts + 1, sent_at = EXCLUDED.sent_at`
}

async function inCooldown(n: StaffNotification): Promise<boolean> {
  if (n.level === 'CRITICAL' || n.level === 'APPROVAL_REQUIRED' || COOLDOWN_MINUTES <= 0) return false
  const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*) AS n FROM public.notification_deliveries d
    JOIN public.notification_events e ON e.id = d.event_id
    WHERE d.channel = 'telegram' AND d.status = 'sent' AND e.type = ${n.type}
      AND e.company_id IS NOT DISTINCT FROM ${n.companyId ?? null}
      AND d.sent_at > now() - make_interval(mins => ${COOLDOWN_MINUTES}::int)`
  return Number(rows[0]?.n ?? 0) > 0
}

export async function notifyStaff(n: StaffNotification, opts: { fetchImpl?: typeof fetch; now?: Date } = {}): Promise<NotifyResult> {
  const inserted = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO public.notification_events
      (level, type, title, body, company_id, entity_type, entity_id, approval_id, agent_key, data, dedupe_key, audience)
    VALUES (${n.level}, ${n.type}, ${n.title.slice(0, 200)}, ${(n.lines ?? []).join('\n').slice(0, 4000)},
            ${n.companyId ?? null}, ${n.entityType ?? null}, ${n.entityId ?? null}, ${n.approvalId ?? null}::uuid,
            ${n.agentKey ?? null}, ${JSON.stringify(n.data ?? {})}::jsonb, ${n.dedupeKey ?? null}, 'staff')
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING id`
  const eventId = inserted[0]?.id ?? null
  if (!eventId) return { eventId: null, duplicate: true, deliveries: [] }

  const cfg = routingConfig()
  const deliveries: NotifyResult['deliveries'] = []
  const skip = async (channel: string, target: string, reason: string) => {
    await recordDelivery(eventId, channel, target, 'skipped', { reason })
    deliveries.push({ channel, target, status: 'skipped', reason })
  }

  // ── Telegram ──
  const text = formatTelegram(n)
  const quiet = inQuietHours(n.level, cfg, opts.now)
  const cooled = await inCooldown(n)
  const staff = await linkedStaff()
  const isApproval = n.level === 'APPROVAL_REQUIRED'
  const keyboard: InlineButton[][] | undefined = isApproval && n.approvalId
    ? (() => {
        const yes = approvalCallbackData(n.approvalId!, 'approve')
        const no = approvalCallbackData(n.approvalId!, 'reject')
        return yes && no ? [[{ text: '✅ Одобрить', callback_data: yes }, { text: '❌ Отклонить', callback_data: no }]] : undefined
      })()
    : undefined

  const targets = staff.filter((s) => (isApproval ? hasPermission(s.role, 'approvals.decide') : true))
  for (const s of targets) {
    if (!reaches(n.level, cfg.telegramMinLevel)) { await skip('telegram', s.chatId, 'below_platform_level'); continue }
    if (!reaches(n.level, s.minLevel)) { await skip('telegram', s.chatId, 'below_personal_level'); continue }
    if (s.mutedUntil && s.mutedUntil > (opts.now ?? new Date()) && !isApproval && n.level !== 'CRITICAL') { await skip('telegram', s.chatId, 'muted'); continue }
    if (quiet) { await skip('telegram', s.chatId, 'quiet_hours'); continue }
    if (cooled) { await skip('telegram', s.chatId, 'cooldown'); continue }
    const res = await sendBotMessage(s.chatId, text, keyboard, opts.fetchImpl)
    if (res.ok) {
      await recordDelivery(eventId, 'telegram', s.chatId, 'sent', { messageId: String(res.result.message_id) })
      deliveries.push({ channel: 'telegram', target: s.chatId, status: 'sent' })
    } else {
      await recordDelivery(eventId, 'telegram', s.chatId, 'failed', { error: res.description })
      deliveries.push({ channel: 'telegram', target: s.chatId, status: 'failed', reason: res.description })
    }
  }

  // Legacy env chats: same text, no buttons (cannot attribute a press to a person).
  const linkedChats = new Set(staff.map((s) => s.chatId))
  for (const chatId of legacyChatIds()) {
    if (linkedChats.has(chatId)) continue
    if (!reaches(n.level, cfg.telegramMinLevel)) { await skip('telegram', chatId, 'below_platform_level'); continue }
    if (quiet) { await skip('telegram', chatId, 'quiet_hours'); continue }
    if (cooled) { await skip('telegram', chatId, 'cooldown'); continue }
    const legacyText = isApproval ? `${text}\n\nРешение — в панели GIGA (кнопки доступны после привязки Telegram к аккаунту сотрудника).` : text
    const res = await sendBotMessage(chatId, legacyText, undefined, opts.fetchImpl)
    await recordDelivery(eventId, 'telegram', chatId, res.ok ? 'sent' : 'failed', res.ok ? { messageId: String(res.result.message_id) } : { error: res.description })
    deliveries.push({ channel: 'telegram', target: chatId, status: res.ok ? 'sent' : 'failed', reason: res.ok ? undefined : res.description })
  }

  // ── Email ──
  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL || process.env.ADMIN_EMAIL
  if (adminEmail && reaches(n.level, cfg.emailMinLevel) && n.level !== 'APPROVAL_REQUIRED') {
    try {
      const res = await sendNotificationEmail({
        to: adminEmail,
        subject: `[AIStart360] ${LEVEL_LABELS[n.level]}: ${n.title}`.slice(0, 180),
        title: n.title,
        body: (n.lines ?? []).join('\n'),
        ctaLabel: n.link ? 'Открыть в панели' : undefined,
        ctaUrl: n.link ? getSiteUrl(n.link) : undefined,
      })
      const failed = res && typeof res === 'object' && 'error' in res && res.error
      await recordDelivery(eventId, 'email', adminEmail, failed ? 'failed' : 'sent', failed ? { error: String((res as { error: unknown }).error).slice(0, 300) } : {})
      deliveries.push({ channel: 'email', target: adminEmail, status: failed ? 'failed' : 'sent' })
    } catch (err) {
      await recordDelivery(eventId, 'email', adminEmail, 'failed', { error: err instanceof Error ? err.message.slice(0, 300) : 'error' })
      deliveries.push({ channel: 'email', target: adminEmail, status: 'failed' })
    }
  }

  return { eventId, duplicate: false, deliveries }
}
