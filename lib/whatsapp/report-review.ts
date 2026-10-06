/**
 * lib/whatsapp/report-review.ts — «отчёт на проверку» in WhatsApp (template report_review).
 *
 * For the report review flow (plan W5): when a report version goes to an
 * expert for review, call
 *
 *   await enqueueReportReviewWhatsApp(versionId, recipients)
 *
 * with the expert user ids that should review it (or omit `recipients` for
 * every opted-in expert). The function reads the version (title, version
 * number, date, client) itself, enqueues one template message per expert
 * with a verified, opted-in number (kind 'expert'), sends them right away and
 * leaves retries to the outbox drain. Idempotent per (version, expert):
 * calling it again does not send a second message. Never throws for missing
 * configuration: without Cloud API it returns an empty list.
 *
 * The message links to the expert cabinet («Проверить отчёт» → /expert/reports,
 * or `reviewPath` when given — e.g. a signed /r/v/<token> link).
 */
import { prisma } from '@/lib/db'
import { EXPERT_ROLES } from '@/lib/expert-auth'
import { cloudApiConfigured, type WhatsAppEnv } from './config'
import { optedInRecipients } from './links'
import { enqueueWhatsApp, outboxKey, sendWhatsAppNow, type DrainOptions } from './outbox'
import { reportReviewTemplate } from './templates'

export interface ReportReviewWhatsAppResult { userId: string; outboxId: string; created: boolean }

export async function enqueueReportReviewWhatsApp(
  versionId: string,
  recipients?: string[] | null,
  opts: { reviewPath?: string | null; env?: WhatsAppEnv; drain?: Omit<DrainOptions, 'ids'>; now?: Date } = {},
): Promise<ReportReviewWhatsAppResult[]> {
  const env = opts.env ?? process.env
  if (!cloudApiConfigured(opts.drain?.meta?.env ?? env)) return []
  const rows = await prisma.$queryRaw<Array<{ title: string | null; version: number | null; created_at: Date; company_name: string | null }>>`
    SELECT v.title, v.version, v.created_at, c.name AS company_name
    FROM public.report_versions v LEFT JOIN public.companies c ON c.id = v.company_id
    WHERE v.id = ${versionId}::uuid`
  const v = rows[0]
  if (!v) return []

  const people = (await optedInRecipients('expert', { userIds: recipients ?? undefined }))
    .filter((r) => r.role !== null && EXPERT_ROLES.has(r.role))
  if (people.length === 0) return []

  const date = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Almaty' }).format(v.created_at)
  const payload = reportReviewTemplate({
    title: v.title ?? 'Отчёт',
    version: v.version ?? 1,
    date,
    client: v.company_name ?? 'не указан',
    path: opts.reviewPath ?? 'expert/reports',
  })
  const out: ReportReviewWhatsAppResult[] = []
  for (const p of people) {
    const row = await enqueueWhatsApp({
      idempotencyKey: outboxKey('report_review', versionId, p.userId),
      kind: 'expert',
      userId: p.userId,
      phoneE164: p.phone,
      payload,
      level: 'SUCCESS',
      env,
    })
    out.push({ userId: p.userId, outboxId: row.id, created: row.created })
  }
  await sendWhatsAppNow(out.filter((r) => r.created).map((r) => r.outboxId), { ...opts.drain, env, now: opts.now })
  return out
}
