/**
 * lib/survey/chat/apply.ts — «Записать» / «Исправить» / «Пропустить» on a
 * questionnaire chat card (ai_pending_actions kind 'set_survey_answer', spec §8.3).
 *
 * The ONLY way the chat changes survey_answers. Re-checked at click time: the
 * card is the caller's (loadPending filters by user), pending, not expired;
 * the key is a chat question of the registry; the envelope (or the value the
 * client typed in «Исправить») passes the same field schema as the
 * questionnaire save. The atomic claim makes a double click write once. The
 * write is the one path of lib/survey/write.ts: author «вы» (role 'user'), path
 * 'chat' («Заполнил: вы (через ИИ-помощника)»), «год = месяц × 12», the goal
 * follows a step-1 goal answer.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { claim, finish, type PendingRow } from '@/lib/chat/actions'
import { SURVEY_QUESTIONS } from '../questions'
import { prepareSurveyWrite, surveyProfanityResponse, syncGoalsAfterWrite, writeSurveyRows, type ExistingAnswerRow } from '../write'
import { attributionColumns, type AnswerAuthor } from '../attribution'
import type { AnswerAttribution } from '../attribution-label'
import { formatChatValue } from './ask'
import { insertMessages } from './store'
import { editedEnvelope, isValidEnvelope } from './value'

export type SurveyApplyOutcome =
  | { ok: true; status: 'applied'; key: string; companyId: string | null; edited: boolean; attribution: Record<string, AnswerAttribution> }
  | { ok: true; status: 'rejected'; key: string }
  | { ok: false; status: 400 | 403 | 409 | 410 | 500; error: string }

const AUTO_YEAR = (key: string) => key.replace(/_month$/, '_year')

export async function applySurveyAction(
  db: SupabaseClient,
  row: PendingRow,
  decision: 'apply' | 'reject',
  opts: { userId: string; editedValue?: unknown; now?: Date },
): Promise<SurveyApplyOutcome> {
  if (row.kind !== 'set_survey_answer' || row.user_id !== opts.userId) return { ok: false, status: 403, error: 'forbidden' }
  const key = String(row.payload?.question_key ?? '')
  if (row.status !== 'pending') return { ok: false, status: 409, error: 'already_decided' }
  if (Date.parse(row.expires_at) < (opts.now ?? new Date()).getTime()) {
    await finish(db, row.id, 'expired', null, 'pending')
    return { ok: false, status: 410, error: 'expired' }
  }
  if (decision === 'reject') {
    if (!(await claim(db, row.id, 'rejected'))) return { ok: false, status: 409, error: 'already_decided' }
    return { ok: true, status: 'rejected', key }
  }

  const q = SURVEY_QUESTIONS[key]
  if (!q || q.chat !== 'ask') return { ok: false, status: 400, error: 'bad_value' }
  const edited = opts.editedValue !== undefined
  const proposed = row.payload?.envelope as Record<string, unknown> | undefined
  const envelope = edited ? editedEnvelope(q, opts.editedValue) : proposed && typeof proposed === 'object' && isValidEnvelope(q, proposed) ? proposed : null
  if (!envelope) return { ok: false, status: 400, error: 'bad_value' }
  if (surveyProfanityResponse({ [key]: envelope })) return { ok: false, status: 400, error: 'profanity' }

  if (!(await claim(db, row.id, 'applying'))) return { ok: false, status: 409, error: 'already_decided' }
  try {
    const at = opts.now ?? new Date()
    const [{ data: existing }, { data: company }] = await Promise.all([
      db.from('survey_answers').select('question_key, step, answer').eq('user_id', opts.userId).in('question_key', [key, AUTO_YEAR(key)]),
      db.from('companies').select('id').eq('user_id', opts.userId).maybeSingle(),
    ])
    const companyId = (company as { id?: unknown } | null)?.id != null ? String((company as { id: unknown }).id) : null
    const prepared = prepareSurveyWrite({ ownerId: opts.userId, companyId, envelopes: { [key]: envelope }, existing: (existing ?? []) as ExistingAnswerRow[], at })
    const author: AnswerAuthor = { id: opts.userId, role: 'user', via: 'chat' }
    const written = await writeSurveyRows(db, prepared.rows, () => author, { at, label: 'survey/chat' })
    if (written.error) throw new Error('write')
    try {
      await syncGoalsAfterWrite(db, { ownerId: opts.userId, companyId, rows: prepared.rows, actor: { id: opts.userId, role: 'owner' }, allowClear: true })
    } catch (err) {
      console.warn('[survey-chat/apply] goal sync failed:', err instanceof Error ? err.message : err)
    }
    await finish(db, row.id, 'applied', { key, envelope, edited })
    if (row.conversation_id) {
      const shown = formatChatValue(q, envelope.unknown || envelope.approx ? envelope : envelope.value)
      await insertMessages(db, row.conversation_id, [{
        role: 'assistant', content: `Записано: ${q.label} — ${shown}.`,
        grounding: { kind: 'saved', key, proposal_id: row.id, intent: edited ? 'edited' : 'applied' },
      }], at).catch(() => [])
    }
    const cols = attributionColumns(author, at)
    const attribution: Record<string, AnswerAttribution> = {}
    for (const r of prepared.rows) {
      attribution[r.question_key] = { updatedBy: cols.updated_by, updatedByRole: cols.updated_by_role, updatedAt: cols.updated_at, updatedByName: null, updatedVia: 'chat' }
    }
    return { ok: true, status: 'applied', key, companyId, edited, attribution }
  } catch (err) {
    console.error('[survey-chat/apply] failed', err instanceof Error ? err.message : err)
    await finish(db, row.id, 'failed', { error: 'apply_failed' })
    return { ok: false, status: 500, error: 'apply_failed' }
  }
}
