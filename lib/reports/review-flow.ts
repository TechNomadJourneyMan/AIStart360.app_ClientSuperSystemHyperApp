/**
 * lib/reports/review-flow.ts — the expert decision on a report version waiting
 * for review (status 'in_review', migration 103).
 *
 * Owner decision: «PDF-версия отчёта (с номером версии и датой) отправляется
 * эксперту после диагностики ИИ для подтверждения; кнопка «Подтвердить» сразу
 * публикует отчёт клиенту».
 *
 *   approve            → report_version_reviews row + the version is published
 *                        in the same transaction (the previous published one
 *                        becomes superseded); afterwards: the final PDF is
 *                        rendered once and stored, the client is notified
 *                        (app_notifications, link to exactly this version),
 *                        experts get «отчёт опубликован».
 *   changes_requested  → review row with the comment + the version is retired
 *                        (superseded, provenance.review = changes_requested);
 *                        the report agent is asked to rebuild through the agent
 *                        queue (its permissions and budgets apply). At most
 *                        `review_reruns_max` rebuilds per diagnostic session
 *                        (agent_configs.settings of 'report', default 3); past
 *                        the cap nothing is queued and staff are told.
 *
 * Every decision, from any channel (web cabinet, GIGA, Telegram), goes through
 * decideReportReview, which re-checks on the server:
 *   • the person: approved profile, and either a profile role in EXPERT_ROLES
 *     (expert / admin / super_admin) or a staff role holding reports.review;
 *   • the second factor: web callers pass `mfaVerified` after their gate
 *     (resolveExpert / requireGiga run staffMfaGate); Telegram has no step-up
 *     cookie, so there the platform rule is applied — when staff 2FA is
 *     required (system setting staff_require_mfa) the person must have a
 *     second factor enrolled. The Telegram binding itself was created from the
 *     cabinet behind the 2FA gate;
 *   • the version: still 'in_review'. Exactly one decision per version (unique
 *     index): repeating the same decision is a no-op that reports `already`;
 *     the opposite decision after one was taken is refused.
 * The audit entry is written before anything changes; without it nothing does.
 */
import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'
import { hasPermission, isStaffRole, type StaffRole } from '@/lib/admin/rbac'
import type { AuditWriter } from '@/lib/admin/staff-actions'
import { EXPERT_ROLES } from '@/lib/expert-auth'
import { mfaFlagsEnrolled } from '@/lib/mfa/flags'
import { coerceSetting } from '@/lib/settings/registry'
import { lockCompanyType, publishInTx } from './versions'
import type { ReportType } from './types'
import { versionStamp } from './version-stamp'

type Tx = Prisma.TransactionClient

export const REVIEW_DECISIONS = ['approve', 'changes_requested'] as const
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number]
export type ReviewChannel = 'web' | 'telegram'

export const REVIEW_COMMENT_MIN = 3
export const REVIEW_COMMENT_MAX = 2000
/** Rebuilds per diagnostic session requested by «Нужны правки» (agent_configs.settings.review_reruns_max). */
export const DEFAULT_REVIEW_RERUNS_MAX = 3
export const REVIEW_RERUNS_HARD_MAX = 10

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ─── Who may decide ──────────────────────────────────────────────────────────

export interface Reviewer {
  userId: string
  profileRole: string | null
  staffRole: StaffRole | null
  email: string | null
  name: string | null
}

/** reports.review: profile role in EXPERT_ROLES, or a staff role that holds the permission. */
export function canReviewReports(p: { profileRole: string | null; staffRole: StaffRole | string | null }): boolean {
  if (p.profileRole && EXPERT_ROLES.has(p.profileRole)) return true
  return isStaffRole(p.staffRole) && hasPermission(p.staffRole, 'reports.review')
}

