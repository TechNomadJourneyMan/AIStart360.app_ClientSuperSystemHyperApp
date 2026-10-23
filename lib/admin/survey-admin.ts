import { createActorServiceClient, createServiceClient } from '@/lib/supabase-service'
import { AUTO_KEYS, isWritableSurveyKey } from '@/lib/survey/steps'
import { recordAdminAction } from '@/lib/admin/audit'
import type { GigaActor } from '@/lib/admin/giga-actor'
import { staffAuthorRole, type AnswerAuthor } from '@/lib/survey/attribution'
import { fromAnswerEnvelope, toAnswerEnvelope } from '@/lib/survey/answer-value'
import { prepareSurveyWrite, writeSurveyRows } from '@/lib/survey/write'

/**
 * Staff edit of one user's questionnaire (CRUD on survey_answers).
 *
 *  - `changes[key] = value`  → upsert; `null` → delete the answer; a «не знаю» /
 *    «примерно» mark (lib/survey/answer-value.ts) is stored as its own envelope;
 *  - only survey keys are writable (never staff notes / widget data);
 *  - the audit entry (old → new of every touched key) is written BEFORE the
 *    change and is mandatory;
 *  - the write carries the actor, so survey_answer_history attributes it;
 *  - rows are built by the one write path (lib/survey/write.ts): the step that
 *    owns the key, the envelope, «год = месяц × 12», author + path «staff».
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
  opts: {
    source?: 'admin' | 'impersonation'
    impersonationSessionId?: string | null
    reason?: string
    /** The author line role; default from the actor's staff role. A profile expert → 'expert'. */
    authorRole?: 'expert' | 'admin'
    /** Audit action name (default user.survey_edited / impersonation.survey_edited). */
    auditAction?: string
  } = {},
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
  // The «год = месяц × 12» keys are read too: a month edited alone moves its year.
  const readKeys = Array.from(new Set([...valid.map(([k]) => k), ...AUTO_KEYS]))
  const { data: existing, error: readErr } = await reader
    .from('survey_answers')
    .select('question_key, step, answer')
    .eq('user_id', userId)
    .in('question_key', readKeys)
  if (readErr) throw new SurveyEditError('Не удалось прочитать анкету', 500)
  const existingRows = (existing ?? []) as Array<{ question_key: string; step: number | null; answer: unknown }>
  const before = new Map(existingRows.map((r) => [String(r.question_key), r]))

  const oldValue: Record<string, unknown> = {}
  const newValue: Record<string, unknown> = {}
  const envelopes: Record<string, unknown> = {}
  const toDelete: string[] = []
  for (const [key, value] of valid) {
    const prev = fromAnswerEnvelope(before.get(key)?.answer)
    if (JSON.stringify(prev ?? null) === JSON.stringify(value ?? null)) continue
    oldValue[key] = prev ?? null
    newValue[key] = value
    if (value === null) {
      if (before.has(key)) toDelete.push(key)
    } else {
      envelopes[key] = toAnswerEnvelope(value)
    }
  }
  const prepared = prepareSurveyWrite({ ownerId: userId, envelopes, deletes: toDelete, existing: existingRows })
  // An auto year that follows the month is part of the change (audit old → new).
  for (const key of prepared.autoAdded) {
    const row = prepared.rows.find((r) => r.question_key === key)
    const next = fromAnswerEnvelope(row?.answer)
    const prev = fromAnswerEnvelope(before.get(key)?.answer)
    if (JSON.stringify(prev ?? null) === JSON.stringify(next ?? null)) {
      prepared.rows = prepared.rows.filter((r) => r.question_key !== key)
      continue
    }
    oldValue[key] = prev ?? null
    newValue[key] = next ?? null
  }
  // Rows of other intakes keep their stored step; company_id is not touched by staff edits.
  const upserts = prepared.rows
  const deletes = prepared.deletes
  if (!upserts.length && !deletes.length) return { updated: 0, deleted: 0, ignored }

  const source = opts.source ?? 'admin'
  await recordAdminAction(
    actor,
    {
      action: opts.auditAction ?? (source === 'impersonation' ? 'impersonation.survey_edited' : 'user.survey_edited'),
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
    // The line under the field (migrations 131 / 134): «Изменил эксперт / админ …», path «staff».
    const author: AnswerAuthor = { id: actor.id, role: opts.authorRole ?? staffAuthorRole(actor.role ?? 'admin'), via: 'staff' }
    const { error } = await writeSurveyRows(writer, upserts, () => author, { label: 'admin/survey-edit' })
    if (error) throw new SurveyEditError('Не удалось сохранить анкету', 500)
  }
  if (deletes.length) {
    const { error } = await writer.from('survey_answers').delete().eq('user_id', userId).in('question_key', deletes)
    if (error) throw new SurveyEditError('Не удалось удалить ответы', 500)
  }
  return { updated: upserts.length, deleted: deletes.length, ignored }
}
