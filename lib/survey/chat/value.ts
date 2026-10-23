/**
 * lib/survey/chat/value.ts — the SERVER builds the answer from the model's
 * literals (spec §8.2): numbers from `numbers` through the guard (scale and
 * period recomputed here), a choice only from the registry's options, yes/no,
 * free text = the client's own words as they are. Then the envelope is checked
 * by the same schema the questionnaire save uses. Pure and browser-safe.
 */
import { hasProfanity } from '@/lib/moderation/profanity'
import { approxAnswer, unknownAnswer } from '../answer-value'
import type { SurveyQuestion } from '../questions'
import { parseSurveySaveBody } from '../schema'
import { formatChatValue } from './ask'
import { clientSaidNegative, groundNumber, type GuardFailure } from './guard'
import type { BuiltProposal, ChatIntent, ModelTurn } from './types'

export type BuildFailure =
  | { reason: 'number_guard'; detail: GuardFailure; raw: string }
  | { reason: 'no_value' }
  | { reason: 'need_single' }
  | { reason: 'out_of_range' }
  | { reason: 'bad_option' }
  | { reason: 'profanity' }
  | { reason: 'invalid' }

export type BuildResult = { ok: true; proposal: BuiltProposal } | ({ ok: false } & BuildFailure)

const QUOTE_MAX = 300
const TEXT_MAX = 4000

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

function quoteOf(texts: readonly string[]): string {
  return cut(texts.map((t) => t.trim()).filter(Boolean).join(' / '), QUOTE_MAX)
}

/** The envelope passes the questionnaire save schema (`.strict()` envelope, marks, size). */
export function isValidEnvelope(q: Pick<SurveyQuestion, 'key' | 'step'>, envelope: Record<string, unknown>): boolean {
  return parseSurveySaveBody({ step: Math.min(12, Math.max(1, q.step)), answers: { [q.key]: envelope } }).ok
}

function numericRange(q: SurveyQuestion): [number, number] | null {
  if (q.range) return [q.range[0], q.range[1]]
  if (q.type === 'percent') return q.allowNegative ? [-100, 100] : [0, 100]
  return null
}

function checkNumber(q: SurveyQuestion, n: number): number | null {
  if (!Number.isFinite(n)) return null
  let v = n
  if (q.integer && !Number.isInteger(v)) {
    // Money: whole tenge; a count with decimals is a misunderstanding.
    if (q.type === 'money' || q.type === 'auto') v = Math.round(v)
    else return null
  }
  if (v < 0 && !q.allowNegative) return null
  const range = numericRange(q)
  if (range && (v < range[0] || v > range[1])) return null
  return v
}

function done(q: SurveyQuestion, envelope: Record<string, unknown>, texts: readonly string[], note?: string): BuildResult {
  if (!isValidEnvelope(q, envelope)) return { ok: false, reason: 'invalid' }
  const value = envelope.unknown || envelope.approx ? envelope : envelope.value
  const proposal: BuiltProposal = { key: q.key, envelope, display: formatChatValue(q, value), quote: quoteOf(texts) }
  if (note) proposal.note = note
  return { ok: true, proposal }
}

function buildNumeric(q: SurveyQuestion, model: ModelTurn, intent: ChatIntent, texts: readonly string[]): BuildResult {
  if (!model.numbers.length) return { ok: false, reason: 'no_value' }
  const grounded: number[] = []
  const notes: string[] = []
  for (const lit of model.numbers.slice(0, 2)) {
    const g = groundNumber(lit, q, texts)
    if (!g.ok) return { ok: false, reason: 'number_guard', detail: g.reason, raw: lit.raw }
    grounded.push(g.number.value)
    if (g.number.note) notes.push(g.number.note)
  }
  const negative = q.allowNegative && model.numbers.some((l) => /^\s*[-−]/.test(l.raw)) && clientSaidNegative(texts)
  const signed = grounded.map((v) => (negative ? -Math.abs(v) : v))
  const checked = signed.map((v) => checkNumber(q, v))
  if (checked.some((v) => v === null)) return { ok: false, reason: 'out_of_range' }
  const values = checked as number[]
  const note = notes[0]
  const approx = intent === 'approx' || values.length > 1
  if (approx && q.allowApprox && values.every((v) => v >= 0)) {
    const [a, b] = values.length > 1 ? values : [values[0], values[0]]
    return done(q, approxAnswer(a, b) as unknown as Record<string, unknown>, texts, note)
  }
  if (values.length > 1) return { ok: false, reason: 'need_single' }
  return done(q, { value: values[0] }, texts, note)
}

