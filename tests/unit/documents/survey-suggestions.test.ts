import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ParsedDataField } from '@/lib/documents/extract'
import {
  acceptSuggestion,
  listPendingSuggestions,
  mapFieldsToSurveySuggestions,
  parseNumericValue,
  rejectSuggestion,
  storeDocumentSuggestions,
} from '@/lib/documents/survey-suggestions'

// ── Minimal in-memory Supabase fake (select/eq/in/order/limit/maybeSingle, update, upsert) ──
type Row = Record<string, unknown>
function fakeSupabase(tables: Record<string, Row[]>): SupabaseClient {
  let seq = 0
  const from = (table: string) => {
    const rows = (tables[table] ??= [])
    const filters: Array<(r: Row) => boolean> = []
    let op: 'select' | 'update' = 'select'
    let patch: Row = {}
    const run = () => rows.filter((r) => filters.every((f) => f(r)))
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q },
      in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return q },
      order: () => q,
      limit: () => q,
      update: (p: Row) => { op = 'update'; patch = p; return q },
      upsert: async (input: Row[]) => {
        for (const r of input) {
          const dup = rows.find((x) => x.user_id === r.user_id && x.question_key === r.question_key && x.source_document_id === r.source_document_id)
          if (!dup) rows.push({ id: `s${++seq}`, ...r })
        }
        return { error: null }
      },
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      then: (resolve: (v: { data: Row[] | null; error: null }) => unknown) => {
        if (op === 'update') { for (const r of run()) Object.assign(r, patch); return Promise.resolve(resolve({ data: null, error: null })) }
        return Promise.resolve(resolve({ data: run(), error: null }))
      },
    }
    return q
  }
  return { from } as unknown as SupabaseClient
}

const USER = '11111111-2222-3333-4444-555555555555'
const field = (f: Partial<ParsedDataField>): ParsedDataField =>
  ({ key: 'x', label: 'x', value: 0, target_tab: 'Финансы', target_parameter: 'x', confidence: 0.9, ...f }) as ParsedDataField

describe('parseNumericValue', () => {
  it('parses spaced numbers, decimal commas and scale words', () => {
    expect(parseNumericValue('12 500 000 ₸')).toBe(12_500_000)
    expect(parseNumericValue('12,5 млн')).toBe(12_500_000)
    expect(parseNumericValue(850, 'Выручка, тыс. ₸')).toBe(850_000)
    expect(parseNumericValue('нет данных')).toBeNull()
  })
})

describe('mapFieldsToSurveySuggestions', () => {
  it('maps canonical metrics to wizard keys (bind-fields synonyms)', () => {
    const s = mapFieldsToSurveySuggestions([
      field({ key: 'net_profit', label: 'Чистая прибыль', value: '3 100 000' }),
      field({ key: 'net_margin', label: 'Чистая маржа', value: 0.18 }),
      field({ key: 'revenue_2024', label: 'Выручка 2024', value: '150 000 000' }),
      field({ key: 'notes', label: 'Комментарий', value: 'текст' }),
    ])
    const byKey = Object.fromEntries(s.map((x) => [x.question_key, x.value]))
    expect(byKey).toMatchObject({ s9n_net_profit: 3_100_000, s9n_net_margin: 18, s9n_revenue_2024: 150_000_000 })
    expect(Object.keys(byKey)).toHaveLength(3)
  })

  it('turns an undated annual revenue into monthly revenue with lower confidence', () => {
    const [s] = mapFieldsToSurveySuggestions([field({ key: 'revenue', label: 'Выручка за год', value: 120_000_000, confidence: 1 })])
    expect(s).toMatchObject({ question_key: 's1_current_revenue_month', value: 10_000_000, confidence: 0.8 })
  })
})

describe('store / accept / reject', () => {
  it('never suggests a key the user already answered', async () => {
    const sb = fakeSupabase({
      survey_answers: [{ user_id: USER, question_key: 's9n_net_profit', answer: { value: 42 } }],
      document_survey_suggestions: [],
    })
    const r = await storeDocumentSuggestions(sb, {
      userId: USER, documentId: 'doc-1',
      fields: [field({ key: 'net_profit', label: 'Чистая прибыль', value: 100 }), field({ key: 'ar_days', label: 'Дебиторка, дней', value: 45 })],
    })
    expect(r).toEqual({ stored: 1, skippedAnswered: 1 })
    const list = await listPendingSuggestions(sb, USER)
    expect(list.map((x) => x.question_key)).toEqual(['s9n_debtor_days'])
    expect(list[0].step).toBe(9)
  })

  it('accept returns the value for an unanswered question and marks it accepted', async () => {
    const tables = {
      survey_answers: [] as Row[],
      document_survey_suggestions: [{ id: 's1', user_id: USER, question_key: 's9n_net_profit', value: 3_100_000, status: 'pending' }] as Row[],
    }
    const sb = fakeSupabase(tables)
    await expect(acceptSuggestion(sb, USER, 's1')).resolves.toEqual({ ok: true, question_key: 's9n_net_profit', value: 3_100_000 })
    expect(tables.document_survey_suggestions[0].status).toBe('accepted')
    // a second accept is refused
    await expect(acceptSuggestion(sb, USER, 's1')).resolves.toEqual({ ok: false, error: 'not_pending' })
  })

  it('accept never overwrites a typed answer', async () => {
    const tables = {
      survey_answers: [{ user_id: USER, question_key: 's9n_net_profit', answer: { value: 777 } }] as Row[],
      document_survey_suggestions: [{ id: 's1', user_id: USER, question_key: 's9n_net_profit', value: 3_100_000, status: 'pending' }] as Row[],
    }
    const sb = fakeSupabase(tables)
    await expect(acceptSuggestion(sb, USER, 's1')).resolves.toEqual({ ok: false, error: 'already_answered' })
    expect(tables.survey_answers[0].answer).toEqual({ value: 777 })
    expect(tables.document_survey_suggestions[0].status).toBe('rejected')
  })

  it("cannot touch another user's suggestion", async () => {
    const sb = fakeSupabase({
      survey_answers: [],
      document_survey_suggestions: [{ id: 's1', user_id: 'someone-else', question_key: 's9n_net_profit', value: 1, status: 'pending' }],
    })
    await expect(acceptSuggestion(sb, USER, 's1')).resolves.toEqual({ ok: false, error: 'not_found' })
    await expect(rejectSuggestion(sb, USER, 's1')).resolves.toEqual({ ok: false, error: 'not_found' })
  })
})
