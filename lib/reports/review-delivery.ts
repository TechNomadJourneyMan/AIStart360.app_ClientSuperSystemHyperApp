/**
 * lib/reports/review-delivery.ts — a new report version waiting for the
 * expert reaches the people who may decide on it.
 *
 * Trigger: REPORT_GENERATED with payload.status = 'in_review' (emitted once
 * per version by report.create_version). The event router calls
 * lib/telegram/bots/expert/notify.ts routeEventToExperts, which calls
 * deliverReportForReview here. Channels:
 *   Telegram  the PDF (sendDocument) to every expert linked in the expert bot,
 *             with «✅ Подтвердить и опубликовать» / «✏️ Нужны правки»
 *             (lib/telegram/bots/expert/review.ts); one delivery per chat
 *             (telegram_bot_deliveries, key report_review:<version id>);
 *   email     a copy with the PDF attached (Resend attachments) to experts —
 *             profile role 'expert' and staff role 'super_expert' — only when
 *             RESEND_API_KEY is configured; otherwise skipped and reported;
 *   web       expert cabinet /expert/reports and GIGA → Отчёты list the version.
 *
 * Hook for other channels (WhatsApp, W6) — do not implement them here:
 *   reportReviewRecipients(versionId)  who may decide + their contacts
 *   reportReviewPackage(versionId)     PDF bytes, file name, caption, links
 *   or subscribe with onPlatformEvent (lib/events/platform.ts) to
 *   REPORT_GENERATED where payload.status === 'in_review'.
 * A decision from any channel must go through decideReportReview
 * (lib/reports/review-flow.ts), never write the tables directly.
 */
import { prisma } from '@/lib/db'
import { getSiteUrl } from '@/lib/site-url'
import { getReportVersion } from './versions'
import { versionPdf, versionPdfFilename } from './pdf-store'
import { versionStamp } from './version-stamp'
import { canReviewReports } from './review-flow'
import { isStaffRole } from '@/lib/admin/rbac'

export interface ReportReviewRecipient {
  userId: string
  name: string | null
  email: string | null
  phone: string | null
  profileRole: string | null
  staffRole: string | null
  /** chat id in the expert bot (telegram_bot_links bot='expert'), when linked. */
  expertBotChatId: string | null
  /** An expert (profile role 'expert' / staff 'super_expert'), not an administrator. */
  isExpert: boolean
}

/**
 * Everyone who may decide on report versions now (approved, reports.review —
 * see canReviewReports), with the contacts other channels need. The version
 * id is checked to exist and to be waiting for review; otherwise [] (nothing
 * to ask anyone about).
 */
export async function reportReviewRecipients(versionId: string): Promise<ReportReviewRecipient[]> {
  const v = await prisma.$queryRaw<Array<{ status: string }>>`
    SELECT status FROM public.report_versions WHERE id = ${versionId}::uuid`
  if (v[0]?.status !== 'in_review') return []
  const rows = await prisma.$queryRaw<Array<{
    user_id: string; full_name: string | null; email: string | null; phone: string | null; role: string | null; staff_role: string | null; chat_id: string | null
  }>>`
    SELECT p.id::text AS user_id, p.full_name, p.email, p.phone, p.role, s.role AS staff_role,
           CASE WHEN l.linked_at IS NOT NULL THEN l.chat_id END AS chat_id
    FROM public.profiles p
    LEFT JOIN public.staff_roles s ON s.user_id = p.id
    LEFT JOIN public.telegram_bot_links l ON l.user_id = p.id AND l.bot = 'expert'
    WHERE p.status = 'approved'
      AND (p.role IN ('expert', 'admin', 'super_admin') OR s.role IS NOT NULL)`
  return rows
    .filter((r) => canReviewReports({ profileRole: r.role, staffRole: isStaffRole(r.staff_role) ? r.staff_role : null }))
    .map((r) => ({
      userId: r.user_id,
      name: r.full_name,
      email: r.email,
      phone: r.phone,
      profileRole: r.role,
      staffRole: r.staff_role,
      expertBotChatId: r.chat_id,
      isExpert: r.role === 'expert' || r.staff_role === 'super_expert',
    }))
}

export interface ReportReviewPackage {
  versionId: string
  companyId: string
  companyName: string | null
  version: number
  title: string
  /** «Версия 3 · 06.10.2026» (Asia/Almaty). */
  stamp: string
  pdf: Buffer
  filename: string
  /** Plain-text lines for a message / template. */
  lines: string[]
  /** Where an expert decides on the web (needs login + 2FA). */
  expertUrl: string
  gigaUrl: string
}

/** Everything a channel needs to ask for a decision; null unless the version is in_review. */
export async function reportReviewPackage(versionId: string): Promise<ReportReviewPackage | null> {
  const v = await getReportVersion(versionId)
  if (!v || v.status !== 'in_review') return null
  const pdf = await versionPdf(v, { stage: 'review' })
  const stamp = versionStamp(v.version, v.created_at)
  const hidden = (v.hidden_hypotheses ?? 0) + (v.unreviewed_model_recommendations ?? 0)
  return {
    versionId: v.id,
    companyId: v.company_id,
    companyName: v.company_name,
    version: v.version,
    title: v.title,
    stamp,
    pdf: pdf.bytes,
    filename: versionPdfFilename(v, 'review'),
    lines: [
      v.company_name ? `Клиент: ${v.company_name}` : `Компания: ${v.company_id}`,
      `${v.title} — ${stamp}`,
      `Выводов: ${v.findings}, рекомендаций: ${v.recommendations}`,
      hidden ? `Гипотез ИИ не вошло (ждут проверки в GIGA): ${hidden}` : null,
      'Клиент увидит отчёт только после подтверждения.',
    ].filter((l): l is string => Boolean(l)),
    expertUrl: getSiteUrl(`/expert/reports?review=${v.id}`),
    gigaUrl: getSiteUrl(`/admin-giga-panel/reports?focus=${v.id}`),
  }
}