/** The reviewer as stored now: approved profile only (pending / blocked / archived → null). */
export async function loadReviewer(userId: string): Promise<Reviewer | null> {
  if (!UUID.test(userId)) return null
  const rows = await prisma.$queryRaw<Array<{ id: string; role: string | null; status: string | null; email: string | null; full_name: string | null; staff_role: string | null }>>`
    SELECT p.id::text, p.role, p.status, p.email, p.full_name, s.role AS staff_role
    FROM public.profiles p LEFT JOIN public.staff_roles s ON s.user_id = p.id
    WHERE p.id = ${userId}::uuid`
  const r = rows[0]
  if (!r || r.status !== 'approved') return null
  const staffRole = r.role === 'super_admin' ? 'super_admin' : isStaffRole(r.staff_role) ? r.staff_role : null
  return { userId: r.id, profileRole: r.role, staffRole, email: r.email, name: r.full_name }
}

/**
 * Second-factor rule for channels without a step-up proof (Telegram): when the
 * platform requires staff 2FA, the person must have a second factor enrolled.
 * Fails closed: an unreadable setting counts as «required».
 */
export async function reviewerMfaSatisfied(userId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ totp: boolean | null; keys: boolean; meta: Record<string, unknown> | null }>>`
    SELECT (SELECT totp_enabled FROM public.user_security WHERE user_id = ${userId}::uuid) AS totp,
           EXISTS (SELECT 1 FROM public.webauthn_credentials WHERE user_id = ${userId}::uuid) AS keys,
           (SELECT raw_app_meta_data FROM auth.users WHERE id = ${userId}::uuid) AS meta`
  const r = rows[0]
  if (r && (r.totp === true || r.keys || mfaFlagsEnrolled({ app_metadata: r.meta ?? undefined }))) return true
  let required = true
  try {
    const s = await prisma.$queryRaw<Array<{ value: unknown }>>`SELECT value FROM public.system_settings WHERE key = 'staff_require_mfa'`
    required = coerceSetting('staff_require_mfa', s[0]?.value)
  } catch {
    required = true
  }
  return !required
}

// ─── Read model ──────────────────────────────────────────────────────────────

export interface ReviewVersionHead {
  id: string
  company_id: string
  company_name: string | null
  session_id: string | null
  report_type: ReportType
  version: number
  status: string
  title: string
  data_hash: string
  created_at: string
  published_at: string | null
}

export interface ReviewRow {
  id: string
  report_version_id: string
  reviewer_id: string | null
  reviewer_role: string | null
  decision: ReviewDecision
  comment: string | null
  channel: ReviewChannel
  created_at: string
}

const iso = (v: Date | string | null | undefined): string | null => (v ? new Date(v).toISOString() : null)

export async function reviewVersionHead(versionId: string): Promise<ReviewVersionHead | null> {
  if (!UUID.test(versionId)) return null
  const rows = await prisma.$queryRaw<Array<Omit<ReviewVersionHead, 'created_at' | 'published_at'> & { created_at: Date; published_at: Date | null }>>`
    SELECT v.id::text, v.company_id, c.name AS company_name, v.session_id::text, v.report_type, v.version, v.status, v.title,
           v.data_hash, v.created_at, v.published_at
    FROM public.report_versions v LEFT JOIN public.companies c ON c.id = v.company_id
    WHERE v.id = ${versionId}::uuid`
  const r = rows[0]
  return r ? { ...r, version: Number(r.version), created_at: iso(r.created_at)!, published_at: iso(r.published_at) } : null
}

export async function reviewOf(versionId: string): Promise<ReviewRow | null> {
  const rows = await prisma.$queryRaw<Array<Omit<ReviewRow, 'created_at'> & { created_at: Date }>>`
    SELECT id::text, report_version_id::text, reviewer_id::text, reviewer_role, decision, comment, channel, created_at
    FROM public.report_version_reviews WHERE report_version_id = ${versionId}::uuid`
  const r = rows[0]
  return r ? { ...r, created_at: iso(r.created_at)! } : null
}

