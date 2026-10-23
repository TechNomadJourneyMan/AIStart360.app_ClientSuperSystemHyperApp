/**
 * lib/survey/answers-view.ts — the logic of «Мои ответы» and of the staff
 * questionnaire view (spec 2026-10-23 §6.2–§6.5): every question of the
 * registry with its answer in human form, the author line, groups by step or
 * by mode-2 block, filters, search, the summary. Pure and browser-safe; the
 * component (components/onboarding/answers/SurveyAnswersView.tsx) only renders.
 */
import { SURVEY_STEP_LABELS, formatSurveyValue } from '@/lib/survey-labels'
import { stripMarkdown } from './markdown'
import { formatMarkedAnswer, groupThousands, isApproxAnswer, isUnknownAnswer } from './answer-value'
import { isAnswerFilled } from './answer-filled'
import { computePointAMinimum, type PointAMinimum } from './point-a-minimum'
import { stepForQuestionKey } from './steps'
import { formatAttribution, formatAuthorSummary, summarizeAuthors, type AnswerAttribution, type AttributionViewer, type AuthorSummary } from './attribution-label'
import { EXPRESS_SCREENS, SURVEY_BLOCKS, SURVEY_QUESTION_LIST, optionLabel, type SurveyQuestion } from './questions'

export const ANSWER_FILTERS = ['empty', 'unsure', 'assistant', 'staff', 'minimum'] as const
export type AnswerFilter = (typeof ANSWER_FILTERS)[number]

export const ANSWER_FILTER_LABELS: Readonly<Record<AnswerFilter, string>> = {
  empty: 'Пустые',
  unsure: '«Не знаю» и «примерно»',
  assistant: 'ИИ-помощник и документы',
  staff: 'Изменено экспертом',
  minimum: 'Минимум для Точки А',
}

export function isAnswerFilter(v: unknown): v is AnswerFilter {
  return typeof v === 'string' && (ANSWER_FILTERS as readonly string[]).includes(v)
}

export type AnswersGrouping = 'steps' | 'blocks'

/** How the answer is edited in place (spec §6.3). */
export type EditKind = 'inline' | 'modal' | 'form' | 'none'

export interface AnswerItem {
  question: SurveyQuestion
  value: unknown
  filled: boolean
  unknown: boolean
  approx: boolean
  /** The answer in human words («Не знаю», «≈ 5 500 000 ₸/мес (5 000 000 – 6 000 000 ₸/мес)», chip labels …). */
  display: string
  attribution: AnswerAttribution | null
  /** The author line, or null (no author recorded). */
  authorLine: string | null
  edit: EditKind
}

export interface AnswerGroup {
  id: string
  title: string
  items: AnswerItem[]
  answered: number
  total: number
}

const TABLE_ROWS_LABEL = (n: number) => {
  const m10 = n % 10
  const m100 = n % 100
  const word = m10 === 1 && m100 !== 11 ? 'строка' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'строки' : 'строк'
  return `${n} ${word}`
}

const isRow = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Rows of a table answer with at least one real cell (the prefilled template is not counted). */
export function filledTableRows(value: unknown): number {
  if (!Array.isArray(value)) return 0
  return value.filter((r) => isRow(r) && isAnswerFilled([r])).length
}

/** The answer of a question in human words (no answer → «Нет ответа»). */
export function displayAnswer(q: SurveyQuestion, value: unknown): string {
  if (!isAnswerFilled(value)) return 'Нет ответа'
  const marked = formatMarkedAnswer(value, q.unit ?? '')
  if (marked) return marked
  switch (q.type) {
    case 'select':
      return optionLabel(q, String(value))
    case 'multiselect':
      return Array.isArray(value) ? value.map((v) => optionLabel(q, String(v))).join(', ') : String(value)
    case 'bool':
      return value === true ? 'Да' : value === false ? 'Нет' : String(value)
    case 'scale':
      return typeof value === 'number' ? `${value} из ${q.range?.[1] ?? 10}` : String(value)
    case 'number':
    case 'money':
    case 'percent':
    case 'auto': {
      if (typeof value !== 'number') return typeof value === 'string' ? value : formatSurveyValue(q.key, value)
      const unit = q.unit ? (q.unit === '%' ? '%' : ` ${q.unit}`) : ''
      return `${groupThousands(value)}${unit}`
    }
    case 'table': {
      const n = filledTableRows(value)
      return n ? `${TABLE_ROWS_LABEL(n)} · ${formatSurveyValue(q.key, value)}` : 'Нет ответа'
    }
    case 'file':
      return formatSurveyValue(q.key, value)
    default:
      return typeof value === 'string' ? stripMarkdown(value) : formatSurveyValue(q.key, value)
  }
}

/** Short types are edited in place, long text in the Markdown editor, tables and files in the form. */
export function editKindOf(q: SurveyQuestion): EditKind {
  if (q.auto) return 'none'
  if (q.type === 'table' || q.type === 'file') return 'form'
  if (q.type === 'longtext') return 'modal'
  return 'inline'
}

/** Every question of the registry with its answer, in the order of the full questionnaire. */
export function buildAnswerItems(
  answers: Readonly<Record<string, unknown>>,
  attribution: Readonly<Record<string, AnswerAttribution | undefined>> = {},
  viewer: AttributionViewer = {},
): AnswerItem[] {
  return SURVEY_QUESTION_LIST.map((q) => {
    const value = answers[q.key]
    const filled = isAnswerFilled(value)
    const a = filled ? attribution[q.key] ?? null : null
    return {
      question: q,
      value,
      filled,
      unknown: isUnknownAnswer(value),
      approx: isApproxAnswer(value),
      display: displayAnswer(q, value),
      attribution: a,
      authorLine: a ? formatAttribution(a, viewer) : null,
      edit: editKindOf(q),
    }
  })
}

