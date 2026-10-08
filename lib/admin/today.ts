/**
 * «Мой день» — чистые функции без обращений к БД (их удобно тестировать).
 *
 *  - bucketTasks     — задачи сотрудника: просрочено / сегодня / 7 дней;
 *  - groupCases      — открытые кейсы по приоритету;
 *  - summarizeChanges — что изменилось у клиента с последнего просмотра,
 *    детерминированно, без LLM: «Анкета: 3 ответа изменены · GRI: новый
 *    замер 6.1 (+0.4)».
 */

export const DAY_MS = 86_400_000

/** Русская форма по числу: plural(3, ['ответ', 'ответа', 'ответов']) → 'ответа'. */
export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return forms[2]
  if (b > 1 && b < 5) return forms[1]
  if (b === 1) return forms[0]
  return forms[2]
}

/**
 * Начало «сегодня» в часовом поясе сотрудника. `tzOffsetMin` — как у
 * Date#getTimezoneOffset (для UTC+5 это −300).
 */
export function startOfLocalDay(now: number, tzOffsetMin: number): number {
  const local = now - tzOffsetMin * 60_000
  const dayStartLocal = Math.floor(local / DAY_MS) * DAY_MS
  return dayStartLocal + tzOffsetMin * 60_000
}

export interface TaskLike { id: string; due_at: string | null; status: string }

export interface TaskBuckets<T> { overdue: T[]; today: T[]; week: T[]; later: T[]; noDate: T[] }

export function bucketTasks<T extends TaskLike>(tasks: T[], now: number, tzOffsetMin: number): TaskBuckets<T> {
  const dayStart = startOfLocalDay(now, tzOffsetMin)
  const tomorrow = dayStart + DAY_MS
  const weekEnd = dayStart + 8 * DAY_MS
  const out: TaskBuckets<T> = { overdue: [], today: [], week: [], later: [], noDate: [] }
  for (const t of tasks) {
    if (t.status !== 'open') continue
    if (!t.due_at) { out.noDate.push(t); continue }
    const due = Date.parse(t.due_at)
    if (!Number.isFinite(due)) { out.noDate.push(t); continue }
    if (due < now) out.overdue.push(t)
    else if (due < tomorrow) out.today.push(t)
    else if (due < weekEnd) out.week.push(t)
    else out.later.push(t)
  }
  const byDue = (a: T, b: T) => String(a.due_at).localeCompare(String(b.due_at))
  out.overdue.sort(byDue)
  out.today.sort(byDue)
  out.week.sort(byDue)
  out.later.sort(byDue)
  return out
}

export const CASE_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const
export type CasePriority = (typeof CASE_PRIORITIES)[number]

export function groupCases<T extends { priority: string; created_at: string }>(cases: T[]): Array<{ priority: CasePriority; items: T[] }> {
  return CASE_PRIORITIES.map((priority) => ({
    priority,
    // Внутри приоритета — сначала самые старые: они ждут дольше всех.
    items: cases.filter((c) => c.priority === priority).sort((a, b) => a.created_at.localeCompare(b.created_at)),
  })).filter((g) => g.items.length > 0)
}

export interface SurveyChange { question_key: string; created_at: string; changed_by: string | null }
export interface GriPoint { gri_index: number; created_at: string }
export interface DiagPoint { overall_score: number | null; calculated_at: string }
export interface DocPoint { file_name: string | null; uploaded_at: string }

export interface ClientChangeSummary {
  lines: string[]
  changedAt: string | null
  counts: { survey: number; gri: number; pointA: number; documents: number }
}

const fmt1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1)
const signed = (n: number, digits = 1) => {
  const r = Math.round(n * 10 ** digits) / 10 ** digits
  return `${r > 0 ? '+' : r < 0 ? '−' : '±'}${Math.abs(r).toFixed(digits)}`
}

/**
 * Что изменилось у клиента после `since`.
 *
 * `gri` и `diag` — ВСЯ история клиента (любой порядок): прирост считается к
 * последнему значению ДО изменений, иначе «+0.4» было бы не с чем сравнить.
 * Правки анкеты, сделанные самим сотрудником (`selfId`), новостью не считаются.
 */
export function summarizeChanges(input: {
  since: string
  selfId?: string | null
  survey: SurveyChange[]
  gri: GriPoint[]
  diag: DiagPoint[]
  docs: DocPoint[]
}): ClientChangeSummary {
  const since = input.since
  const after = (at: string | null | undefined) => !!at && at > since
  const lines: string[] = []
  let changedAt: string | null = null
  const touch = (at: string) => { if (!changedAt || at > changedAt) changedAt = at }

  const surveyNew = input.survey.filter((s) => after(s.created_at) && (!input.selfId || s.changed_by !== input.selfId))
  const surveyKeys = new Set(surveyNew.map((s) => s.question_key))
  if (surveyKeys.size) {
    lines.push(`Анкета: ${surveyKeys.size} ${plural(surveyKeys.size, ['ответ изменён', 'ответа изменены', 'ответов изменено'])}`)
    surveyNew.forEach((s) => touch(s.created_at))
  }

  const gri = [...input.gri].sort((a, b) => a.created_at.localeCompare(b.created_at))
  const griNew = gri.filter((g) => after(g.created_at))
  if (griNew.length) {
    const last = griNew[griNew.length - 1]
    const before = gri.filter((g) => !after(g.created_at)).pop() ?? null
    const delta = before ? ` (${signed(Number(last.gri_index) - Number(before.gri_index))})` : ''
    const head = griNew.length === 1
      ? 'новый замер'
      : `${griNew.length} ${plural(griNew.length, ['новый замер', 'новых замера', 'новых замеров'])}, последний`
    lines.push(`GRI: ${head} ${fmt1(Number(last.gri_index))}${delta}`)
    touch(last.created_at)
  }

  const diag = [...input.diag].sort((a, b) => a.calculated_at.localeCompare(b.calculated_at))
  const diagNew = diag.filter((d) => after(d.calculated_at))
  if (diagNew.length) {
    const last = diagNew[diagNew.length - 1]
    const before = diag.filter((d) => !after(d.calculated_at)).pop() ?? null
    const score = last.overall_score == null ? null : Math.round(Number(last.overall_score))
    const delta = score != null && before?.overall_score != null ? ` (${signed(score - Math.round(Number(before.overall_score)), 0)})` : ''
    lines.push(`Точка А: ${before ? 'пересчитана' : 'рассчитана'}${score != null ? `, ${score}${delta}` : ''}`)
    touch(last.calculated_at)
  }

  const docsNew = input.docs.filter((d) => after(d.uploaded_at))
  if (docsNew.length) {
    lines.push(`Документы: ${docsNew.length} ${plural(docsNew.length, ['новый', 'новых', 'новых'])}`)
    docsNew.forEach((d) => touch(d.uploaded_at))
  }

  return {
    lines,
    changedAt,
    counts: { survey: surveyKeys.size, gri: griNew.length, pointA: diagNew.length, documents: docsNew.length },
  }
}
