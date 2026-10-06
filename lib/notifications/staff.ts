/**
 * lib/notifications/staff.ts — tell the team about something that matters.
 *
 * notifyStaff() records a notification_events row (the admin feed, deduped by
 * key) and delivers it per channel rules (levels.ts):
 *   telegram  (the admin bot when TELEGRAM_ADMIN_BOT_* is configured, else the
 *             client bot — lib/telegram/bots/registry.ts staffBot())
 *             linked staff whose own threshold and the platform threshold the
 *             level reaches; approvals go only to staff with approvals.decide,
 *             with Approve / Reject buttons. Legacy TELEGRAM_ADMIN_CHAT_IDS get
 *             the same text without buttons.
 *   email     ADMIN_NOTIFICATION_EMAIL for CRITICAL (by default).
 *   in_app    the event row itself (GIGA feed).
 * Every attempt is a notification_deliveries row (status, error, message id).
 * A per-type, per-company cooldown keeps repeated warnings out of Telegram.
 *
 * Crash safety: each recipient is first CLAIMED with a 'queued' delivery row
 * (one sender per event and target), then resolved to sent / failed / skipped.
 * A repeated call with the same dedupe key does not re-notify anyone who was
 * handled already, but resumes the recipients that a crashed or killed earlier
 * run never reached (no delivery row, or a 'queued' claim older than
 * CLAIM_STALE_SECONDS). Only recipients linked before the event was recorded
 * are resumed, so a late link does not receive old news.
 */
import { prisma } from '@/lib/db'
import { hasPermission, isStaffRole, type StaffRole } from '@/lib/admin/rbac'
import { sendNotificationEmail } from '@/lib/email/notification'
import { getSiteUrl } from '@/lib/site-url'
import { sendBotMessage, tgEscape, type InlineButton } from '@/lib/telegram/bot-api'
import { staffBot } from '@/lib/telegram/bots/registry'
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

/** A 'queued' claim older than this is treated as abandoned by a dead run. */
const CLAIM_STALE_SECONDS = 120