function matchesFilter(item: AnswerItem, f: AnswerFilter): boolean {
  switch (f) {
    case 'empty':
      return !item.filled && !item.question.auto
    case 'unsure':
      return item.unknown || item.approx
    case 'assistant': {
      const a = item.attribution
      return !!a && (a.updatedByRole === 'ai' || a.updatedVia === 'chat' || a.updatedVia === 'helper' || a.updatedVia === 'document')
    }
    case 'staff':
      return item.attribution?.updatedByRole === 'expert' || item.attribution?.updatedByRole === 'admin'
    case 'minimum':
      return item.question.minimum.length > 0
  }
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()

/** Text a search looks in: labels, the plain question, the answer. */
function haystack(item: AnswerItem): string {
  const q = item.question
  return norm([q.label, q.formLabel ?? '', q.plain ?? '', item.filled ? item.display : ''].join(' \n '))
}

/**
 * Items that pass the filters (several chips = any of them; none = all) and
 * the search (every word must be found). The auto keys («год = месяц × 12»)
 * stay visible next to their month unless a filter excludes them.
 */
export function filterAnswerItems(items: readonly AnswerItem[], filters: Iterable<AnswerFilter>, search = ''): AnswerItem[] {
  const fs = Array.from(new Set(filters))
  const words = norm(search).split(' ').filter(Boolean)
  return items.filter((item) => {
    if (fs.length && !fs.some((f) => matchesFilter(item, f))) return false
    if (!words.length) return true
    const h = haystack(item)
    return words.every((w) => h.includes(w))
  })
}

/** Groups by the 12 steps of the full questionnaire, or by express + 15 blocks (mode 2). */
export function groupAnswerItems(items: readonly AnswerItem[], grouping: AnswersGrouping = 'steps'): AnswerGroup[] {
  const groups: AnswerGroup[] = []
  const push = (id: string, title: string, list: AnswerItem[]) => {
    if (!list.length) return
    const counted = list.filter((i) => !i.question.auto)
    groups.push({ id, title, items: list, answered: counted.filter((i) => i.filled).length, total: counted.length })
  }
  if (grouping === 'steps') {
    for (let step = 1; step <= 12; step++) {
      push(`step-${step}`, `${step}. ${SURVEY_STEP_LABELS[step] ?? `Шаг ${step}`}`, items.filter((i) => i.question.step === step))
    }
    return groups
  }
  const byKey = new Map(items.map((i) => [i.question.key, i]))
  const pick = (keys: readonly string[]) => keys.map((k) => byKey.get(k)).filter((i): i is AnswerItem => !!i)
  push('express', 'Быстрый старт', pick(EXPRESS_SCREENS.flatMap((s) => s.keys)))
  SURVEY_BLOCKS.forEach((b, i) => push(b.id, `Б${i + 1}. ${b.title}`, pick(b.keys)))
  return groups
}

export interface AnswersSummary {
  /** Answered questions (auto keys excluded) / all questions. */
  answered: number
  total: number
  /** «Глубина», %. */
  depth: number
  unknown: number
  approx: number
  minimum: PointAMinimum
  authors: AuthorSummary
}

export function answersSummary(items: readonly AnswerItem[], answers: Readonly<Record<string, unknown>>): AnswersSummary {
  const counted = items.filter((i) => !i.question.auto)
  const answeredItems = counted.filter((i) => i.filled)
  const attribution: Record<string, AnswerAttribution | undefined> = {}
  for (const i of answeredItems) attribution[i.question.key] = i.attribution ?? undefined
  return {
    answered: answeredItems.length,
    total: counted.length,
    depth: counted.length ? Math.round((answeredItems.length / counted.length) * 100) : 0,
    unknown: counted.filter((i) => i.unknown).length,
    approx: counted.filter((i) => i.approx).length,
    minimum: computePointAMinimum(answers, (k) => stepForQuestionKey(k)),
    authors: summarizeAuthors(answeredItems.map((i) => i.question.key), attribution),
  }
}

/** Deep link into the full questionnaire for tables and files («Открыть в анкете»). */
export function formHref(q: Pick<SurveyQuestion, 'step' | 'key'>): string {
  return `/client/onboarding?step=${q.step}#${q.key}`
}

/** Filters from a query string (`?filter=staff,empty`); unknown values are dropped. */
export function parseAnswerFilters(raw: string | null | undefined): AnswerFilter[] {
  if (!raw) return []
  return raw.split(',').map((s) => s.trim()).filter(isAnswerFilter)
}

export interface SurveyPrintSection {
  title: string
  rows: Array<{ label: string; value: string; author: string | null }>
}

/**
 * The questionnaire for paper / PDF (spec §6.4): answered questions by step,
 * each with its author and path, and the «кто заполнял» line on top.
 */
export function surveyPrintModel(
  answers: Readonly<Record<string, unknown>>,
  attribution: Readonly<Record<string, AnswerAttribution | undefined>>,
  viewer: AttributionViewer = { viewerIsOwner: true },
): { summary: string; answered: number; total: number; sections: SurveyPrintSection[] } {
  const items = buildAnswerItems(answers, attribution, viewer)
  const summary = answersSummary(items, answers)
  const sections = groupAnswerItems(items.filter((i) => i.filled), 'steps').map((g) => ({
    title: g.title,
    rows: g.items.map((i) => ({ label: i.question.label, value: i.display, author: i.authorLine })),
  }))
  return {
    summary: `Кто заполнял: ${formatAuthorSummary(summary.authors, viewer)}`,
    answered: summary.answered,
    total: summary.total,
    sections,
  }
}
