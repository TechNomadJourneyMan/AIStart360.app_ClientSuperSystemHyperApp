/**
 * Notifications to experts linked in the expert bot:
 *   report review          REPORT_GENERATED with status 'in_review' (103): the
 *                          PDF with decision buttons (./review.ts via
 *                          lib/reports/review-delivery.ts, also email copies)
 *   diagnostic.completed   DIAGNOSTIC_COMPLETED platform event (event-router)
 *   report.published       a report version published in GIGA or the admin bot
 *   client.approved        a registration approved (lib/users/access-requests.ts)
 *
 * Rules (lib/notifications/levels.ts): the expert's own level (default INFO)
 * and mute, platform quiet hours (night: only CRITICAL). The platform Telegram
 * threshold for STAFF (WARNING) does not apply — these are the expert's work
 * items, opted into by linking. Every recipient gets one delivery per
 * dedupe key (telegram_bot_deliveries, 095). Without the expert bot
 * configured nothing is read or sent.
 */
import { prisma } from '@/lib/db'
import { expertBotRole, isExpertBotMember } from '@/lib/expert-auth'
import { inQuietHours, LEVEL_ICONS, reaches, routingConfig, type OrderedLevel } from '@/lib/notifications/levels'
import type { PlatformEventRow } from '@/lib/events/platform'
import { getSiteUrl } from '@/lib/site-url'
import { signCallback } from '../callback'
import { isBotConfigured, sendMessage, type InlineButton } from '../registry'
import { esc } from '../ui'

export type ExpertNoticeKind = 'diagnostic.completed' | 'report.published' | 'client.approved'

export interface ExpertNotice {
  kind: ExpertNoticeKind
  dedupeKey: string
  title?: string
  lines: string[]
  companyId?: string | null
  reportId?: string | null
  level?: OrderedLevel
}

const TITLES: Record<ExpertNoticeKind, string> = {
  'diagnostic.completed': 'Диагностика завершена',
  'report.published': 'Отчёт опубликован клиенту',
  'client.approved': 'Новый клиент одобрен',
}

export interface ExpertDelivery { chatId: string; status: 'sent' | 'failed' | 'skipped'; reason?: string }

interface Recipient { userId: string; chatId: string; minLevel: OrderedLevel; mutedUntil: Date | null; role: string }

async function linkedExperts(): Promise<Recipient[]> {
  const rows = await prisma.$queryRaw<Array<{ user_id: string; chat_id: string; min_level: OrderedLevel; muted_until: Date | null; role: string; staff_role: string | null }>>`
    SELECT l.user_id::text, l.chat_id, l.min_level, l.muted_until, p.role, s.role AS staff_role
    FROM public.telegram_bot_links l
    JOIN public.profiles p ON p.id = l.user_id AND p.status = 'approved'
    LEFT JOIN public.staff_roles s ON s.user_id = l.user_id
    WHERE l.bot = 'expert' AND l.linked_at IS NOT NULL AND l.chat_id IS NOT NULL`
  return rows
    .filter((r) => isExpertBotMember(r.role, r.staff_role))
    .map((r) => ({ userId: r.user_id, chatId: r.chat_id, minLevel: r.min_level, mutedUntil: r.muted_until, role: expertBotRole(r.role, r.staff_role) }))
}

async function claim(key: string, chatId: string, status: 'sent' | 'skipped', reason: string | null): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ chat_id: string }>>`
    INSERT INTO public.telegram_bot_deliveries (bot, dedupe_key, chat_id, status, reason)
    VALUES ('expert', ${key.slice(0, 200)}, ${chatId}, ${status}, ${reason})
    ON CONFLICT (bot, dedupe_key, chat_id) DO NOTHING RETURNING chat_id`
  return rows.length > 0
}

export function formatExpertNotice(n: ExpertNotice): string {
  const level = n.level ?? 'SUCCESS'
  return [`${LEVEL_ICONS[level]} <b>[AIStart360 · эксперт]</b> ${esc(n.title ?? TITLES[n.kind])}`, '', ...n.lines.map(esc)].join('\n')
}