async function linkedStaff(linkedBefore: Date | null): Promise<Recipient[]> {
  const rows = await prisma.$queryRaw<Array<{
    user_id: string; chat_id: string; min_level: OrderedLevel; muted_until: Date | null; profile_role: string | null; staff_role: string | null
  }>>`
    SELECT l.user_id, l.chat_id, l.min_level, l.muted_until, p.role AS profile_role, s.role AS staff_role
    FROM public.staff_telegram_links l
    JOIN public.profiles p ON p.id = l.user_id AND p.status = 'approved'
    LEFT JOIN public.staff_roles s ON s.user_id = l.user_id
    WHERE l.linked_at IS NOT NULL AND l.chat_id IS NOT NULL
      AND (${linkedBefore}::timestamptz IS NULL OR l.linked_at <= ${linkedBefore}::timestamptz)`
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

/**
 * Claim (event, channel, target) for this run: true when this run owns the
 * delivery — no row yet, or an abandoned 'queued' claim. A row that is already
 * sent / failed / skipped, or claimed recently by another run, is left alone.
 */
async function claimDelivery(eventId: string, channel: string, target: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO public.notification_deliveries (event_id, channel, target, status, attempts)
    VALUES (${eventId}::uuid, ${channel}, ${target}, 'queued', 0)
    ON CONFLICT (event_id, channel, target) DO UPDATE SET status = 'queued'
      WHERE public.notification_deliveries.status = 'queued'
        AND public.notification_deliveries.updated_at < now() - make_interval(secs => ${CLAIM_STALE_SECONDS}::int)
    RETURNING id::text`
  return rows.length > 0
}

async function recordDelivery(eventId: string, channel: string, target: string, status: string, extra: {
  reason?: string | null; error?: string | null; messageId?: string | null
} = {}): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO public.notification_deliveries (event_id, channel, target, status, skip_reason, error, provider_message_id, attempts, sent_at)
    VALUES (${eventId}::uuid, ${channel}, ${target}, ${status}, ${extra.reason ?? null}, ${extra.error ?? null},
            ${extra.messageId ?? null}, ${status === 'skipped' ? 0 : 1}, ${status === 'sent' ? new Date() : null})
    ON CONFLICT (event_id, channel, target) DO UPDATE
      SET status = EXCLUDED.status, skip_reason = EXCLUDED.skip_reason, error = EXCLUDED.error,
          provider_message_id = EXCLUDED.provider_message_id,
          attempts = public.notification_deliveries.attempts + EXCLUDED.attempts, sent_at = EXCLUDED.sent_at`
}

/** Telegram already delivered this type for this company recently (another event). */
async function inCooldown(n: StaffNotification, eventId: string): Promise<boolean> {
  if (n.level === 'CRITICAL' || n.level === 'APPROVAL_REQUIRED' || COOLDOWN_MINUTES <= 0) return false
  const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*) AS n FROM public.notification_deliveries d
    JOIN public.notification_events e ON e.id = d.event_id
    WHERE d.channel = 'telegram' AND d.status = 'sent' AND e.type = ${n.type}
      AND e.company_id IS NOT DISTINCT FROM ${n.companyId ?? null}
      AND e.id <> ${eventId}::uuid
      AND d.sent_at > now() - make_interval(mins => ${COOLDOWN_MINUTES}::int)`
  return Number(rows[0]?.n ?? 0) > 0
}

/** Insert the feed row, or find the existing one for this dedupe key. */
async function recordEvent(n: StaffNotification): Promise<{ id: string; createdAt: Date; duplicate: boolean } | null> {
  const inserted = await prisma.$queryRaw<Array<{ id: string; created_at: Date }>>`
    INSERT INTO public.notification_events
      (level, type, title, body, company_id, entity_type, entity_id, approval_id, agent_key, data, dedupe_key, audience)
    VALUES (${n.level}, ${n.type}, ${n.title.slice(0, 200)}, ${(n.lines ?? []).join('\n').slice(0, 4000)},
            ${n.companyId ?? null}, ${n.entityType ?? null}, ${n.entityId ?? null}, ${n.approvalId ?? null}::uuid,
            ${n.agentKey ?? null}, ${JSON.stringify(n.data ?? {})}::jsonb, ${n.dedupeKey ?? null}, 'staff')
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING id::text, created_at`
  if (inserted[0]) return { id: inserted[0].id, createdAt: inserted[0].created_at, duplicate: false }
  const existing = await prisma.$queryRaw<Array<{ id: string; created_at: Date }>>`
    SELECT id::text, created_at FROM public.notification_events WHERE dedupe_key = ${n.dedupeKey ?? null}`
  return existing[0] ? { id: existing[0].id, createdAt: existing[0].created_at, duplicate: true } : null
}

export async function notifyStaff(n: StaffNotification, opts: { fetchImpl?: typeof fetch; now?: Date } = {}): Promise<NotifyResult> {
  const event = await recordEvent(n)
  if (!event) return { eventId: null, duplicate: true, deliveries: [] }
  const eventId = event.id

  const cfg = routingConfig()
  const deliveries: NotifyResult['deliveries'] = []
  const skip = async (channel: string, target: string, reason: string) => {
    await recordDelivery(eventId, channel, target, 'skipped', { reason })
    deliveries.push({ channel, target, status: 'skipped', reason })
  }

  // ── Telegram ──
  const bot = staffBot()
  const text = formatTelegram(n)
  const quiet = inQuietHours(n.level, cfg, opts.now)
  const cooled = await inCooldown(n, eventId)
  const staff = await linkedStaff(event.duplicate ? event.createdAt : null)
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
    if (!(await claimDelivery(eventId, 'telegram', s.chatId))) continue
    if (!reaches(n.level, cfg.telegramMinLevel)) { await skip('telegram', s.chatId, 'below_platform_level'); continue }
    if (!reaches(n.level, s.minLevel)) { await skip('telegram', s.chatId, 'below_personal_level'); continue }
    if (s.mutedUntil && s.mutedUntil > (opts.now ?? new Date()) && !isApproval && n.level !== 'CRITICAL') { await skip('telegram', s.chatId, 'muted'); continue }
    if (quiet) { await skip('telegram', s.chatId, 'quiet_hours'); continue }
    if (cooled) { await skip('telegram', s.chatId, 'cooldown'); continue }
    const res = await sendBotMessage(s.chatId, text, keyboard, opts.fetchImpl, bot)
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
    if (!(await claimDelivery(eventId, 'telegram', chatId))) continue
    if (!reaches(n.level, cfg.telegramMinLevel)) { await skip('telegram', chatId, 'below_platform_level'); continue }
    if (quiet) { await skip('telegram', chatId, 'quiet_hours'); continue }
    if (cooled) { await skip('telegram', chatId, 'cooldown'); continue }
    const legacyText = isApproval ? `${text}\n\nРешение — в панели GIGA (кнопки доступны после привязки Telegram к аккаунту сотрудника).` : text
    const res = await sendBotMessage(chatId, legacyText, undefined, opts.fetchImpl, bot)
    await recordDelivery(eventId, 'telegram', chatId, res.ok ? 'sent' : 'failed', res.ok ? { messageId: String(res.result.message_id) } : { error: res.description })
    deliveries.push({ channel: 'telegram', target: chatId, status: res.ok ? 'sent' : 'failed', reason: res.ok ? undefined : res.description })
  }

  // ── Email ──
  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL || process.env.ADMIN_EMAIL
  if (adminEmail && reaches(n.level, cfg.emailMinLevel) && n.level !== 'APPROVAL_REQUIRED' && (await claimDelivery(eventId, 'email', adminEmail))) {
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

  return { eventId, duplicate: event.duplicate, deliveries }
}