/** Versions waiting for the expert, newest first (staff read model for GIGA / expert cabinet / bot). */
export async function listInReviewVersions(limit = 50): Promise<ReviewVersionHead[]> {
  const rows = await prisma.$queryRaw<Array<Omit<ReviewVersionHead, 'created_at' | 'published_at'> & { created_at: Date; published_at: Date | null }>>`
    SELECT v.id::text, v.company_id, c.name AS company_name, v.session_id::text, v.report_type, v.version, v.status, v.title,
           v.data_hash, v.created_at, v.published_at
    FROM public.report_versions v LEFT JOIN public.companies c ON c.id = v.company_id
    WHERE v.status = 'in_review'
    ORDER BY v.created_at DESC
    LIMIT ${Math.min(Math.max(limit, 1), 200)}`
  return rows.map((r) => ({ ...r, version: Number(r.version), created_at: iso(r.created_at)!, published_at: iso(r.published_at) }))
}

/** Latest decisions of a company (GIGA history). */
export async function listReviews(filter: { companyId?: string | null; versionId?: string | null; limit?: number } = {}): Promise<ReviewRow[]> {
  const rows = await prisma.$queryRaw<Array<Omit<ReviewRow, 'created_at'> & { created_at: Date }>>`
    SELECT id::text, report_version_id::text, reviewer_id::text, reviewer_role, decision, comment, channel, created_at
    FROM public.report_version_reviews
    WHERE (${filter.companyId ?? null}::text IS NULL OR company_id = ${filter.companyId ?? null})
      AND (${filter.versionId ?? null}::uuid IS NULL OR report_version_id = ${filter.versionId ?? null}::uuid)
    ORDER BY created_at DESC
    LIMIT ${Math.min(Math.max(filter.limit ?? 50, 1), 200)}`
  return rows.map((r) => ({ ...r, created_at: iso(r.created_at)! }))
}

// ─── Decision ────────────────────────────────────────────────────────────────

export interface DecideInput {
  versionId: string
  reviewerId: string
  decision: ReviewDecision
  comment?: string | null
  channel: ReviewChannel
  /** The caller's gate already verified the second factor (web). */
  mfaVerified: boolean
  audit: AuditWriter
}

export type RerunOutcome =
  | { state: 'queued'; taskId: string; attempt: number; max: number }
  | { state: 'cap_reached'; attempt: number; max: number }
  | { state: 'agent_disabled' | 'failed'; attempt: number; max: number }

export type DecideOutcome =
  | {
      ok: true
      decision: ReviewDecision
      /** The same decision had already been taken: nothing changed. */
      already: boolean
      reviewId: string
      version: ReviewVersionHead
      superseded: string[]
      rerun: RerunOutcome | null
    }
  | { ok: false; code: 'forbidden' | 'mfa_required' | 'not_found' | 'comment_required' | 'audit_unavailable' }
  | { ok: false; code: 'wrong_status'; status: string | null; decided: ReviewDecision | null }

export const DECIDE_ERRORS: Record<Exclude<DecideOutcome, { ok: true }>['code'], string> = {
  forbidden: 'Нет права подтверждать отчёты',
  mfa_required: 'Для решения по отчёту включите двухфакторную аутентификацию в кабинете',
  not_found: 'Версия отчёта не найдена',
  comment_required: `Опишите, что поправить (от ${REVIEW_COMMENT_MIN} символов)`,
  audit_unavailable: 'Журнал аудита недоступен — решение не сохранено',
  wrong_status: 'Версия уже не ждёт проверки',
}

type TxOutcome =
  | { kind: 'done'; reviewId: string; superseded: string[] }
  | { kind: 'already'; review: ReviewRow }
  | { kind: 'wrong_status'; status: string | null; decided: ReviewDecision | null }