const norm = (s: string) => s.trim().toLowerCase().replace(/ё/g, 'е')

/** A model option → a registry option value (by value or label); null when not one of them. */
export function matchOption(q: SurveyQuestion, raw: string): string | null {
  const n = norm(raw)
  if (!n) return null
  const hit = q.options?.find((o) => norm(o.value) === n || norm(o.label) === n)
  return hit ? hit.value : null
}

/**
 * The card value of one client turn. `texts` are the client's messages about
 * this question (the guard reads them; free text is taken from them verbatim).
 */
export function buildProposal(q: SurveyQuestion, model: ModelTurn, texts: readonly string[]): BuildResult {
  const intent = model.intent
  if (intent === 'unknown') return done(q, unknownAnswer() as unknown as Record<string, unknown>, texts)

  switch (q.type) {
    case 'number':
    case 'money':
    case 'percent':
    case 'scale':
    case 'auto':
      return buildNumeric(q, model, intent, texts)
    case 'select': {
      const values = [...new Set(model.options.map((o) => matchOption(q, o)))]
      if (values.some((v) => v === null)) return { ok: false, reason: 'bad_option' }
      if (values.length !== 1) return { ok: false, reason: values.length ? 'need_single' : 'no_value' }
      return done(q, { value: values[0] }, texts)
    }
    case 'multiselect': {
      const values = [...new Set(model.options.map((o) => matchOption(q, o)).filter((v): v is string => v !== null))]
      if (!values.length) return { ok: false, reason: model.options.length ? 'bad_option' : 'no_value' }
      return done(q, { value: values }, texts)
    }
    case 'bool':
      if (typeof model.bool !== 'boolean') return { ok: false, reason: 'no_value' }
      return done(q, { value: model.bool }, texts)
    case 'text':
    case 'longtext': {
      // The client's words as they are (spec §8.2) — never the model's paraphrase.
      const words = texts.map((t) => t.trim()).filter(Boolean).join('\n')
      if (!words) return { ok: false, reason: 'no_value' }
      if (hasProfanity(words)) return { ok: false, reason: 'profanity' }
      return done(q, { value: cut(words, TEXT_MAX) }, texts)
    }
    default:
      return { ok: false, reason: 'no_value' }
  }
}

/** «Исправить»: the client typed the value into the card field — same schema, no number guard (their own input). */
export function editedEnvelope(q: SurveyQuestion, edited: unknown): Record<string, unknown> | null {
  if (edited === null || edited === undefined) return null
  let envelope: Record<string, unknown>
  if (typeof edited === 'object' && !Array.isArray(edited) && ('value' in (edited as object))) envelope = { ...(edited as Record<string, unknown>) }
  else envelope = { value: edited }
  const v = envelope.value
  if (!envelope.unknown && !envelope.approx) {
    switch (q.type) {
      case 'number': case 'money': case 'percent': case 'scale': {
        const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.replace(/[\s  ]/g, '').replace(',', '.')) : NaN
        const checked = checkNumber(q, n)
        if (checked === null) return null
        envelope.value = checked
        break
      }
      case 'select':
        if (typeof v !== 'string' || matchOption(q, v) === null) return null
        envelope.value = matchOption(q, v)
        break
      case 'multiselect':
        if (!Array.isArray(v) || !v.length || v.some((x) => typeof x !== 'string' || matchOption(q, x) === null)) return null
        envelope.value = [...new Set(v.map((x) => matchOption(q, String(x)) as string))]
        break
      case 'bool':
        if (typeof v !== 'boolean') return null
        break
      case 'text': case 'longtext':
        if (typeof v !== 'string' || !v.trim() || v.length > TEXT_MAX || hasProfanity(v)) return null
        envelope.value = v.trim()
        break
      default:
        return null
    }
  }
  return isValidEnvelope(q, envelope) ? envelope : null
}
