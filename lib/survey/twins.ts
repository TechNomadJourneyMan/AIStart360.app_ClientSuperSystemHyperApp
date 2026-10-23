/**
 * lib/survey/twins.ts — twin questions (spec 2026-10-23 §7.6). PO: nothing is
 * removed, so a twin pair stays two fields (`twin` in lib/survey/questions.ts).
 * In the express flow and the blocks, reaching the second field of a pair
 * with the first one answered offers that answer: «Вы уже ответили на похожий
 * вопрос: 6 ч/день. Подходит и здесь? [Да] [Изменить]». It is written ONLY on
 * «Да» — never copied silently. Pure.
 */
import { isAnswerFilled } from './answer-filled'
import { formatMarkedAnswer, isMarkedAnswer } from './answer-value'
import { SURVEY_QUESTIONS, optionLabel } from './questions'

export interface TwinOffer {
  /** The empty field the offer is for. */
  key: string
  /** The answered twin. */
  from: string
  fromLabel: string
  value: unknown
  /** The value in words («6 ч/день»). */
  text: string
}

function valueText(key: string, v: unknown): string {
  const q = SURVEY_QUESTIONS[key]
  if (isMarkedAnswer(v)) return formatMarkedAnswer(v, q?.unit ?? '') ?? ''
  if (typeof v === 'number') return `${v.toLocaleString('ru-RU')}${q?.unit ? ` ${q.unit}` : ''}`
  if (typeof v === 'boolean') return v ? 'да' : 'нет'
  if (typeof v === 'string') return q ? optionLabel(q, v) : v
  if (Array.isArray(v)) return v.map((x) => (q ? optionLabel(q, String(x)) : String(x))).join(', ')
  return ''
}

/** The offer for `key`, or null (no twin, the field is answered, the twin is empty). */
export function twinOffer(key: string, answers: Readonly<Record<string, unknown>>): TwinOffer | null {
  const twin = SURVEY_QUESTIONS[key]?.twin
  if (!twin) return null
  if (isAnswerFilled(answers[key]) || typeof answers[key] === 'boolean') return null
  const value = answers[twin]
  if (!isAnswerFilled(value)) return null
  return { key, from: twin, fromLabel: SURVEY_QUESTIONS[twin]?.label ?? twin, value, text: valueText(twin, value) }
}