async function decideInTx(tx: Tx, head: ReviewVersionHead, reviewer: Reviewer, input: DecideInput, comment: string | null): Promise<TxOutcome> {
  // Same lock order as createReadyVersion / publishInTx: advisory lock, then the row.
  await lockCompanyType(tx, head.company_id, head.report_type)
  const [row] = await tx.$queryRaw<Array<{ status: string }>>`
    SELECT status FROM public.report_versions WHERE id = ${head.id}::uuid FOR UPDATE`
  const existing = await tx.$queryRaw<Array<Omit<ReviewRow, 'created_at'> & { created_at: Date }>>`
    SELECT id::text, report_version_id::text, reviewer_id::text, reviewer_role, decision, comment, channel, created_at
    FROM public.report_version_reviews WHERE report_version_id = ${head.id}::uuid`
  if (existing[0]) {
    const r = { ...existing[0], created_at: iso(existing[0].created_at)! }
    return r.decision === input.decision ? { kind: 'already', review: r } : { kind: 'wrong_status', status: row?.status ?? null, decided: r.decision }
  }
  if (row?.status !== 'in_review') return { kind: 'wrong_status', status: row?.status ?? null, decided: null }

  const [review] = await tx.$queryRaw<Array<{ id: string }>>`
    INSERT INTO public.report_version_reviews
      (report_version_id, company_id, session_id, reviewer_id, reviewer_role, decision, comment, channel)
    VALUES (${head.id}::uuid, ${head.company_id}, ${head.session_id}::uuid, ${reviewer.userId}::uuid,
            ${reviewer.staffRole ?? reviewer.profileRole}, ${input.decision}, ${comment}, ${input.channel})
    RETURNING id::text`

  if (input.decision === 'approve') {
    const pub = await publishInTx(tx, head.id, reviewer.userId, ['in_review'])
    if (!pub.ok) throw new Error(`publish failed: ${pub.reason}`)
    return { kind: 'done', reviewId: review.id, superseded: pub.superseded }
  }
  const note = JSON.stringify({ action: 'changes_requested', by: reviewer.userId, at: new Date().toISOString(), reason: (comment ?? '').slice(0, 500), review_id: review.id })
  await tx.$executeRaw`
    UPDATE public.report_versions
    SET status = 'superseded', provenance = provenance || jsonb_build_object('review', ${note}::jsonb)
    WHERE id = ${head.id}::uuid AND status = 'in_review'`
  return { kind: 'done', reviewId: review.id, superseded: [head.id] }
}

export async function decideReportReview(input: DecideInput): Promise<DecideOutcome> {
  if (!UUID.test(input.versionId)) return { ok: false, code: 'not_found' }
  const comment = input.comment?.trim().slice(0, REVIEW_COMMENT_MAX) || null
  if (input.decision === 'changes_requested' && (comment?.length ?? 0) < REVIEW_COMMENT_MIN) return { ok: false, code: 'comment_required' }

  const reviewer = await loadReviewer(input.reviewerId)
  if (!reviewer || !canReviewReports(reviewer)) return { ok: false, code: 'forbidden' }
  if (!input.mfaVerified && !(await reviewerMfaSatisfied(reviewer.userId))) return { ok: false, code: 'mfa_required' }

  const head = await reviewVersionHead(input.versionId)
  if (!head) return { ok: false, code: 'not_found' }

  // Idempotency before the audit entry: a repeated press changes nothing and writes nothing.
  const prior = await reviewOf(head.id)
  if (prior) {
    if (prior.decision !== input.decision) return { ok: false, code: 'wrong_status', status: head.status, decided: prior.decision }
    return { ok: true, decision: input.decision, already: true, reviewId: prior.id, version: head, superseded: [], rerun: null }
  }
  if (head.status !== 'in_review') return { ok: false, code: 'wrong_status', status: head.status, decided: null }

  try {
    await input.audit({
      action: `report.review.${input.decision}`,
      entityType: 'report_version',
      entityId: head.id,
      oldValue: { status: head.status },
      newValue: { status: input.decision === 'approve' ? 'published' : 'superseded', comment },
      metadata: { company_id: head.company_id, report_type: head.report_type, version: head.version, data_hash: head.data_hash, channel: input.channel },
    }, { required: true })
  } catch {
    return { ok: false, code: 'audit_unavailable' }
  }

  const tx = await prisma.$transaction((t) => decideInTx(t, head, reviewer, input, comment))
  if (tx.kind === 'already') {
    return { ok: true, decision: input.decision, already: true, reviewId: tx.review.id, version: head, superseded: [], rerun: null }
  }
  if (tx.kind === 'wrong_status') return { ok: false, code: 'wrong_status', status: tx.status, decided: tx.decided }

  const after = (await reviewVersionHead(head.id)) ?? head
  let rerun: RerunOutcome | null = null
  if (input.decision === 'approve') {
    await afterPublish(after, reviewer)
  } else {
    rerun = await requestRebuild(after, tx.reviewId, reviewer, comment ?? '')
  }
  return { ok: true, decision: input.decision, already: false, reviewId: tx.reviewId, version: after, superseded: tx.superseded, rerun }
}

