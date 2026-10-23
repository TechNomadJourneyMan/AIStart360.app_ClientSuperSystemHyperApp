/**
 * lib/survey/snapshot.ts — «Снимок бизнеса» after the express flow (spec
 * 2026-10-23 §7.3). Only the owner's own numbers (PO decision 3: no industry
 * comparison); nothing is written anywhere. Pure, browser-safe.
 *
 *  1. five numbers: revenue per month; the 12-month goal and the monthly
 *     growth it needs; revenue per employee per year; margin («с 100 ₸
 *     остаётся X ₸»); the owner's hours on routine per month. Missing →
 *     «нет данных · ответить» (the express screen of that question);
 *  2. blind spots of the express questions («Вы не знаете 3 из 26 цифр …»).
 */
import { blindSpots } from './blind-spots'
import { combine, currentMonth, goalMonth, isNum, readAmount, readPercent, show, type Num } from './calcs/inputs'
import { money, plain } from './calcs/fmt'
import { EXPRESS_QUESTIONS } from './express'
import { SURVEY_QUESTIONS } from './questions'
import { computeGap } from '@/lib/point-b/engine'

/** Working days per month in «часы в месяц» (as the owner_hours calc). */
const WORKING_DAYS = 22

export interface SnapshotFigure {
  id: 'revenue' | 'goal' | 'per_employee' | 'margin' | 'hours'
  label: string
  /** The number in words; null → «нет данных». */
  value: string | null
  /** A second line (what it means / what it is computed from). */
  note?: string
  /** The question to answer when the value is missing. */
  askKey: string
  /** The owner answered «не знаю». */
  unknown: boolean
}

/** «С 100 ₸ остаётся 15 ₸ — ≈ 825 тыс. ₸ в месяц» (margin × revenue). */
export function marginMoney(answers: Readonly<Record<string, unknown>>): { line: string; note: string } | null {
  const margin = readPercent(answers, 's9n_net_margin')
  if (!isNum(margin)) return null
  const left = show(margin, (x) => `${plain(Math.round(x * 10) / 10)} ₸`)
  const cur = currentMonth(answers)
  if (!cur.num) return { line: `С каждых 100 ₸ выручки остаётся ${left}.`, note: 'Укажите выручку в месяц — посчитаем, сколько это в деньгах.' }
  const perMonth = combine([cur.num, margin], ([r, m]) => (r * m) / 100) as Num
  return {
    line: `С каждых 100 ₸ выручки остаётся ${left} — ${show(perMonth, money, '≈ ')} в месяц.`,
    note: 'из: выручка в месяц × чистая маржа',
  }
}

export function snapshotFigures(answers: Readonly<Record<string, unknown>>): SnapshotFigure[] {
  const cur = currentMonth(answers)
  const goal = goalMonth(answers, '12m')
  const people = readAmount(answers, 's1_employee_count')
  const hours = readAmount(answers, 's4m_hours_on_ops')
  const out: SnapshotFigure[] = []

  out.push({
    id: 'revenue', label: 'Выручка в месяц', askKey: 's1_current_revenue_month', unknown: cur.unknown,
    value: cur.num ? show(cur.num, money) : null,
    ...(cur.num ? { note: `≈ ${money(cur.num.v * 12)} в год` } : {}),
  })

  let goalValue: string | null = null
  let goalNote: string | undefined
  if (goal.num) {
    goalValue = show(goal.num, money)
    const gap = cur.num ? computeGap(cur.num.v * 12, goal.num.v * 12, 12) : null
    if (gap?.required_mom_growth != null) goalNote = `нужно +${plain(Math.round(gap.required_mom_growth * 10) / 10)} % каждый месяц`
    else if (!cur.num) goalNote = 'нужный рост посчитаем, когда будет выручка сейчас'
  }
  out.push({ id: 'goal', label: 'Цель через год (в месяц)', askKey: 's1_goal_12m_revenue_month', unknown: goal.unknown, value: goalValue, ...(goalNote ? { note: goalNote } : {}) })

  const perEmployee = cur.num && isNum(people) && people.v > 0 ? combine([cur.num, people], ([r, p]) => (r * 12) / p) : null
  out.push({
    id: 'per_employee', label: 'Выручка на сотрудника в год',
    askKey: !isNum(people) || people.v <= 0 ? 's1_employee_count' : 's1_current_revenue_month',
    unknown: people === 'unknown',
    value: perEmployee ? show(perEmployee, money) : null,
    ...(perEmployee && isNum(people) ? { note: `${plain(people.v)} чел. в команде` } : {}),
  })

  const margin = readPercent(answers, 's9n_net_margin')
  const net = isNum(margin) && cur.num ? combine([cur.num, margin], ([r, m]) => (r * m) / 100) : null
  out.push({
    id: 'margin', label: 'Маржа: с 100 ₸ остаётся', askKey: 's9n_net_margin', unknown: margin === 'unknown',
    value: isNum(margin) ? show(margin, (x) => `${plain(Math.round(x * 10) / 10)} ₸`) : null,
    ...(net ? { note: `${show(net, money, '≈ ')} чистыми в месяц` } : {}),
  })

  const monthHours = isNum(hours) ? combine([hours], ([h]) => h * WORKING_DAYS) : null
  out.push({
    id: 'hours', label: 'Ваши часы на текучку в месяц', askKey: 's4m_hours_on_ops', unknown: hours === 'unknown',
    value: monthHours ? show(monthHours, (x) => `${plain(Math.round(x))} ч`) : null,
    ...(monthHours && isNum(hours) ? { note: `${plain(hours.v)} ч/день × ${WORKING_DAYS} рабочих дня` } : {}),
  })
  return out
}

export interface ExpressBlindSpots {
  count: number
  total: number
  labels: string[]
  /** «Вы не знаете 3 из 26 цифр быстрого старта: маржу, цикл сделки… Это первое, что стоит начать считать.» */
  text: string | null
}

const lower = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s)

export function expressBlindSpots(answers: Readonly<Record<string, unknown>>): ExpressBlindSpots {
  const express = new Set(EXPRESS_QUESTIONS.map((q) => q.key))
  const spots = blindSpots(answers).filter((s) => express.has(s.key))
  const labels = spots.map((s) => lower(SURVEY_QUESTIONS[s.key]?.label ?? s.label))
  const total = EXPRESS_QUESTIONS.length
  return {
    count: spots.length,
    total,
    labels,
    text: spots.length
      ? `Вы не знаете ${spots.length} из ${total} цифр быстрого старта: ${labels.join(', ')}. Это первое, что стоит начать считать.`
      : null,
  }
}

/** Calculations shown on the snapshot (2–3 main ones, §7.3). */
export const SNAPSHOT_CALC_IDS = ['goal_pace', 'marketing_money'] as const
