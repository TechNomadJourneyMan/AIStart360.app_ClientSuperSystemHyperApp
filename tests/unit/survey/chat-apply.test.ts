/**
 * «Записать» on a questionnaire chat card (spec §8.3): the only way the chat
 * writes survey_answers — author «вы», path chat, auto year, once per card;
 * «Исправить» goes through the same field schema; «Пропустить» writes nothing.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { memoryClient, type Row } from '../data-layer/memory-client'
import { applySurveyAction } from '@/lib/survey/chat/apply'
import { loadPending, type PendingRow } from '@/lib/chat/actions'

const USER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
let m: { client: unknown; db: Record<string, Row[]> }
const db = () => m.client as SupabaseClient
const future = new Date(Date.now() + 3_600_000).toISOString()

function card(id: string, key: string, envelope: Record<string, unknown>, extra: Partial<Row> = {}): Row {
  return { id, user_id: USER, company_id: null, conversation_id: 'conv1', kind: 'set_survey_answer', payload: { question_key: key, envelope, via: 'chat' }, preview: {}, status: 'pending', expires_at: future, ...extra }
}
const pending = async (id: string, user = USER) => (await loadPending(db(), id, user)) as PendingRow

beforeEach(() => {
  m = memoryClient({
    survey_answers: [],
    companies: [{ id: 'co1', user_id: USER }],
    ai_conversations: [{ id: 'conv1', user_id: USER, surface: 'survey' }],
    ai_messages: [],
    ai_pending_actions: [
      card('a1', 's1_current_revenue_month', { value: 5_500_000, approx: true, range: [5_000_000, 6_000_000] }),
      card('a2', 's1_employee_count', { value: 12 }),
      card('a3', 's6_main_pain', { value: 'нет людей' }),
      card('a4', 's1_contact_phone', { value: '+7 701 000 00 00' }),
      card('a5', 's1_employee_count', { value: 12 }, { expires_at: '2020-01-01T00:00:00Z' }),
    ],
  }) as never
})

describe('applySurveyAction', () => {
  it('writes the answer as the client via chat, with the auto year, once', async () => {
    const out = await applySurveyAction(db(), await pending('a1'), 'apply', { userId: USER })
    expect(out).toMatchObject({ ok: true, status: 'applied', key: 's1_current_revenue_month', companyId: 'co1', edited: false })
    const rows = m.db.survey_answers
    const month = rows.find((r) => r.question_key === 's1_current_revenue_month')
    expect(month).toMatchObject({ user_id: USER, step: 1, answer: { value: 5_500_000, approx: true, range: [5_000_000, 6_000_000] }, updated_by: USER, updated_by_role: 'user', updated_via: 'chat' })
    expect(rows.find((r) => r.question_key === 's1_current_revenue_year')?.answer).toEqual({ value: 66_000_000 })
    expect(m.db.ai_pending_actions.find((a) => a.id === 'a1')?.status).toBe('applied')
    expect(m.db.ai_messages.at(-1)).toMatchObject({ role: 'assistant', grounding: { kind: 'saved', key: 's1_current_revenue_month' } })
    // a second click (another tab) writes nothing
    const again = await applySurveyAction(db(), { ...(await pending('a1')), status: 'pending' }, 'apply', { userId: USER })
    expect(again).toMatchObject({ ok: false, status: 409 })
  })

  it('«Пропустить» changes nothing in survey_answers', async () => {
    const out = await applySurveyAction(db(), await pending('a2'), 'reject', { userId: USER })
    expect(out).toMatchObject({ ok: true, status: 'rejected' })
    expect(m.db.survey_answers).toHaveLength(0)
  })

  it('«Исправить»: the typed value through the field schema', async () => {
    expect(await applySurveyAction(db(), await pending('a2'), 'apply', { userId: USER, editedValue: 'двенадцать' })).toMatchObject({ ok: false, status: 400 })
    expect(m.db.survey_answers).toHaveLength(0)
    const ok = await applySurveyAction(db(), await pending('a2'), 'apply', { userId: USER, editedValue: '15' })
    expect(ok).toMatchObject({ ok: true, edited: true })
    expect(m.db.survey_answers[0]).toMatchObject({ question_key: 's1_employee_count', answer: { value: 15 }, updated_via: 'chat' })
  })

  it('refuses: another user, a form-only key, an expired card, profanity', async () => {
    const row = await pending('a3')
    expect(await applySurveyAction(db(), row, 'apply', { userId: OTHER })).toMatchObject({ ok: false, status: 403 })
    expect(await loadPending(db(), 'a3', OTHER)).toBeNull()
    expect(await applySurveyAction(db(), await pending('a4'), 'apply', { userId: USER })).toMatchObject({ ok: false, status: 400 })
    expect(await applySurveyAction(db(), await pending('a5'), 'apply', { userId: USER })).toMatchObject({ ok: false, status: 410 })
    expect(await applySurveyAction(db(), await pending('a3'), 'apply', { userId: USER, editedValue: 'всё хуёво' })).toMatchObject({ ok: false, status: 400 })
    expect(m.db.survey_answers).toHaveLength(0)
  })
})
