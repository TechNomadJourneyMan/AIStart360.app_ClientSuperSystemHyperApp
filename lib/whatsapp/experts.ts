/**
 * lib/whatsapp/experts.ts — WhatsApp copy of the expert notifications.
 *
 * Same rules as the expert bot (lib/telegram/bots/expert/notify.ts): the
 * expert's own level (default INFO) and mute, platform quiet hours (night:
 * only CRITICAL). Recipients: experts (EXPERT_ROLES) with an opted-in,
 * verified WhatsApp number (whatsapp_links, kind 'expert'). One message per
 * notice and person (outbox idempotency key). Telegram buttons become a link
 * to the expert cabinet in the template's URL button.
 *
 * Experts never go through the WhatsApp Web bridge — Cloud API only.
 */
import { prisma } from '@/lib/db'
import { EXPERT_ROLES } from '@/lib/expert-auth'
import { inQuietHours, reaches, routingConfig, type OrderedLevel } from '@/lib/notifications/levels'
import type { PlatformEventRow } from '@/lib/events/platform'
import { cloudApiConfigured, type WhatsAppEnv } from './config'
import { optedInRecipients } from './links'
import { enqueueWhatsApp, outboxKey, sendWhatsAppNow, type DrainOptions } from './outbox'
import { expertNotificationTemplate } from './templates'

export type ExpertWhatsAppKind = 'diagnostic.completed' | 'report.published' | 'client.approved'

export interface ExpertWhatsAppNotice {
  kind: ExpertWhatsAppKind
  dedupeKey: string
  title?: string
  lines: string[]
  companyId?: string | null
  reportId?: string | null
  level?: OrderedLevel
}

const TITLES: Record<ExpertWhatsAppKind, string> = {
  'diagnostic.completed': 'Диагностика завершена',
  'report.published': 'Отчёт опубликован клиенту',
  'client.approved': 'Новый клиент одобрен',
}

export interface ExpertWhatsAppDelivery { userId: string; status: 'queued' | 'skipped'; reason?: string; outboxId?: string }

async function clientPath(n: ExpertWhatsAppNotice): Promise<string> {
  if (n.reportId) return 'expert/reports'
  if (!n.companyId) return 'expert/clients'
  const rows = await prisma.$queryRaw<Array<{ user_id: string | null }>>`
    SELECT user_id::text FROM public.companies WHERE id = ${n.companyId}`
  return rows[0]?.user_id ? `expert/clients/${rows[0].user_id}` : 'expert/clients'
}

export async function notifyExpertsWhatsApp(
  n: ExpertWhatsAppNotice,
  opts: { now?: Date; env?: WhatsAppEnv; drain?: Omit<DrainOptions, 'ids'> } = {},
): Promise<ExpertWhatsAppDelivery[]> {
  const env = opts.env ?? process.env
  if (!cloudApiConfigured(opts.drain?.meta?.env ?? env)) return []
  const level = n.level ?? 'SUCCESS'
  const now = opts.now ?? new Date()
  const quiet = inQuietHours(level, routingConfig(), now)
  const recipients = (await optedInRecipients('expert')).filter((r) => r.role !== null && EXPERT_ROLES.has(r.role))
  if (recipients.length === 0) return []

  const payload = expertNotificationTemplate({ title: n.title ?? TITLES[n.kind], lines: n.lines, path: await clientPath(n) })
  const out: ExpertWhatsAppDelivery[] = []
  const ids: string[] = []
  for (const r of recipients) {
    const reason = !reaches(level, r.minLevel) ? 'below_personal_level'
      : r.mutedUntil && r.mutedUntil > now && level !== 'CRITICAL' ? 'muted'
        : quiet ? 'quiet_hours' : null
    if (reason) { out.push({ userId: r.userId, status: 'skipped', reason }); continue }
    const row = await enqueueWhatsApp({
      idempotencyKey: outboxKey('expert', n.dedupeKey, r.userId),
      kind: 'expert',
      userId: r.userId,
      phoneE164: r.phone,
      payload,
      level,
      env,
    })
    if (!row.created) { out.push({ userId: r.userId, status: 'skipped', reason: 'duplicate' }); continue }
    ids.push(row.id)
    out.push({ userId: r.userId, status: 'queued', outboxId: row.id })
  }
  await sendWhatsAppNow(ids, { ...opts.drain, now, env })
  return out
}

/** Never throws (request handlers and the event router call it). */
export async function notifyExpertsWhatsAppSafely(n: ExpertWhatsAppNotice): Promise<void> {
  try {
    await notifyExpertsWhatsApp(n)
  } catch (err) {
    console.error('[whatsapp/experts] notify failed:', err instanceof Error ? err.message.split('\n')[0] : 'error')
  }
}

/** Platform event → WhatsApp expert notice (DIAGNOSTIC_COMPLETED, like the expert bot). */
export async function routeEventToExpertsWhatsApp(e: PlatformEventRow): Promise<void> {
  if (e.name !== 'DIAGNOSTIC_COMPLETED' || !cloudApiConfigured()) return
  const p = e.payload ?? {}
  const company = e.company_id
    ? (await prisma.$queryRaw<Array<{ name: string }>>`SELECT name FROM public.companies WHERE id = ${e.company_id}`)[0]?.name ?? null
    : null
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  await notifyExpertsWhatsApp({
    kind: 'diagnostic.completed',
    dedupeKey: `event:${e.id}`,
    companyId: e.company_id,
    lines: [
      company ? `Клиент: ${company}` : null,
      num(p.score) !== null ? `Точка А: ${num(p.score)}/100` : null,
      num(p.critical_findings) !== null ? `Критических выводов: ${num(p.critical_findings)}` : null,
    ].filter((l): l is string => Boolean(l)),
  })
}

/** client.approved notice for a newly approved registration. Never throws. */
export async function notifyClientApprovedWhatsAppSafely(userId: string): Promise<void> {
  try {
    if (!cloudApiConfigured()) return
    const rows = await prisma.$queryRaw<Array<{ full_name: string | null; organization: string | null; company_id: string | null; company_name: string | null }>>`
      SELECT p.full_name, p.organization, c.id AS company_id, c.name AS company_name
      FROM public.profiles p LEFT JOIN public.companies c ON c.user_id = p.id
      WHERE p.id = ${userId}::uuid AND p.role IN ('client', 'owner')`
    const r = rows[0]
    if (!r) return
    await notifyExpertsWhatsApp({
      kind: 'client.approved',
      dedupeKey: `client.approved:${userId}`,
      companyId: r.company_id,
      lines: [r.full_name ? `Клиент: ${r.full_name}` : null, (r.company_name ?? r.organization) ? `Компания: ${r.company_name ?? r.organization}` : null]
        .filter((l): l is string => Boolean(l)),
    })
  } catch (err) {
    console.error('[whatsapp/experts] client approved notice failed:', err instanceof Error ? err.message.split('\n')[0] : 'error')
  }
}
