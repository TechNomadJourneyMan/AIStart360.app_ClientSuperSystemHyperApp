import { createServiceClient } from '@/lib/supabase-service'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { sendSurveyReminderEmail } from '@/lib/email'
import { buildUserProfileSummary } from '@/lib/user-dashboard/summary'
import { isWizardVisibleKey } from '@/lib/survey/steps'

/**
 * Напоминание «допройдите анкету» пачке клиентов. Общий код для
 * /users/bulk-remind и массового действия remind_survey в /users/bulk.
 *
 * Не чаще раза в сутки на человека; тем, у кого анкета заполнена или нет
 * адреса, письмо не уходит — они возвращаются с причиной.
 */

export type ReminderOutcome = 'sent' | 'skipped' | 'failed'
export interface ReminderResult { userId: string; outcome: ReminderOutcome; message: string }

export async function remindSurveyBatch(
  ids: string[],
  opts: { fromLabel: string | null; note?: string | null },
): Promise<ReminderResult[]> {
  const sb = createServiceClient()
  const [{ data: profiles }, { data: companies }, { data: answers }] = await Promise.all([
    sb.from('profiles').select('id, email, full_name').in('id', ids),
    sb.from('companies').select('user_id, name').in('user_id', ids),
    sb.from('survey_answers').select('user_id, question_key, answer').in('user_id', ids),
  ])

  const companyByUser = new Map<string, string | null>()
  for (const c of (companies ?? []) as Array<{ user_id: string; name: string | null }>) companyByUser.set(c.user_id, c.name)

  const answersByUser = new Map<string, Record<string, unknown>>()
  for (const a of (answers ?? []) as Array<{ user_id: string; question_key: string; answer: { value?: unknown } | null }>) {
    if (!isWizardVisibleKey(a.question_key)) continue
    const bag = answersByUser.get(a.user_id) ?? {}
    bag[a.question_key] = a.answer?.value
    answersByUser.set(a.user_id, bag)
  }

  const results: ReminderResult[] = []
  for (const p of (profiles ?? []) as Array<{ id: string; email: string | null; full_name: string | null }>) {
    if (!p.email) {
      results.push({ userId: p.id, outcome: 'skipped', message: 'нет email' })
      continue
    }
    const summary = buildUserProfileSummary(answersByUser.get(p.id) ?? {})
    if (summary.startedSteps >= summary.totalSteps) {
      results.push({ userId: p.id, outcome: 'skipped', message: 'анкета уже заполнена' })
      continue
    }
    if (await isRateLimitedKey(p.id, 'survey-reminder', { max: 1, windowMs: 24 * 60 * 60_000 })) {
      results.push({ userId: p.id, outcome: 'skipped', message: 'напоминали за последние сутки' })
      continue
    }
    const sent = await sendSurveyReminderEmail(p.email, {
      userId: p.id,
      name: p.full_name ?? null,
      company: companyByUser.get(p.id) ?? null,
      completedSteps: summary.startedSteps,
      totalSteps: summary.totalSteps,
      missingSections: summary.sections.filter((s) => s.filled === 0).map((s) => s.title),
      fromLabel: opts.fromLabel,
      note: opts.note ?? null,
    })
    results.push(sent.ok
      ? { userId: p.id, outcome: 'sent', message: 'отправлено' }
      : { userId: p.id, outcome: 'failed', message: sent.error ?? 'письмо не отправилось' })
  }

  for (const id of ids) {
    if (!results.some((r) => r.userId === id)) results.push({ userId: id, outcome: 'skipped', message: 'пользователь не найден' })
  }
  return results
}
