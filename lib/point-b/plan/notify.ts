/**
 * lib/point-b/plan/notify.ts — events, notifications and messages of the plan workflow.
 *
 *   notifyPlanSubmitted   staff (clients.review: experts and admins): a plan waits for approval
 *   notifyPlanApproved    the client: notification + a message from the approver in «Сообщения»
 *                         (the first publication is «важное» — a modal pop-up in the cabinet)
 *   notifyGoalCorrection  the client: the expert proposes another goal value (important message
 *                         + notification); with from = null the expert simply set the goal
 *   notifyGoalNeedsReview staff: the owner set / changed a goal (the assigned expert, otherwise
 *                         everyone with clients.review)
 *   notifyGoalResponded   staff: the owner accepted / disputed a correction
 *
 * Every function is idempotent by its key (version / review id), never throws (a failure is
 * logged: the business action has already happened) and sends texts built from templates —
 * the expert's free text (reason) was checked for profanity when it was entered.
 * The message and the notification do not duplicate each other in the bell: when the message
 * reached the cabinet, the notification skips the in-app channel (email / Telegram follow the
 * client's preferences).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendToUser } from '@/lib/comm/send'
import { trackEventOnce } from '@/lib/events/track'
import { notifyStaff } from '@/lib/notifications/staff'
import { claimSend, releaseSend } from '@/lib/notifications/store'
import { notifyPointBGoalCorrection, notifyPointBPlanApproved } from '@/lib/notifications/product'

export const POINT_B_STAFF_PERMISSION = 'clients.review' as const

/** User 360 → «Точка Б» of a client. */
export const pointBStaffLink = (userId: string): string => `/admin-giga-panel/users/${userId}?tab=point-b`

const fmt = (n: number): string => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(n)
const valueText = (n: number | null): string => (n === null || !Number.isFinite(n) ? 'не задана' : fmt(n))

function fail(what: string, err: unknown): void {
  console.error(`[point-b/notify] ${what} failed:`, err instanceof Error ? err.message : err)
}

async function safely(what: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    fail(what, err)
  }
}

/** One send per key: true when this call may send (claimed or the journal is down — better twice than never). */
async function claimOnce(userId: string, kind: string, dedupeKey: string): Promise<{ send: boolean; release: () => Promise<void> }> {
  const claim = await claimSend({ userId, kind, dedupeKey, countsTowardCap: false, channels: ['app'] })
  return {
    send: claim.result !== 'duplicate',
    release: async () => { if (claim.id) await releaseSend(claim.id) },
  }
}

interface MessageInput {
  sb: SupabaseClient
  userId: string
  key: string
  kind: string
  body: string
  title: string
  important: boolean
  author: { id: string; name: string }
}

/** The staff-authored message in the cabinet. true = it reached the cabinet (or was sent before). */
async function sendStaffMessage(m: MessageInput): Promise<boolean> {
  const once = await claimOnce(m.userId, m.kind, m.key)
  if (!once.send) return true
  try {
    const res = await sendToUser({
      userId: m.userId, channels: ['app'], body: m.body, authorKind: 'staff', authorId: m.author.id, authorName: m.author.name,
      appTitle: m.title, flags: { important: m.important },
    }, { sb: m.sb })
    if (!res.ok) await once.release()
    return res.ok
  } catch (err) {
    await once.release()
    fail(`message ${m.kind}`, err)
    return false
  }
}

/** One product event per (client, event, entity) — a repeated call does not add a second one. */
async function track(
  name: Parameters<typeof trackEventOnce>[0]['name'], userId: string, entityType: string, entityId: string,
  metadata: Record<string, unknown>, source: 'admin' | 'server' = 'admin',
): Promise<void> {
  await trackEventOnce({ userId, name, entityType, entityId, metadata, source })
}

export async function notifyPlanSubmitted(
  _sb: SupabaseClient,
  input: { companyId: string; userId: string; versionId: string; authorName: string; submittedAt?: string | null },
): Promise<void> {  await safely('plan submitted', async () => {
    await notifyStaff({
      level: 'WARNING',
      type: 'point_b.plan.submitted',
      title: 'План «Точки Б» ждёт одобрения',
      lines: [`Автор: ${input.authorName}`, 'Проверьте цели и комментарий, затем одобрите план или верните его с комментарием.'],
      companyId: input.companyId,
      entityType: 'pb_plan_version',
      entityId: input.versionId,
      link: pointBStaffLink(input.userId),
      // A version returned and sent again is a new request (the submit time differs).
      dedupeKey: `point_b.plan.submitted:${input.versionId}:${input.submittedAt ?? ''}`,
      audiencePermission: POINT_B_STAFF_PERMISSION,
      skipCooldown: true,
    })
  })
  await safely('plan submitted event', () => track('POINT_B_PLAN_SUBMITTED', input.userId, 'pb_plan_version', input.versionId, { author: input.authorName }))
}

