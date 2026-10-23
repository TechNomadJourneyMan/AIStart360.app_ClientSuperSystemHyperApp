/**
 * lib/survey/express-complete.ts — «Готово» of the express flow (spec
 * 2026-10-23 §7.2, §10; PO §18.3 item 1).
 *
 * What it IS: the product event SURVEY_EXPRESS_COMPLETED (once per client) and
 * a notification to the assigned expert — «Клиент завершил быстрый старт —
 * первичная Точка А готова, проверьте» (no assignee → staff with
 * clients.review), deduplicated per client. The primary Point A itself is the
 * ordinary recalculation the browser asks for next.
 *
 * What it is NOT: «анкета заполнена». No QUESTIONNAIRE_COMPLETED, no
 * ONBOARDING_COMPLETED, no exit from the waiting room, no stop of the bot
 * reminders — those stay tied to submitting the FULL questionnaire.
 *
 * Side effects are injected (the route passes the real ones), so the rules are
 * tested without a database. Never throws: the owner already pressed «Готово».
 */
import { fromAnswerEnvelope } from './answer-value'
import { expressSummary, type ExpressSummary } from './express'

export const EXPRESS_STAFF_PERMISSION = 'clients.review' as const

/** User 360 → «Анкета». */
export const expressStaffLink = (userId: string): string => `/admin-giga-panel/users/${userId}?tab=survey`

export interface ExpressCompleteDeps {
  /** survey_answers rows of the owner. */
  readAnswers: (userId: string) => Promise<Array<{ question_key: string; answer: unknown }>>
  companyOf: (userId: string) => Promise<{ id: string; name: string | null } | null>
  /** The expert assigned to the client (user_assignments.assignee_id). */
  assigneeOf: (userId: string) => Promise<string | null>
  trackOnce: (e: { userId: string; name: 'SURVEY_EXPRESS_COMPLETED'; entityType: string; entityId: string; metadata: Record<string, unknown>; source: 'server' }) => Promise<void>
  notifyStaff: (n: {
    level: 'INFO'; type: string; title: string; lines: string[]; companyId: string | null; entityType: string; entityId: string
    link: string; dedupeKey: string; audienceUserIds: string[] | null; audiencePermission: typeof EXPRESS_STAFF_PERMISSION; skipCooldown: boolean
  }) => Promise<unknown>
}

export interface ExpressCompleteResult {
  summary: ExpressSummary
  notified: boolean
}

export async function completeExpress(deps: ExpressCompleteDeps, input: { userId: string; minutes?: number | null }): Promise<ExpressCompleteResult> {
  let summary: ExpressSummary = expressSummary({})
  try {
    const rows = await deps.readAnswers(input.userId)
    const answers = Object.fromEntries(rows.map((r) => [r.question_key, fromAnswerEnvelope(r.answer)]))
    summary = expressSummary(answers)
  } catch (err) {
    console.error('[survey/express-complete] answers not read', err instanceof Error ? err.message : err)
  }
  const minutes = typeof input.minutes === 'number' && Number.isFinite(input.minutes) ? Math.min(600, Math.max(0, Math.round(input.minutes))) : 0
  try {
    await deps.trackOnce({
      userId: input.userId, name: 'SURVEY_EXPRESS_COMPLETED', entityType: 'survey', entityId: input.userId,
      metadata: { answered: summary.answered, unknown: summary.unknown, skipped: summary.skipped, minutes }, source: 'server',
    })
  } catch (err) {
    console.error('[survey/express-complete] event failed', err instanceof Error ? err.message : err)
  }
  let notified = false
  try {
    const [company, assignee] = await Promise.all([deps.companyOf(input.userId), deps.assigneeOf(input.userId)])
    await deps.notifyStaff({
      level: 'INFO',
      type: 'survey.express.completed',
      title: 'Клиент завершил быстрый старт — первичная Точка А готова',
      lines: [
        ...(company?.name ? [`Компания: ${company.name}`] : []),
        `Ответов: ${summary.answered} из ${summary.total}${summary.unknown ? `, «не знаю» — ${summary.unknown}` : ''}`,
        'Проверьте первичную Точку А: она посчитана по быстрым данным. Полная анкета ещё не отправлена.',
      ],
      companyId: company?.id ?? null,
      entityType: 'survey',
      entityId: input.userId,
      link: expressStaffLink(input.userId),
      // Once per client: a repeated «Готово» does not notify again.
      dedupeKey: `survey.express.completed:${input.userId}`,
      audienceUserIds: assignee ? [assignee] : null,
      audiencePermission: EXPRESS_STAFF_PERMISSION,
      skipCooldown: true,
    })
    notified = true
  } catch (err) {
    console.error('[survey/express-complete] notification failed', err instanceof Error ? err.message : err)
  }
  return { summary, notified }
}
