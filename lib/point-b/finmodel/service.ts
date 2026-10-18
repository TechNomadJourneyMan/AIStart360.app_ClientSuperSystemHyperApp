/**
 * lib/point-b/finmodel/service.ts — what the finmodel routes need around the store: the state of a
 * client's finmodel (stored values + questionnaire + industry assumptions) from a user id, the
 * definitions the form shows, and the error → answer mapping shared by the owner and the expert routes.
 *
 * Service-role client; the callers authorise the user / the expert first.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { PROFANITY_MESSAGE } from '@/lib/moderation/http'
import { ProfanityError } from '@/lib/moderation/profanity'
import { templateKeyFor } from '../model/levels'
import { FINMODEL_DEFS, FINMODEL_KEYS, type FinmodelKey, type FinmodelKeyDef } from './keys'
import { loadSurveyAnswers } from './sources'
import { FinmodelError, loadFinmodel, mergeFinmodel, type FinmodelInputValue, type FinmodelState } from './store'

/** What the form needs of a key (functions and the source ids stay on the server). */
export interface FinmodelDefView {
  key: FinmodelKey
  label: string
  unit: FinmodelKeyDef['unit']
  hint: string
  unlocks: string
  required: boolean
  /** Required only when there is a debt. */
  conditional: boolean
  min: number
  max: number
  group: FinmodelKeyDef['group']
}

export function finmodelDefsView(): FinmodelDefView[] {
  return FINMODEL_KEYS.map((key) => {
    const d = FINMODEL_DEFS[key]
    return { key, label: d.label, unit: d.unit, hint: d.hint, unlocks: d.unlocks, required: d.required, conditional: !!d.requiredIf, min: d.min, max: d.max, group: d.group }
  })
}

async function industryOf(sb: SupabaseClient, companyId: string): Promise<string | null> {
  const { data, error } = await sb.from('companies').select('industry').eq('id', companyId).maybeSingle()
  if (error) {
    console.error('[point-b/finmodel] industry not read — the default template is used', error.code ?? 'unknown')
    return null
  }
  return (data as { industry?: string | null } | null)?.industry ?? null
}

/** The merged finmodel of a client. A client without a company still gets the state (nothing typed, defaults only). */
export async function loadFinmodelForUser(
  sb: SupabaseClient, input: { userId: string; companyId: string | null },
): Promise<FinmodelState> {
  const answers = await loadSurveyAnswers(sb, input.userId)
  if (!input.companyId) return mergeFinmodel({ rows: [], survey: {}, template: 'default' })
  const template = templateKeyFor(await industryOf(sb, input.companyId))
  return loadFinmodel(sb, { companyId: input.companyId, template, pb: { answers } })
}

// ─── request body ───────────────────────────────────────────────────────────

export const MAX_VALUES_PER_REQUEST = 20

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export type ParsedValues = { ok: true; values: FinmodelInputValue[] } | { ok: false; response: NextResponse }

export const fail = (error: string, status: number, extra: Record<string, unknown> = {}): NextResponse =>
  NextResponse.json({ ok: false, error, ...extra }, { status })

/**
 * `{ values: [{ key, value, asOf?, period?, note? }] }` → entries. The shape is checked here (an array of
 * 1..20 objects); keys, ranges, dates and the note are checked by the store, which names the field.
 */
export function parseValuesBody(raw: unknown): ParsedValues {
  if (!isObj(raw) || !Array.isArray(raw.values) || raw.values.length === 0) {
    return { ok: false, response: fail('Передайте хотя бы одно значение финмодели', 400, { code: 'invalid_request' }) }
  }
  if (raw.values.length > MAX_VALUES_PER_REQUEST) {
    return { ok: false, response: fail(`За один запрос можно сохранить не больше ${MAX_VALUES_PER_REQUEST} значений`, 400, { code: 'invalid_request' }) }
  }
  const values: FinmodelInputValue[] = []
  for (const item of raw.values) {
    if (!isObj(item) || typeof item.key !== 'string') {
      return { ok: false, response: fail('Значение финмодели указано неверно', 400, { code: 'invalid_request' }) }
    }
    values.push({
      key: item.key as FinmodelKey,
      value: item.value as number,
      asOf: item.asOf as string | null | undefined,
      period: item.period as string | null | undefined,
      note: item.note as string | null | undefined,
    })
  }
  return { ok: true, values }
}

/** An error of the finmodel domain as an answer; null for anything else (the caller answers 500). */
export function finmodelFailure(err: unknown): NextResponse | null {
  if (err instanceof ProfanityError) return fail(PROFANITY_MESSAGE, 400, { code: 'profanity', field: err.field })
  if (err instanceof FinmodelError) return fail(err.message, 400, { code: err.code, ...(err.field ? { field: err.field } : {}) })
  return null
}