export async function notifyExperts(n: ExpertNotice, opts: { fetchImpl?: typeof fetch; now?: Date } = {}): Promise<ExpertDelivery[]> {
  if (!isBotConfigured('expert')) return []
  const level = n.level ?? 'SUCCESS'
  const now = opts.now ?? new Date()
  const quiet = inQuietHours(level, routingConfig(), now)
  const text = formatExpertNotice(n)
  const row: InlineButton[] = []
  if (n.companyId) {
    const data = signCallback('expert', 'cl.c', n.companyId)
    if (data) row.push({ text: '🏢 Карточка клиента', callback_data: data })
  }
  if (n.reportId) row.push({ text: '📄 PDF', url: getSiteUrl(`/api/v1/reports/${n.reportId}/pdf`) })

  const out: ExpertDelivery[] = []
  for (const r of await linkedExperts()) {
    const skipReason = !reaches(level, r.minLevel) ? 'below_personal_level'
      : r.mutedUntil && r.mutedUntil > now && level !== 'CRITICAL' ? 'muted'
        : quiet ? 'quiet_hours' : null
    if (skipReason) {
      if (await claim(n.dedupeKey, r.chatId, 'skipped', skipReason)) out.push({ chatId: r.chatId, status: 'skipped', reason: skipReason })
      continue
    }
    if (!(await claim(n.dedupeKey, r.chatId, 'sent', null))) {
      out.push({ chatId: r.chatId, status: 'skipped', reason: 'duplicate' })
      continue
    }
    const res = await sendMessage('expert', r.chatId, text, row.length ? { inline_keyboard: [row] } : undefined, opts.fetchImpl)
    if (!res.ok) {
      await prisma.$executeRaw`
        UPDATE public.telegram_bot_deliveries SET status = 'failed', reason = ${res.description.slice(0, 200)}
        WHERE bot = 'expert' AND dedupe_key = ${n.dedupeKey.slice(0, 200)} AND chat_id = ${r.chatId}`
      out.push({ chatId: r.chatId, status: 'failed', reason: res.description })
    } else {
      out.push({ chatId: r.chatId, status: 'sent' })
    }
  }
  return out
}

/** Fire-and-forget variant: never throws (callers are request handlers and the event router). */
export async function notifyExpertsSafely(n: ExpertNotice): Promise<void> {
  try {
    await notifyExperts(n)
  } catch (err) {
    console.error('[telegram/expert] notify failed:', err instanceof Error ? err.message.split('\n')[0] : err)
  }
}

/** Platform event → expert notice (only DIAGNOSTIC_COMPLETED today). */
export async function expertNoticeForEvent(e: PlatformEventRow): Promise<ExpertNotice | null> {
  if (e.name !== 'DIAGNOSTIC_COMPLETED') return null
  const p = e.payload ?? {}
  const company = e.company_id
    ? (await prisma.$queryRaw<Array<{ name: string }>>`SELECT name FROM public.companies WHERE id = ${e.company_id}`)[0]?.name ?? null
    : null
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  return {
    kind: 'diagnostic.completed',
    dedupeKey: `event:${e.id}`,
    companyId: e.company_id,
    lines: [
      company ? `Клиент: ${company}` : null,
      num(p.score) !== null ? `Точка А: ${num(p.score)}/100` : null,
      num(p.critical_findings) !== null ? `Критических выводов: ${num(p.critical_findings)}` : null,
    ].filter((l): l is string => Boolean(l)),
  }
}

export async function routeEventToExperts(e: PlatformEventRow): Promise<void> {
  // A report version waiting for the expert: PDF + buttons in the bot and email
  // copies (each channel decides for itself whether it is configured).
  if (e.name === 'REPORT_GENERATED' && e.payload?.status === 'in_review' && e.subject_id) {
    const { deliverReportForReview } = await import('@/lib/reports/review-delivery')
    const report = await deliverReportForReview(e.subject_id)
    if (report?.telegram.some((d) => d.status === 'failed')) {
      console.error(`[telegram/expert] report review delivery: ${report.telegram.filter((d) => d.status === 'failed').length} failed`)
    }
    return
  }
  if (!isBotConfigured('expert')) return
  const n = await expertNoticeForEvent(e)
  if (n) await notifyExperts(n)
}

export async function notifyClientApprovedSafely(userId: string): Promise<void> {
  if (!isBotConfigured('expert')) return
  try {
    const rows = await prisma.$queryRaw<Array<{ full_name: string | null; organization: string | null; company_id: string | null; company_name: string | null }>>`
      SELECT p.full_name, p.organization, c.id AS company_id, c.name AS company_name
      FROM public.profiles p LEFT JOIN public.companies c ON c.user_id = p.id
      WHERE p.id = ${userId}::uuid AND p.role IN ('client', 'owner')`
    const r = rows[0]
    if (!r) return
    await notifyExperts({
      kind: 'client.approved',
      dedupeKey: `client.approved:${userId}`,
      companyId: r.company_id,
      lines: [r.full_name ? `Клиент: ${r.full_name}` : null, (r.company_name ?? r.organization) ? `Компания: ${r.company_name ?? r.organization}` : null]
        .filter((l): l is string => Boolean(l)),
    })
  } catch (err) {
    console.error('[telegram/expert] client approved notice failed:', err instanceof Error ? err.message.split('\n')[0] : err)
  }
}