// ─── After an approval ───────────────────────────────────────────────────────

/** Client user ids of a company: active members plus the primary owner. */
export async function companyClientUserIds(companyId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ user_id: string }>>`
    SELECT m.user_id::text FROM public.company_members m WHERE m.company_id = ${companyId} AND m.status = 'active'
    UNION
    SELECT c.user_id::text FROM public.companies c WHERE c.id = ${companyId} AND c.user_id IS NOT NULL`
  return rows.map((r) => r.user_id)
}

async function afterPublish(v: ReviewVersionHead, reviewer: Reviewer): Promise<void> {
  const stamp = versionStamp(v.version, v.created_at)
  // 1) The final PDF (no watermark), rendered once and stored.
  try {
    const { getReportVersion } = await import('./versions')
    const { versionPdf } = await import('./pdf-store')
    const full = await getReportVersion(v.id)
    if (full) await versionPdf(full, { stage: 'final' })
  } catch (err) {
    console.error('[reports/review] final PDF not stored:', err instanceof Error ? err.message.split('\n')[0] : 'error')
  }
  // 2) The client: in-app notification with a link to exactly this version.
  try {
    const { createNotification } = await import('@/lib/notifications/create')
    let link = '/point-a#reports'
    try {
      const { linkSecretConfigured, signVersionLink } = await import('./version-link')
      if (linkSecretConfigured()) link = `/r/v/${(await signVersionLink(v.id, v.version)).token}`
    } catch {
      /* the cabinet link still works */
    }
    for (const userId of await companyClientUserIds(v.company_id)) {
      await createNotification({
        userId,
        title: 'Отчёт по Точке А опубликован',
        body: `${stamp}. Специалист AIStart360 проверил отчёт — его можно открыть и скачать в PDF.`,
        category: 'report',
        priority: 'high',
        link,
        metadata: { report_version_id: v.id, version: v.version, report_type: v.report_type },
      })
    }
  } catch (err) {
    console.error('[reports/review] client notification failed:', err instanceof Error ? err.message.split('\n')[0] : 'error')
  }
  // 3) Experts linked in the expert bot.
  try {
    const { notifyExpertsSafely } = await import('@/lib/telegram/bots/expert/notify')
    await notifyExpertsSafely({
      kind: 'report.published',
      dedupeKey: `report.published:${v.id}`,
      companyId: v.company_id,
      lines: [v.title, stamp, `Подтвердил: ${reviewer.name ?? reviewer.email ?? 'эксперт'}`],
      reportId: v.id,
    })
  } catch {
    /* best effort */
  }
}

// ─── After «Нужны правки» ────────────────────────────────────────────────────

