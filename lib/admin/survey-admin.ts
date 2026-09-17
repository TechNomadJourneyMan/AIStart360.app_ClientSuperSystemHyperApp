import { createActorServiceClient, createServiceClient } from '@/lib/supabase-service'
import { isWritableSurveyKey, stepForQuestionKey } from '@/lib/survey/steps'
import { recordAdminAction } from '@/lib/admin/audit'
import type { GigaActor } from '@/lib/admin/giga-actor'

/**
 * Staff edit of one user's questionnaire (CRUD on survey_answers).
 *
 *  - `changes[key] = value`  → upsert; `null` → delete the answer;
 *  - only survey keys are writable (never staff notes / widget data);
 *  - the audit entry (old → new of every touched key) is written BEFORE the
 *    change and is mandatory;
 *  - the write carries the actor, so survey_answer_history attributes it.
 */

const MAX_VALUE_BYTES = 64 * 1024
const MAX_KEYS = 400

export class SurveyEditError extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

export interface SurveyEditResult { updated: number; deleted: number; ignored: string[] }

export async function adminEditSurvey(
  actor: Pick<GigaActor, 'id' | 'kind'> & Partial<Pick<GigaActor, 'role' | 'email'>>,
  userId: string,
  changes: Record<string, unknown>,
  req: Request | null,
  opts: { source?: 'admin' | 'impersonation'; impersonationSessionId?: string | null; reason?: string } = {},
): Promise<SurveyEditResult> {
  const entries = Object.entries(changes)
  if (entries.length === 0) throw new SurveyEditError('Нет изменений')
  if (entries.length > MAX_KEYS) throw new SurveyEditError('Слишком много полей за раз')
  const ignored = entries.filter(([k]) => !isWritableSurveyKey(k)).map(([k]) => k)
  const valid = entries.filter(([k]) => isWritableSurveyKey(k))
  if (valid.length === 0) throw new SurveyEditError('Нет допустимых полей анкеты')
  for (const [k, v] of valid) {
    if (v !== null && JSON.stringify(v ?? null).length > MAX_VALUE_BYTES) throw new SurveyEditError(`Слишком большое значение: ${k}`)
  }

  const reader = createServiceClient()
  const { data: existing, error: readErr } = await reader
    .from('survey_answers')
    .select('question_key, step, answer')
    .eq('user_id', userId)
    .in('question_key', valid.map(([k]) => k))
  if (readErr) throw new SurveyEditError('Не удалось прочитать анкету', 500)
  const before = new Map((existing ?? []).map((r) => [String(r.question_key), r as { step: number | null; answer: { value?: unknown } | null }]))

  const oldValue: Record<string, unknown> = {}
  const newValue: Record<string, unknown> = {}
  const upserts: Array<Record<string, unknown>> = []
  const deletes: string[] = []
  for (const [key, value] of valid) {
    const prev = before.get(key)?.answer?.value
    if (JSON.stringify(prev ?? null) === JSON.stringify(value ?? null)) continue
    oldValue[key] = prev ?? null
    newValue[key] = value
    if (value === null) {
      if (before.has(key)) deletes.push(key)
    } else {
      upserts.push({
        user_id: userId,
        question_key: key,
        step: stepForQuestionKey(key, null) ?? before.get(key)?.step ?? 0,
        answer: { value },
        answered_at: new Date().toISOString(),
      })
    }
  }
  if (!upserts.length && !deletes.length) return { updated: 0, deleted: 0, ignored }

  const source = opts.source ?? 'admin'
  await recordAdminAction(
    actor,
    {
      action: source === 'impersonation' ? 'impersonation.survey_edited' : 'user.survey_edited',
      entityType: 'survey',
      entityId: userId,
      targetUserId: userId,
      oldValue,
      newValue,
      impersonationSessionId: opts.impersonationSessionId ?? null,
      metadata: { keys: Object.keys(newValue), reason: opts.reason ?? null },
    },
    req,
    { required: true },
  )

  const writer = createActorServiceClient({ id: actor.id, source, impersonationSessionId: opts.impersonationSessionId })
  if (upserts.length) {
    const { error } = await writer.from('survey_answers').upsert(upserts, { onConflict: 'user_id,question_key' })
    if (error) throw new SurveyEditError('Не удалось сохранить анкету', 500)
  }
  if (deletes.length) {
    const { error } = await writer.from('survey_answers').delete().eq('user_id', userId).in('question_key', deletes)
    if (error) throw new SurveyEditError('Не удалось удалить ответы', 500)
  }
  return { updated: upserts.length, deleted: deletes.length, ignored }
}