export async function notifyPlanApproved(
  sb: SupabaseClient,
  input: { userId: string; versionId: string; first: boolean; actor: { id: string; name: string } },
): Promise<void> {
  await safely('plan approved', async () => {
    const who = input.actor.name?.trim() || 'Эксперт'
    const delivered = await sendStaffMessage({
      sb,
      userId: input.userId,
      key: `point_b_plan_approved:${input.versionId}:msg`,
      kind: 'point_b_plan_msg',
      title: input.first ? 'План «Точки Б» опубликован' : 'План «Точки Б» обновлён',
      body: input.first
        ? 'Здравствуйте! Ваш план «Точки Б» опубликован: цели, комментарий эксперта и следующие шаги — в разделе «Точка Б» кабинета. Если что-то непонятно или не сходится с вашей картиной бизнеса — ответьте на это сообщение.'
        : 'План «Точки Б» обновлён: новая версия уже в разделе «Точка Б» кабинета. Что изменилось и почему — в комментарии эксперта. Вопросы — ответом на это сообщение.',
      important: input.first,
      author: { id: input.actor.id, name: who },
    })
    await notifyPointBPlanApproved(input.userId, { versionId: input.versionId, first: input.first, inApp: !delivered })
  })
  await safely('plan approved event', () => track('POINT_B_PLAN_APPROVED', input.userId, 'pb_plan_version', input.versionId, { first: input.first }))
}

export async function notifyGoalCorrection(
  sb: SupabaseClient,
  input: { userId: string; reviewId: string; metricLabel: string; from: number | null; to: number | null; reason: string; reviewer: { id: string; name: string } },
): Promise<void> {
  await safely('goal correction', async () => {
    const who = input.reviewer.name?.trim() || 'Эксперт'
    const proposal = input.from !== null // no previous goal: the expert simply set it, nothing to answer
    const body = proposal
      ? `${who} предлагает изменить цель «${input.metricLabel}»: ${valueText(input.from)} → ${valueText(input.to)}.\nПричина: ${input.reason}\n\nОткройте «Точку Б» и ответьте — согласны вы или нет. Пока вы не согласитесь, цель не изменится.`
      : `Для вас задана цель «${input.metricLabel}»: ${valueText(input.to)} (эксперт: ${who}).\nПричина: ${input.reason}\n\nЦель можно уточнить в разделе «Точка Б»; если не согласны — напишите ответом на это сообщение.`
    const delivered = await sendStaffMessage({
      sb,
      userId: input.userId,
      key: `point_b_goal_corrected:${input.reviewId}:msg`,
      kind: 'point_b_goal_msg',
      title: proposal ? 'Эксперт предлагает изменить цель' : 'Эксперт задал цель',
      body,
      important: proposal,
      author: { id: input.reviewer.id, name: who },
    })
    await notifyPointBGoalCorrection(input.userId, {
      reviewId: input.reviewId,
      metricLabel: input.metricLabel,
      fromText: valueText(input.from),
      toText: valueText(input.to),
      reason: input.reason,
      expertName: who,
      inApp: !delivered,
    })
  })
  await safely('goal correction event', () => track('POINT_B_GOAL_CORRECTED', input.userId, 'pb_goal_review', input.reviewId, { from: input.from, to: input.to }))
}

/** Who looks at the client's goals: the assigned expert, otherwise everyone with clients.review. */
async function goalAudience(sb: SupabaseClient, userId: string, explicit?: string | null): Promise<string[] | null> {
  if (explicit) return [explicit]
  const { data } = await sb.from('user_assignments').select('assignee_id').eq('user_id', userId).maybeSingle()
  const assignee = (data as { assignee_id?: string | null } | null)?.assignee_id ?? null
  return assignee ? [assignee] : null
}

export async function notifyGoalNeedsReview(
  sb: SupabaseClient,
  input: { userId: string; companyId: string; metricLabel: string },
): Promise<void> {
  await safely('goal needs review', async () => {
    const audience = await goalAudience(sb, input.userId)
    const day = new Date().toISOString().slice(0, 10)
    await notifyStaff({
      level: 'INFO',
      type: 'point_b.goal.needs_review',
      title: 'Цель клиента ждёт проверки',
      lines: [`Цель: ${input.metricLabel}`, 'Владелец поставил или изменил цель — подтвердите её или предложите исправление.'],
      companyId: input.companyId,
      entityType: 'company',
      entityId: input.companyId,
      link: pointBStaffLink(input.userId),
      dedupeKey: `point_b.goal.needs_review:${input.companyId}:${input.metricLabel}:${day}`,
      audienceUserIds: audience,
      audiencePermission: POINT_B_STAFF_PERMISSION,
      skipCooldown: true,
    })
  })
}

export async function notifyGoalResponded(
  sb: SupabaseClient,
  input: { userId: string; companyId: string; reviewId: string; metricLabel: string; accepted: boolean; reviewerId?: string | null },
): Promise<void> {
  await safely('goal responded', async () => {
    const audience = await goalAudience(sb, input.userId, input.reviewerId)
    await notifyStaff({
      level: input.accepted ? 'INFO' : 'WARNING',
      type: 'point_b.goal.responded',
      title: input.accepted ? 'Владелец согласился с корректировкой цели' : 'Владелец не согласен с корректировкой цели',
      lines: [`Цель: ${input.metricLabel}`, input.accepted ? 'Новое значение применено.' : 'Цель осталась прежней и вернулась на пересмотр.'],
      companyId: input.companyId,
      entityType: 'pb_goal_review',
      entityId: input.reviewId,
      link: pointBStaffLink(input.userId),
      dedupeKey: `point_b.goal.responded:${input.reviewId}`,
      audienceUserIds: audience,
      audiencePermission: POINT_B_STAFF_PERMISSION,
      skipCooldown: true,
    })
  })
  await safely('goal responded event', () => track('POINT_B_GOAL_RESPONDED', input.userId, 'pb_goal_review', input.reviewId, { accepted: input.accepted }, 'server'))
}
