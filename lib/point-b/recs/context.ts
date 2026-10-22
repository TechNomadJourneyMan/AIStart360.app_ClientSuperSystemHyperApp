/**
 * lib/point-b/recs/context.ts — the «земля» of the AI recommendations (spec §12; plan Ф6a, Task 4). Pure.
 *
 * The context is a text with two parts:
 *   «Данные»          ONLY numbers of the model, written as the UI writes them (format.ts), plus what the RULES
 *                     found (limiting factor, contradictions) and the Point A blocks. Every number the AI may use
 *                     is here; `allowedNumbers` is the set of their canonical forms and decompositions
 *                     (lib/point-b/insights/numbers.ts).
 *   user text         the owner's goal text and the titles of the strategy nodes — fenced with fenceUntrusted
 *                     (data, never instructions). Their numbers are NOT allowed: a recommendation may not quote
 *                     a figure that did not come from the model.
 * `refs` is the closed list of source ids the AI may cite (field `refs` of an item); `inputsHash` identifies the
 * data part (a recommendation becomes stale when it changes — Ф6b).
 */
import { createHash } from 'node:crypto'
import { fenceUntrusted } from '@/lib/ai/gateway'
import { findLimitingFactor } from '../insights/constraint'
import { findContradictions } from '../insights/contradictions'
import { allowedNumbers as numbersOf, numberVariants } from '../insights/numbers'
import { LEVER_METRIC, pickScenario } from '../insights/scenario'
import { fmtMoney, fmtMonths, fmtNum, fmtPct, fmtTimes } from '../model/format'
import type { ModelResult } from '../model/types'
import type { RecSourceRef } from './types'

export interface RecsContextInput {
  result: ModelResult
  selectedScenario: string | null
  blocks: Array<{ key: string; title: string; score: number | null }>
  strategyOutline: string[]
  goalText: string | null
}

