/**
 * lib/documents/survey-suggestions.ts — documents fill the survey (F-076, idea M20).
 *
 * After a document is parsed, its extracted metrics (`parsed_data.fields`) are
 * mapped to survey question keys and stored as SUGGESTIONS
 * (`document_survey_suggestions`, migration 091). The wizard shows a chip
 * «Из документа: 12 500 000 ₸ · Принять» next to the step; accepting writes the
 * value through the wizard's normal save path.
 *
 * Rules:
 *   - never overwrite: a key that already has an answer gets no suggestion,
 *     and `acceptSuggestion` refuses when an answer appeared meanwhile;
 *   - numeric only (money / percent / count / days) — free text is not guessed;
 *   - mapping reuses the synonym dictionary of the metric binder
 *     (`matchSynonym`, bind-fields concept) plus a small, explicit
 *     canonical → survey-key table (no LLM, no cost).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ParsedDataField } from '@/lib/documents/extract'
import { matchSynonym } from '@/lib/documents/synonyms'
import { SURVEY_KEY_STEP, stepForQuestionKey } from '@/lib/survey/steps'

export type SuggestionKind = 'money' | 'percent' | 'count' | 'days'

interface Target {
  key: string
  label: string
  kind: SuggestionKind
}

/** canonical metric (synonyms.ts) → survey question. */
const CANONICAL_TARGETS: Record<string, Target> = {
  net_profit: { key: 's9n_net_profit', label: 'Чистая прибыль', kind: 'money' },
  net_margin: { key: 's9n_net_margin', label: 'Чистая маржа, %', kind: 'percent' },
  cogs: { key: 's9n_expense_cogs', label: 'Себестоимость', kind: 'money' },
  cost_of_sales: { key: 's9n_expense_cogs', label: 'Себестоимость', kind: 'money' },
  marketing_budget: { key: 's9n_expense_marketing', label: 'Маркетинг и реклама', kind: 'money' },
  ad_spend: { key: 's9n_expense_marketing', label: 'Маркетинг и реклама', kind: 'money' },
  debt_load: { key: 's9n_debts_amount', label: 'Кредиты и долги', kind: 'money' },
  ar_days: { key: 's9n_debtor_days', label: 'Срок оплаты дебиторки, дней', kind: 'days' },
  leads_count: { key: 's7_leads_per_month', label: 'Лидов в месяц', kind: 'count' },
  conversion_rate: { key: 's5n_funnel_lead_to_sale', label: 'Лид → продажа, %', kind: 'percent' },
  funnel_lead_to_call: { key: 's5n_funnel_lead_to_call', label: 'Лид → звонок, %', kind: 'percent' },
  employee_count: { key: 's1_employee_count', label: 'Кол-во сотрудников', kind: 'count' },
}

const REVENUE_CANONICALS = new Set(['revenue', 'gross_revenue', 'net_revenue', 'sales'])

export interface SurveySuggestionDraft {
  question_key: string
  value: number
  label: string
  kind: SuggestionKind
  confidence: number
}

/** Parse "12 500 000", "12,5 млн", "1.2M", "25%", 1250000 → number (or null). */
export function parseNumericValue(value: unknown, context = ''): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? applyScale(value, context) : null
  if (typeof value !== 'string') return null
  const raw = value.trim().toLowerCase()
  if (!raw) return null
  const m = raw.replace(/ /g, ' ').match(/-?\d[\d\s]*(?:[.,]\d+)?/)
  if (!m) return null
  const n = Number(m[0].replace(/\s/g, '').replace(',', '.'))
  if (!Number.isFinite(n)) return null
  return applyScale(n, `${raw} ${context}`)
}

function applyScale(n: number, text: string): number {
  const t = text.toLowerCase()
  if (/(млрд|billion|\bbn\b)/.test(t)) return n * 1e9
  if (/(млн|million|\bmln\b|\bm\b)/.test(t)) return n * 1e6
  if (/(тыс|thousand|\bk\b)/.test(t)) return n * 1e3
  return n
}

function normalizeByKind(n: number, kind: SuggestionKind): number | null {
  if (kind === 'percent') {
    const pct = n > 0 && n < 1 ? n * 100 : n
    return pct >= -100 && pct <= 1000 ? Math.round(pct * 100) / 100 : null
  }
  if (kind === 'count' || kind === 'days') return n >= 0 ? Math.round(n) : null
  return Math.round(n)
}

