/**
 * lib/survey/calcs/team.ts — team calculations under the fields (spec
 * 2026-10-23 §9.2): owner_hours, staff_count.
 */
import { unwrapAnswer } from '@/lib/survey/answer-value'
import { parseNumber } from '@/lib/metrics/numbers'
import {
  combine, hasAnyInput, inputLabel, isNum, needs, readAmount, show, sourceOf, uniq, type Answers, type Num,
} from './inputs'
import { count, plain } from './fmt'
import type { CalcContext, CalcResult } from './types'

// ─── owner_hours ────────────────────────────────────────────────────────────

const HOURS_KEYS = ['s10_hours_on_ops', 's4m_hours_on_ops'] as const
const WORK_DAYS = 22

const validHours = (r: ReturnType<typeof readAmount>): r is Num => isNum(r) && r.v > 0 && r.v <= 24 && r.lo >= 0 && r.hi <= 24

export function ownerHours(answers: Answers, ctx: CalcContext = {}): CalcResult | null {
  if (!hasAnyInput(answers, HOURS_KEYS)) return null
  const title = 'Время на операционку'
  const how = `Часов в день × ${WORK_DAYS} рабочих дня в месяц.`
  // Under a field — that field's answer; elsewhere — step 10, else step 4.
  const order = ctx.key === 's4m_hours_on_ops' ? ['s4m_hours_on_ops', 's10_hours_on_ops'] : HOURS_KEYS
  const key = order.find((k) => validHours(readAmount(answers, k))) ?? null
  if (!key) {
    const asked = (HOURS_KEYS as readonly string[]).includes(ctx.key ?? '') ? (ctx.key as string) : order[0]
    return needs('owner_hours', title, [`${inputLabel(asked)} (от 0 до 24)`], [], how)
  }
  const h = readAmount(answers, key) as Num
  const month = combine([h], ([x]) => x * WORK_DAYS)!
  const lines = [`${show(month, count, '≈ ')} ч в месяц на операционку (${plain(h.v)} ч × ${WORK_DAYS} рабочих дня).`]
  const sources = [sourceOf(key)]
  const otherKey = key === 's10_hours_on_ops' ? 's4m_hours_on_ops' : 's10_hours_on_ops'
  const other = readAmount(answers, otherKey)
  if (validHours(other) && Math.abs(other.v - h.v) >= 1) {
    const s4 = key === 's4m_hours_on_ops' ? h : other
    const s10 = key === 's10_hours_on_ops' ? h : other
    lines.push(`На шаге 4 вы указали ${plain(s4.v)} ч в день, на шаге 10 — ${plain(s10.v)} ч. Какая цифра точнее?`)
    sources.push(sourceOf(otherKey))
  }
  return { id: 'owner_hours', title, lines, approx: month.approx, missing: [], sources: uniq(sources), how }
}

// ─── staff_count ────────────────────────────────────────────────────────────

/** Σ «Кол-во менеджеров» of the staffing table rows (blank / non-numeric cells skipped). */
function staffingSum(raw: unknown): { people: number; depts: number } | null {
  const rows = unwrapAnswer(raw)
  if (!Array.isArray(rows)) return null
  let people = 0
  let depts = 0
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue
    const p = parseNumber((r as Record<string, unknown>).manager_count)
    if (!p || p.percent || p.value <= 0) continue
    people += p.value
    depts++
  }
  return depts > 0 ? { people, depts } : null
}

export function staffCount(answers: Answers): CalcResult | null {
  if (!hasAnyInput(answers, ['s4n_staffing_table'])) return null
  const title = 'Люди по отделам'
  const how = 'Сумма колонки «Кол-во менеджеров» штатного расписания сравнивается с ответом «Кол-во сотрудников» (шаг 1).'
  const sum = staffingSum(answers.s4n_staffing_table)
  if (!sum) return needs('staff_count', title, ['количество людей в отделах (штатное расписание)'], [], how)
  const emp = readAmount(answers, 's1_employee_count')
  const sources = [sourceOf('s4n_staffing_table')]
  const inTable = `${count(sum.people)} чел. в ${count(sum.depts)} ${sum.depts === 1 ? 'отделе' : 'отделах'}`
  if (!isNum(emp) || emp.v <= 0) {
    return {
      id: 'staff_count', title, lines: [`В штатном расписании ${inTable}.`], approx: false,
      missing: [inputLabel('s1_employee_count')], sources, how,
    }
  }
  sources.push(sourceOf('s1_employee_count'))
  const diff = Math.round(emp.v - sum.people)
  let line: string
  if (diff === 0) line = `Сходится: в штатном расписании ${inTable}, сотрудников — ${count(emp.v)}.`
  else if (diff > 0) line = `В штатном расписании ${inTable}, а сотрудников вы указали ${count(emp.v)}. Остальные ${count(diff)} — вне отделов (собственник, помощники) или таблица заполнена не полностью?`
  else line = `В штатном расписании ${inTable} — больше, чем сотрудников (${count(emp.v)}). Кто-то совмещает отделы или где-то опечатка?`
  return { id: 'staff_count', title, lines: [line], approx: emp.approx, missing: [], sources, how }
}