export interface RecsContext {
  text: string
  allowedNumbers: Set<string>
  /** id → source the AI may cite in `refs`. */
  refs: Record<string, RecSourceRef>
  inputsHash: string
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const MAX_OUTLINE = 30

export function buildRecsContext(input: RecsContextInput): RecsContext {
  const { result } = input
  const lines: string[] = []
  const raw: number[] = []
  const refs: Record<string, RecSourceRef> = {}
  const ref = (id: string, r: RecSourceRef): string => { refs[id] = r; return id }
  const num = (v: number | null | undefined, f: (x: number) => string): string => {
    if (!finite(v)) return '—'
    raw.push(v)
    return f(v)
  }

  lines.push(`Уровень данных: ${result.level === 2 ? 'деньги рассчитаны (уровень 2)' : result.level === 1 ? 'рычаги без денег (уровень 1)' : 'только цель (уровень 0)'}; модель: ${result.kind === 'funnel' ? 'воронка' : result.kind === 'growth' ? 'упрощённый рост' : 'нет'}. [${ref('model', { type: 'model', ref: 'result', label: 'Расчёт модели Точки Б' })}]`)

  const g = result.gap
  if (finite(g.baseAnnual) || finite(g.targetAnnual)) {
    const goalId = ref('goal', { type: 'goal', ref: 'biz.finansy.vyruchka_god', label: 'Цель по выручке' })
    lines.push(`Выручка сейчас: ${num(g.baseAnnual, fmtMoney)} в год. Цель: ${num(g.targetAnnual, fmtMoney)} в год через ${num(g.months, fmtMonths)} Рост: ${num(g.multiplier, fmtTimes)}. [${goalId}]`)
  }
  if (result.verdict?.reason) lines.push(`Прогноз при текущем ходе: ${result.verdict.headline}. ${result.verdict.reason} [${ref('forecast', { type: 'model', ref: 'forecast', label: 'Прогноз при текущем ходе' })}]`)

  const sc = pickScenario(result, input.selectedScenario)
  if (sc) {
    const scId = ref(`scenario:${sc.key}`, { type: 'scenario', ref: sc.key, label: `Сценарий «${sc.label}»` })
    lines.push(`Сценарий плана: «${sc.label}»${input.selectedScenario === sc.key ? ' (выбран экспертом)' : ''}. [${scId}]`)
    lines.push(sc.feasible ? 'Сценарий достижим.' : `Сценарий недостижим: ${sc.infeasibleReason ?? 'рычаги выше потолков реализуемости'}`)
    lines.push(`Срок достижения цели: ${num(sc.timeToGoalMonths.base, fmtMonths)}`)
    for (const u of sc.requiredUplift) {
      const id = u.lever in LEVER_METRIC ? ref(`metric:${u.lever}`, { type: 'metric', ref: LEVER_METRIC[u.lever as keyof typeof LEVER_METRIC], label: u.label }) : scId
      const val = (v: number | null): string => (u.lever === 'leads' ? num(v, (x) => fmtNum(x)) : u.lever === 'avgCheck' ? num(v, fmtMoney) : num(v, (x) => fmtPct(x, 1)))
      lines.push(`- ${u.label}: ${val(u.current)} → ${val(u.target)}${finite(u.upliftPct) ? ` (+${num(u.upliftPct, (x) => fmtNum(x, 1))}%)` : ''}. [${id}]`)
    }
    const inv = sc.investments
    if (finite(inv.marketingMonthlyIncrease)) lines.push(`Рост маркетингового бюджета: ${num(inv.marketingMonthlyIncrease, fmtMoney)} в месяц.`)
    if (finite(inv.staffNeed)) lines.push(`Новых сотрудников нужно: ${num(inv.staffNeed, (x) => fmtNum(x))}. [${ref('metric:headcount', { type: 'metric', ref: 'biz.hr.kol_vo_sotrudnikov', label: 'Число сотрудников' })}]`)
    const f = sc.finance
    if (f) {
      const fin = ref('finmodel', { type: 'finmodel', ref: 'cash', label: 'Финмодель: деньги и расходы' })
      lines.push(`Деньги: минимум на счёте ${num(f.minCash.value, fmtMoney)} в месяце ${num(f.minCash.month, (x) => fmtNum(x))}; резерв ликвидности ${num(f.reserveRequired, fmtMoney)}; нехватка до резерва ${num(f.fundingNeed, fmtMoney)}; кассовый разрыв: ${f.cashGapMonth === null ? 'нет' : `в месяце ${num(f.cashGapMonth, (x) => fmtNum(x))}`}. [${fin}]`)
    }
  }

  const limiting = findLimitingFactor(result, input.blocks.map((b) => ({ key: b.key, score: b.score })))
  if (limiting) lines.push(`Ограничивающий фактор (правило): ${limiting.label}. ${limiting.reason} [${ref(`metric:${limiting.lever}`, limiting.sourceRefs.find((r) => r.type === 'metric') ?? limiting.sourceRefs[0])}]`)
  for (const c of findContradictions({ result, selectedScenario: input.selectedScenario, goalMonths: result.gap.months })) {
    lines.push(`Противоречие (правило): ${c.title}. ${c.reason} [${ref(`check:${c.key}`, { type: 'check', ref: c.key, label: c.title })}]`)
  }
  const blocks = input.blocks.filter((b) => finite(b.score))
  if (blocks.length) {
    lines.push('Блоки Точки А (баллы):')
    for (const b of blocks) lines.push(`- ${b.title}: ${num(b.score, (x) => fmtNum(x))}. [${ref(`block:${b.key}`, { type: 'snapshot', ref: `block:${b.key}`, label: `Блок Точки А «${b.title}»` })}]`)
  }

  const data = lines.join('\n')
  // Every number written in the data part, and every value behind it in the other UI forms (62,4 млн ₸ → 62400000).
  const allowed = numbersOf(data)
  for (const v of raw) for (const c of numberVariants(v)) allowed.add(c)

  const outline = input.strategyOutline.map((s) => s.trim()).filter(Boolean).slice(0, MAX_OUTLINE)
  const userParts = [
    input.goalText?.trim() ? `Цель владельца (его слова):\n${fenceUntrusted('goal', input.goalText.trim(), 2000)}` : null,
    outline.length ? `Стратегия плана (названия узлов):\n${fenceUntrusted('strategy', outline.map((s) => `- ${s}`).join('\n'), 6000)}` : null,
  ].filter(Boolean)

  const refList = Object.entries(refs).map(([id, r]) => `${id} — ${r.label}`).join('\n')
  const text = [
    'Данные (единственный источник чисел):',
    data,
    ...userParts,
    `Допустимые id источников для поля refs:\n${refList}`,
  ].join('\n\n')

  return { text, allowedNumbers: allowed, refs, inputsHash: createHash('sha256').update(data).digest('hex').slice(0, 32) }
}