export async function reviewRerunsMax(): Promise<number> {
  try {
    const { loadConfig } = await import('@/lib/agents/store')
    const raw = (await loadConfig('report'))?.settings?.review_reruns_max
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
    if (Number.isInteger(n) && n >= 0) return Math.min(n, REVIEW_RERUNS_HARD_MAX)
  } catch {
    /* default */
  }
  return DEFAULT_REVIEW_RERUNS_MAX
}

/** «Нужны правки» decisions so far for the session of the version (this one included). */
async function changesRequestedCount(v: ReviewVersionHead): Promise<number> {
  const rows = v.session_id
    ? await prisma.$queryRaw<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM public.report_version_reviews
        WHERE session_id = ${v.session_id}::uuid AND decision = 'changes_requested'`
    : await prisma.$queryRaw<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM public.report_version_reviews r
        JOIN public.report_versions rv ON rv.id = r.report_version_id
        WHERE r.session_id IS NULL AND r.decision = 'changes_requested'
          AND rv.company_id = ${v.company_id} AND rv.report_type = ${v.report_type}`
  return Number(rows[0]?.n ?? 0)
}

async function tellStaff(v: ReviewVersionHead, type: string, title: string, lines: string[]): Promise<void> {
  try {
    const { notifyStaff } = await import('@/lib/notifications/staff')
    await notifyStaff({
      level: 'WARNING',
      type,
      title,
      lines: [v.company_name ? `Клиент: ${v.company_name}` : null, ...lines].filter((l): l is string => Boolean(l)),
      companyId: v.company_id,
      entityType: 'report_version',
      entityId: v.id,
      dedupeKey: `${type}:${v.id}`,
      link: `/admin-giga-panel/reports?focus=${v.id}`,
    })
  } catch (err) {
    console.error('[reports/review] staff notification failed:', err instanceof Error ? err.message.split('\n')[0] : 'error')
  }
}

async function requestRebuild(v: ReviewVersionHead, reviewId: string, reviewer: Reviewer, comment: string): Promise<RerunOutcome> {
  const max = await reviewRerunsMax()
  const attempt = await changesRequestedCount(v)
  const who = reviewer.name ?? reviewer.email ?? 'эксперт'
  if (attempt > max) {
    await tellStaff(v, 'report.review_rerun_cap', 'Отчёт: лимит пересборок по правкам эксперта исчерпан', [
      `Версия ${v.version}: эксперт (${who}) снова запросил правки — «${comment.slice(0, 200)}»`,
      `Пересборок по этой диагностике: ${max} из ${max}. Агент больше не запускается автоматически — нужны правки данных и ручной запуск в GIGA.`,
    ])
    return { state: 'cap_reached', attempt, max }
  }
  try {
    const { enqueueAgentTask } = await import('@/lib/agents/queue')
    const { id } = await enqueueAgentTask({
      agentKey: 'report',
      companyId: v.company_id,
      sessionId: v.session_id,
      trigger: 'manual',
      triggerRef: 'report_review:changes_requested',
      requestedBy: `expert:${reviewer.userId}`,
      input: {
        ...(v.session_id ? { session_id: v.session_id } : {}),
        review: { id: reviewId, version_id: v.id, version: v.version, comment: comment.slice(0, 500) },
      },
      idempotencyKey: `report_review:${reviewId}`,
    })
    return { state: 'queued', taskId: id, attempt, max }
  } catch (err) {
    const disabled = err instanceof Error && err.name === 'AgentDisabledError'
    await tellStaff(v, 'report.review_rerun_failed', 'Отчёт: пересборка по правкам эксперта не запущена', [
      `Версия ${v.version}: «${comment.slice(0, 200)}» (${who})`,
      disabled ? 'Агент «Отчёт» выключен в настройках.' : 'Не удалось поставить задачу агенту — запустите вручную в GIGA.',
    ])
    return { state: disabled ? 'agent_disabled' : 'failed', attempt, max }
  }
}