/** Map extracted document fields to survey suggestions (pure; best field per key wins). */
export function mapFieldsToSurveySuggestions(fields: ReadonlyArray<ParsedDataField>): SurveySuggestionDraft[] {
  const best = new Map<string, SurveySuggestionDraft>()
  for (const field of fields ?? []) {
    const text = `${field.key ?? ''} ${field.label ?? ''} ${field.target_parameter ?? ''}`
    const baseConfidence = typeof field.confidence === 'number' ? Math.max(0, Math.min(1, field.confidence)) : 0.6
    let target: Target | null = null
    let divideBy = 1
    let confidence = baseConfidence

    const canonical = matchSynonym(field.key ?? '') ?? matchSynonym(field.label ?? '')
    if (canonical && REVENUE_CANONICALS.has(canonical)) {
      const lower = text.toLowerCase()
      if (/2024/.test(lower)) target = { key: 's9n_revenue_2024', label: 'Годовая выручка 2024', kind: 'money' }
      else if (/(мес|month)/.test(lower)) target = { key: 's1_current_revenue_month', label: 'Выручка / месяц', kind: 'money' }
      else {
        // Annual figure without a year → monthly revenue of the wizard, flagged as derived.
        target = { key: 's1_current_revenue_month', label: 'Выручка / месяц (год ÷ 12)', kind: 'money' }
        divideBy = 12
        confidence *= 0.8
      }
    } else if (canonical && CANONICAL_TARGETS[canonical]) {
      target = CANONICAL_TARGETS[canonical]
    } else if (field.key && field.key in SURVEY_KEY_STEP && typeof field.value === 'number') {
      // The extractor already used a wizard key — trust it for plain numbers.
      target = { key: field.key, label: field.label || field.key, kind: 'money' }
    }
    if (!target) continue

    const parsed = parseNumericValue(field.value, field.label ?? '')
    if (parsed == null) continue
    const value = normalizeByKind(parsed / divideBy, target.kind)
    if (value == null) continue

    const draft: SurveySuggestionDraft = {
      question_key: target.key,
      value,
      label: target.label,
      kind: target.kind,
      confidence: Math.round(confidence * 1000) / 1000,
    }
    const prev = best.get(target.key)
    if (!prev || draft.confidence > prev.confidence) best.set(target.key, draft)
  }
  return Array.from(best.values())
}

/** A stored answer counts as "typed" when it holds any non-empty value. */
export function hasAnswerValue(answer: unknown): boolean {
  const v = answer && typeof answer === 'object' && !Array.isArray(answer) && 'value' in (answer as object)
    ? (answer as { value: unknown }).value
    : answer
  if (v === null || v === undefined) return false
  if (typeof v === 'string') return v.trim() !== ''
  if (typeof v === 'number') return Number.isFinite(v) && v !== 0
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'object') return Object.keys(v as object).length > 0
  return true
}

async function answeredKeys(sb: SupabaseClient, userId: string, keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set()
  const { data, error } = await sb
    .from('survey_answers')
    .select('question_key, answer')
    .eq('user_id', userId)
    .in('question_key', keys)
  if (error) throw new Error(error.message)
  return new Set(
    ((data ?? []) as Array<{ question_key: string; answer: unknown }>)
      .filter((r) => hasAnswerValue(r.answer))
      .map((r) => r.question_key),
  )
}

/**
 * Store suggestions for one parsed document. Keys the user already answered
 * are skipped; re-processing the same document is idempotent. Never throws.
 */