export interface ReviewDeliveryReport {
  versionId: string
  telegram: Array<{ chatId: string; status: 'sent' | 'failed' | 'skipped'; reason?: string }>
  email: Array<{ to: string; status: 'sent' | 'failed' | 'skipped'; reason?: string }>
  /** WhatsApp outbox rows queued (template report_review), per expert. */
  whatsapp: Array<{ userId: string; outboxId: string; created: boolean }>
  /** Why a whole channel did not run. */
  skipped: { telegram?: string; email?: string; whatsapp?: string }
}

function maskEmail(e: string): string {
  const [user, domain] = e.split('@')
  return `${user.slice(0, 2)}***@${domain ?? ''}`
}

async function emailCopies(pkg: ReportReviewPackage, recipients: ReportReviewRecipient[]): Promise<ReviewDeliveryReport['email']> {
  const { sendTransactionalEmail } = await import('@/lib/email/send')
  const out: ReviewDeliveryReport['email'] = []
  for (const r of recipients) {
    if (!r.isExpert || !r.email) continue
    const res = await sendTransactionalEmail({
      kind: 'report_review',
      to: r.email,
      subject: `Отчёт на проверке: ${pkg.companyName ?? 'клиент'} · ${pkg.stamp}`,
      userId: r.userId,
      dedupeKey: `report_review:${pkg.versionId}:${r.userId}`,
      metadata: { report_version_id: pkg.versionId, version: pkg.version },
      content: {
        preheader: `${pkg.stamp} — подтвердите или попросите правки`,
        eyebrow: 'Отчёт на проверке',
        title: `${pkg.title}`,
        greeting: r.name ? `${r.name}, здравствуйте!` : 'Здравствуйте!',
        paragraphs: [
          'ИИ-диагностика собрала новую версию отчёта. PDF во вложении (с пометкой «На проверке эксперта»).',
          'Подтвердите — отчёт сразу опубликуется клиенту. Или попросите правки с комментарием — агент пересоберёт отчёт.',
        ],
        facts: [
          { label: 'Клиент', value: pkg.companyName },
          { label: 'Версия', value: pkg.stamp },
          { label: 'Содержание', value: pkg.lines[2] ?? null },
        ],
        cta: { label: 'Открыть в кабинете эксперта', url: pkg.expertUrl },
        note: 'Решение принимается в кабинете эксперта (вход и 2FA) или в боте экспертов в Telegram.',
      },
      attachments: [{ filename: pkg.filename, content: pkg.pdf, contentType: 'application/pdf' }],
    })
    out.push({ to: maskEmail(r.email), status: res.ok ? (res.skipped ? 'skipped' : 'sent') : 'failed', ...(res.error ? { reason: res.error } : res.skipped ? { reason: 'duplicate' } : {}) })
  }
  return out
}

/**
 * Send the review request for one version on every configured channel.
 * Idempotent per recipient (Telegram deliveries and email dedupe keys).
 */
export async function deliverReportForReview(versionId: string, opts: { fetchImpl?: typeof fetch } = {}): Promise<ReviewDeliveryReport | null> {
  const pkg = await reportReviewPackage(versionId)
  if (!pkg) return null
  const recipients = await reportReviewRecipients(versionId)
  const report: ReviewDeliveryReport = { versionId, telegram: [], email: [], whatsapp: [], skipped: {} }

  const { isBotConfigured } = await import('@/lib/telegram/bots/registry')
  if (isBotConfigured('expert')) {
    const { sendReviewDocuments } = await import('@/lib/telegram/bots/expert/review')
    report.telegram = await sendReviewDocuments(pkg, recipients, opts.fetchImpl)
  } else {
    report.skipped.telegram = 'бот экспертов не настроен (TELEGRAM_EXPERT_BOT_TOKEN / _WEBHOOK_SECRET)'
  }

  if (process.env.RESEND_API_KEY?.trim()) {
    report.email = await emailCopies(pkg, recipients)
  } else {
    report.skipped.email = 'RESEND_API_KEY не задан — письма экспертам не отправлены'
  }

  // WhatsApp (Cloud API template report_review): only experts with a verified,
  // opted-in number; a link to the cabinet, never the PDF. A failure here must
  // not undo the other channels.
  try {
    const { cloudApiConfigured } = await import('@/lib/whatsapp/config')
    if (cloudApiConfigured(process.env)) {
      const { enqueueReportReviewWhatsApp } = await import('@/lib/whatsapp/report-review')
      report.whatsapp = await enqueueReportReviewWhatsApp(
        versionId,
        recipients.filter((r) => r.isExpert).map((r) => r.userId),
        { reviewPath: `expert/reports?review=${versionId}` },
      )
    } else {
      report.skipped.whatsapp = 'WhatsApp Cloud API не настроен (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID)'
    }
  } catch (err) {
    console.error('[reports/review] whatsapp:', err instanceof Error ? err.message.split('\n')[0] : 'error')
    report.skipped.whatsapp = 'ошибка постановки в очередь WhatsApp'
  }
  return report
}
