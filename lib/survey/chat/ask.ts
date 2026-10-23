/**
 * lib/survey/chat/ask.ts — what the helper SAYS without the model (spec §8.2,
 * §8.5): the question in plain words, «Объясни вопрос», «Где взять цифру?»,
 * the value on a card. The only knowledge sources are the registry
 * (lib/survey/questions.ts), the terms (lib/survey/terms.ts), the step «зачем»
 * (STEPS) and «где взять» (lib/survey/where-to-find.ts): the helper never
 * invents data sources or business advice. Pure and browser-safe.
 */
import { STEPS } from '@/components/onboarding/constants/step-config'
import { formatMarkedAnswer, groupThousands, isMarkedAnswer } from '../answer-value'
import { optionLabel, type SurveyQuestion } from '../questions'
import { SURVEY_TERMS } from '../terms'
import { whereToFindFor } from '../where-to-find'
import type { ChatQuestionDTO } from './types'

/** The first line of every conversation (spec §8.1). */
export const CHAT_HONEST_LINE =
  'Я помощник анкеты. Помогу ответить и объясню вопросы. В анкету записываю только то, что вы подтвердите. Переписку видит ваш эксперт.'

/** §8.5: no «где взять» for the key yet. */
export const NO_WHERE_TO_FIND =
  'Подсказки по этому вопросу пока нет — можно ответить примерно или «не знаю», эксперт поможет.'

const MAX_OPTIONS_LISTED = 12

/** «(в тенге в месяц)», «(в процентах)», «(чел.)». */
export function unitHint(q: Pick<SurveyQuestion, 'unit' | 'type'>): string {
  switch (q.unit) {
    case '₸/мес': return 'в тенге в месяц'
    case '₸/год': return 'в тенге за год'
    case '₸': return 'в тенге'
    case '%': return 'в процентах'
    case undefined: return ''
    default: return q.unit
  }
}

function optionsLine(q: SurveyQuestion): string | null {
  if (!q.options?.length) return null
  const list = q.options.slice(0, MAX_OPTIONS_LISTED).map((o) => o.label).join(', ')
  const more = q.options.length > MAX_OPTIONS_LISTED ? ' и др.' : ''
  return q.type === 'multiselect' ? `Можно несколько: ${list}${more}.` : `Варианты: ${list}${more}.`
}

/** «Зачем»: the field note, else the step's «зачем спрашиваем». */
export function whyLine(q: SurveyQuestion): string | null {
  if (q.why) return q.why
  const step = STEPS.find((s) => s.n === q.step)
  return step?.why?.ask ? `Зачем спрашиваем: ${step.why.ask}.` : null
}

/** The question as the chat asks it (a template, never the model). */
export function askText(q: SurveyQuestion, opts: { stored?: string | null; storedByStaff?: string | null } = {}): string {
  const head = (q.plain ?? q.label).trim()
  const unit = unitHint(q)
  const lines = [unit && !head.includes(unit) ? `${head} (${unit})` : head]
  const opt = optionsLine(q)
  if (opt) lines.push(opt)
  if (q.type === 'bool') lines.push('Ответьте «да» или «нет».')
  if (q.type === 'scale' && q.range) lines.push(`Оценка от ${q.range[0]} до ${q.range[1]}.`)
  if (q.allowUnknown || q.allowApprox) lines.push('Можно примерно или «не знаю».')
  if (opts.stored) {
    lines.push(opts.storedByStaff
      ? `Сейчас записано: ${opts.stored} (изменил ${opts.storedByStaff}). Обновить?`
      : `Сейчас записано: ${opts.stored}. Обновить?`)
  }
  return lines.join('\n')
}

/** «Объясни вопрос» — the registry only. */
export function explainText(q: SurveyQuestion): string {
  const lines = [`Вопрос «${q.label}».`]
  if (q.plain && q.plain !== q.label) lines.push(`Проще говоря: ${q.plain}`)
  if (q.term) lines.push(`${q.term} — ${SURVEY_TERMS[q.term]}`)
  const why = whyLine(q)
  if (why) lines.push(why)
  const unit = unitHint(q)
  if (unit) lines.push(`Ответ — число ${unit}.`)
  const opt = optionsLine(q)
  if (opt) lines.push(opt)
  const where = whereToFindFor(q.key)
  if (where?.example) lines.push(`Пример: ${where.example}`)
  lines.push('Ответьте своими словами — я приведу ответ к формату анкеты и покажу перед записью.')
  return lines.join('\n')
}

/** «Где взять цифру?» — lib/survey/where-to-find.ts only. */
export function whereText(q: SurveyQuestion): string {
  const w = whereToFindFor(q.key)
  if (!w) return NO_WHERE_TO_FIND
  const lines = [w.short, w.how]
  if (w.sources.length) lines.push(`Где посмотреть:\n${w.sources.map((s) => `• ${s}`).join('\n')}`)
  if (w.ifUnknown) lines.push(w.ifUnknown)
  return lines.filter(Boolean).join('\n')
}

/** One line «где взять» for the «не знаю» card. */
export function whereLine(q: SurveyQuestion): string | null {
  return whereToFindFor(q.key)?.short ?? null
}

/** A stored or proposed value as the card shows it. */
export function formatChatValue(q: SurveyQuestion, value: unknown): string {
  const unit = q.unit === '%' ? '%' : q.unit?.startsWith('₸') ? '₸' : q.unit ?? ''
  if (isMarkedAnswer(value)) return formatMarkedAnswer(value, unit) ?? '—'
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет'
  if (typeof value === 'number') {
    const n = groupThousands(value)
    if (unit === '%') return `${n}%`
    return unit ? `${n} ${unit}` : n
  }
  if (Array.isArray(value)) return value.map((v) => optionLabel(q, String(v))).join(', ') || '—'
  if (typeof value === 'string') return q.options ? optionLabel(q, value) : value
  try { return JSON.stringify(value) } catch { return '—' }
}

/** The side panel's view of a question. */
export function questionDTO(q: SurveyQuestion): ChatQuestionDTO {
  return {
    key: q.key,
    label: q.label,
    plain: q.plain ?? null,
    why: whyLine(q),
    term: q.term ? { name: q.term, text: SURVEY_TERMS[q.term] } : null,
    step: q.step,
    block: q.place,
    type: q.type,
    unit: q.unit ?? null,
    options: q.options ? q.options.map((o) => ({ value: o.value, label: o.label })) : null,
    allowUnknown: q.allowUnknown,
    allowApprox: q.allowApprox,
  }
}