export async function storeDocumentSuggestions(
  sb: SupabaseClient,
  input: { userId: string; documentId: string; fields: ReadonlyArray<ParsedDataField> },
): Promise<{ stored: number; skippedAnswered: number }> {
  try {
    const drafts = mapFieldsToSurveySuggestions(input.fields)
    if (drafts.length === 0) return { stored: 0, skippedAnswered: 0 }
    const answered = await answeredKeys(sb, input.userId, drafts.map((d) => d.question_key))
    const rows = drafts
      .filter((d) => !answered.has(d.question_key))
      .map((d) => ({
        user_id: input.userId,
        question_key: d.question_key,
        value: d.value,
        label: d.label,
        source_document_id: input.documentId,
        confidence: d.confidence,
        status: 'pending',
      }))
    if (rows.length) {
      const { error } = await sb
        .from('document_survey_suggestions')
        .upsert(rows, { onConflict: 'user_id,question_key,source_document_id', ignoreDuplicates: true })
      if (error) throw new Error(error.message)
    }
    return { stored: rows.length, skippedAnswered: drafts.length - rows.length }
  } catch (err) {
    console.warn('[survey-suggestions] store failed:', err instanceof Error ? err.message : err)
    return { stored: 0, skippedAnswered: 0 }
  }
}

export interface SurveySuggestion {
  id: string
  question_key: string
  value: unknown
  label: string | null
  confidence: number | null
  source_document_id: string | null
  document_name: string | null
  step: number | null
}

/** Pending suggestions for keys that are still unanswered (newest per key). */
export async function listPendingSuggestions(sb: SupabaseClient, userId: string): Promise<SurveySuggestion[]> {
  const { data, error } = await sb
    .from('document_survey_suggestions')
    .select('id, question_key, value, label, confidence, source_document_id, created_at, documents(file_name)')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as unknown as Array<{
    id: string; question_key: string; value: unknown; label: string | null; confidence: number | string | null
    source_document_id: string | null; documents?: { file_name?: string | null } | Array<{ file_name?: string | null }> | null
  }>
  const answered = await answeredKeys(sb, userId, Array.from(new Set(rows.map((r) => r.question_key))))
  const seen = new Set<string>()
  const out: SurveySuggestion[] = []
  for (const r of rows) {
    if (answered.has(r.question_key) || seen.has(r.question_key)) continue
    seen.add(r.question_key)
    const doc = Array.isArray(r.documents) ? r.documents[0] : r.documents
    out.push({
      id: r.id,
      question_key: r.question_key,
      value: r.value,
      label: r.label,
      confidence: r.confidence == null ? null : Number(r.confidence),
      source_document_id: r.source_document_id,
      document_name: doc?.file_name ?? null,
      step: stepForQuestionKey(r.question_key, null),
    })
  }
  return out
}

export type DecideResult =
  | { ok: true; question_key: string; value: unknown }
  | { ok: false; error: 'not_found' | 'not_pending' | 'already_answered' }

async function loadOwn(sb: SupabaseClient, userId: string, id: string) {
  const { data, error } = await sb
    .from('document_survey_suggestions')
    .select('id, user_id, question_key, value, status')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as { id: string; user_id: string; question_key: string; value: unknown; status: string } | null
}

/**
 * Accept a suggestion: refuses when the question already has an answer (the
 * suggestion is then closed as rejected — a typed answer always wins). On
 * success returns the value; the caller writes it through the survey save path.
 */
export async function acceptSuggestion(sb: SupabaseClient, userId: string, id: string): Promise<DecideResult> {
  const row = await loadOwn(sb, userId, id)
  if (!row) return { ok: false, error: 'not_found' }
  if (row.status !== 'pending') return { ok: false, error: 'not_pending' }
  const answered = await answeredKeys(sb, userId, [row.question_key])
  const now = new Date().toISOString()
  if (answered.has(row.question_key)) {
    await sb.from('document_survey_suggestions').update({ status: 'rejected', decided_at: now }).eq('id', id).eq('user_id', userId)
    return { ok: false, error: 'already_answered' }
  }
  const { error } = await sb
    .from('document_survey_suggestions')
    .update({ status: 'accepted', decided_at: now })
    .eq('id', id)
    .eq('user_id', userId)
    .eq('status', 'pending')
  if (error) throw new Error(error.message)
  return { ok: true, question_key: row.question_key, value: row.value }
}

export async function rejectSuggestion(sb: SupabaseClient, userId: string, id: string): Promise<DecideResult> {
  const row = await loadOwn(sb, userId, id)
  if (!row) return { ok: false, error: 'not_found' }
  if (row.status !== 'pending') return { ok: false, error: 'not_pending' }
  const { error } = await sb
    .from('document_survey_suggestions')
    .update({ status: 'rejected', decided_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(error.message)
  return { ok: true, question_key: row.question_key, value: row.value }
}
