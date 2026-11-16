/**
 * lib/point-b/strategy/draft.ts — the DRAFT strategy tree of a plan version built by RULES (R3, M1 «черновик плана
 * в один клик»). Pure, no IO, no clock (the time is `now`).
 *
 * What the tree is made of — nothing else:
 *   - the levers of the model: every lever of the chosen scenario that has to grow (leads, conversion, check,
 *     repeat) is a strategy with its KPI (current → target of the scenario). The growth model (no levers) gets one
 *     strategy «Рост выручки до цели» with the gap of the model;
 *   - the limiting factor (lib/point-b/insights/constraint.ts) goes first, rated impact 5 and named in the text;
 *   - TOP-5 GRI: the first limits become the initiatives of «Снять ограничения роста (GRI)».
 * Every number written here comes from the model result, formatted as the UI writes it (model/format.ts), so the
 * number guard of the AI wording (allowedNumbers of the recommendations context) accepts it. Tasks get due dates
 * from `now` (2, 6 weeks; GRI 4 weeks); there are at most {@link DRAFT_MAX_TASKS} of them (they become the client's
 * «Мои задачи» only when the version is approved — strategy/tasks.ts). The result passes validateStrategy.
 *
 * The tree is a starting point for staff: Admin / Super Admin edit it in GIGA before sending it for approval.
 */
import { randomUUID } from 'node:crypto'
import { findLimitingFactor, LEVER_BLOCK } from '../insights/constraint'
import { LEVER_METRIC, pickScenario } from '../insights/scenario'
import { fmtMoney, fmtMonths, fmtNum, fmtPct, fmtTimes } from '../model/format'
import type { ModelResult, ScenarioResult } from '../model/types'
import type { Milestone, PlanStrategy, StrategyNode } from './types'

/** «3–7 задач в «Моих задачах»» (MVP of the audit, §7.1). */
export const DRAFT_MAX_TASKS = 7
export const DRAFT_MAX_GRI = 3

type Lever = 'leads' | 'conversion' | 'avgCheck' | 'repeat'
const LEVERS: readonly Lever[] = ['leads', 'conversion', 'avgCheck', 'repeat']

const LEVER_TITLE: Record<Lever, string> = {
  leads: 'Больше обращений клиентов',
  conversion: 'Выше конверсия в продажу',
  avgCheck: 'Выше средний чек',
  repeat: 'Больше повторных покупок',
}

const LEVER_TASKS: Record<Lever, [string, string]> = {
  leads: ['Разобрать каналы привлечения: откуда приходят обращения и сколько стоит каждое', 'Запустить и замерить один новый или усиленный канал привлечения'],
  conversion: ['Разобрать воронку продаж: на каком шаге теряются клиенты', 'Внедрить одно улучшение на самом слабом шаге воронки и замерить результат'],
  avgCheck: ['Разобрать состав чека: что покупают вместе и где есть место для допродаж', 'Запустить одно предложение для роста чека (пакет, допродажа, пересмотр цены) и замерить результат'],
  repeat: ['Разобрать, почему клиенты не возвращаются: опрос или разбор ушедших', 'Запустить одну программу возврата клиентов и замерить долю повторных покупок'],
}

const GRI_BLOCK_RU: Record<string, string> = {
  'product-demand': 'Продукт и спрос',
  'trust-positioning': 'Доверие и позиционирование',
  'business-model': 'Бизнес-модель',
  'cash-stability': 'Денежная стабильность',
  operations: 'Операции',
  team: 'Команда',
  'owner-readiness': 'Готовность собственника',
}

export interface GriLimit { rank?: number; title: string; block?: string; severity?: string }

export interface RuleStrategyInput {
  /** Computed WITH the scenarios (computeModel on the version's pace profiles). */
  result: ModelResult
  selectedScenario: string | null
  /** The Point A blocks (score null = no data) — the limiting factor's tie-break. */
  blocks: Array<{ key: string; score: number | null }>
  griTop5?: GriLimit[] | null
  now: Date
  /** Key generator (tests); default randomUUID. */
  newKey?: () => string
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

const valueText = (lever: Lever, v: number): string =>
  lever === 'leads' ? `${fmtNum(v)} в месяц` : lever === 'avgCheck' ? fmtMoney(v) : fmtPct(v, 1)

/** The KPI of a lever in the units the client reads (percent for the fractions). */
function leverKpi(lever: Lever, label: string, target: number): StrategyNode['kpi'] {
  if (lever === 'leads') return { name: label, target: Math.round(target), unit: 'в месяц' }
  if (lever === 'avgCheck') return { name: label, target: Math.round(target), unit: '₸' }
  return { name: label, target: Math.round(target * 1000) / 10, unit: '%' }
}

function isoDay(now: Date, days: number): string {
  return new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10)
}

function addMonths(now: Date, months: number): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, Math.min(now.getUTCDate(), 28)))
  return d.toISOString().slice(0, 10)
}

function node(key: string, p: Partial<StrategyNode> & Pick<StrategyNode, 'kind' | 'title' | 'order'>): StrategyNode {
  return {
    key, parentKey: null, description: null, ownerLabel: null, dueDate: null, impact: null, effort: null,
    metricId: null, block: null, kpi: null, dependsOn: [], delayRisk: null, ...p,
  }
}

interface LeverGoal { lever: Lever; label: string; current: number; target: number; upliftPct: number | null }

function leversToGrow(sc: ScenarioResult): LeverGoal[] {
  return sc.requiredUplift.flatMap((u) => {
    const lever = u.lever as Lever
    if (!LEVERS.includes(lever) || !finite(u.current) || !finite(u.target) || u.current <= 0 || u.target <= u.current * (1 + 1e-6)) return []
    return [{ lever, label: u.label, current: u.current, target: u.target, upliftPct: finite(u.upliftPct) ? u.upliftPct : null }]
  })
}

/**
 * The draft tree; an EMPTY strategy when the model has nothing to say (level 0 or no scenarios) — the caller then
 * reports that the data is missing instead of storing an invented plan.
 */
export function buildRuleStrategy(input: RuleStrategyInput): PlanStrategy {
  const { result, now } = input
  const key = input.newKey ?? (() => randomUUID())
  const sc = result.level >= 1 ? pickScenario(result, input.selectedScenario) : null
  if (!sc) return { items: [], milestones: [] }

  const items: StrategyNode[] = []
  let tasks = 0
  let order = 0
  const addTask = (parentKey: string, title: string, days: number, description: string | null = null): void => {
    if (tasks >= DRAFT_MAX_TASKS) return
    tasks += 1
    items.push(node(key(), { kind: 'task', parentKey, title, description, dueDate: isoDay(now, days), order: order++ }))
  }

  const limiting = findLimitingFactor(result, input.blocks)
  if (result.kind === 'funnel') {
    const levers = leversToGrow(sc).sort((a, b) => (a.lever === limiting?.lever ? -1 : b.lever === limiting?.lever ? 1 : 0))
    for (const l of levers) {
      const isLimiting = l.lever === limiting?.lever
      const pct = l.upliftPct !== null ? ` (+${fmtNum(l.upliftPct, 1)}%)` : ''
      const sKey = key()
      items.push(node(sKey, {
        kind: 'strategy',
        title: LEVER_TITLE[l.lever],
        description: [
          `«${l.label}»: ${valueText(l.lever, l.current)} → ${valueText(l.lever, l.target)}${pct} по сценарию «${sc.label}».`,
          ...(isLimiting ? ['Ограничивающий фактор роста: остальные рычаги упрутся в этот — начать с него.'] : []),
        ].join(' '),
        impact: isLimiting ? 5 : 4,
        effort: 3,
        metricId: LEVER_METRIC[l.lever],
        block: LEVER_BLOCK[l.lever],
        kpi: leverKpi(l.lever, l.label, l.target),
        order: order++,
      }))
      const iKey = key()
      items.push(node(iKey, {
        kind: 'initiative',
        parentKey: sKey,
        title: isLimiting ? `Снять ограничение: «${l.label}»` : `Поднять «${l.label}»`,
        description: null,
        impact: isLimiting ? 5 : 4,
        effort: 3,
        metricId: LEVER_METRIC[l.lever],
        block: LEVER_BLOCK[l.lever],
        order: order++,
      }))
      addTask(iKey, LEVER_TASKS[l.lever][0], 14)
      addTask(iKey, LEVER_TASKS[l.lever][1], 42)
    }
  }

  // The growth model (no levers), or a funnel whose levers already reach the goal: the gap itself.
  if (!items.length) {
    const g = result.gap
    const sKey = key()
    items.push(node(sKey, {
      kind: 'strategy',
      title: 'Рост выручки до цели',
      description: finite(g.baseAnnual) && finite(g.targetAnnual)
        ? `Выручка ${fmtMoney(g.baseAnnual)} в год → цель ${fmtMoney(g.targetAnnual)} в год${finite(g.months) ? ` за ${fmtMonths(g.months)}` : ''}${finite(g.multiplier) ? ` (${fmtTimes(g.multiplier)})` : ''}, сценарий «${sc.label}».`
        : `Сценарий «${sc.label}».`,
      impact: 5,
      effort: 3,
      metricId: 'biz.finansy.vyruchka_god',
      kpi: finite(g.targetAnnual) ? { name: 'Выручка в год', target: Math.round(g.targetAnnual), unit: '₸' } : null,
      order: order++,
    }))
    const iKey = key()
    items.push(node(iKey, { kind: 'initiative', parentKey: sKey, title: 'Найти главный рычаг роста', impact: 5, effort: 3, order: order++ }))
    addTask(iKey, 'Собрать данные воронки: обращения в месяц, конверсия в продажу, средний чек', 14)
    addTask(iKey, 'Выбрать один рычаг роста и запустить первую проверку', 42)
  }

  const gri = (input.griTop5 ?? []).filter((l) => l && typeof l.title === 'string' && l.title.trim()).slice(0, DRAFT_MAX_GRI)
  if (gri.length && tasks < DRAFT_MAX_TASKS) {
    const sKey = key()
    items.push(node(sKey, {
      kind: 'strategy',
      title: 'Снять ограничения роста (GRI)',
      description: 'Главные ограничения из оценки GRI клиента — то, что мешает росту помимо рычагов воронки.',
      impact: 4,
      effort: 3,
      order: order++,
    }))
    for (const l of gri) {
      if (tasks >= DRAFT_MAX_TASKS) break
      const iKey = key()
      const block = (l.block && GRI_BLOCK_RU[l.block]) || l.block?.trim() || null
      items.push(node(iKey, {
        kind: 'initiative',
        parentKey: sKey,
        title: `Ограничение: ${l.title.trim()}`.slice(0, 200),
        description: block ? `Блок GRI: ${block}.` : null,
        impact: l.severity === 'critical' ? 5 : 4,
        effort: 3,
        order: order++,
      }))
      addTask(iKey, `Разобрать ограничение «${l.title.trim()}» и наметить первые шаги`.slice(0, 200), 28)
    }
  }

  const milestones: Milestone[] = [{
    key: key(), title: 'Первая сверка темпа плана', date: addMonths(now, 3), kpi: null,
    description: 'Сравнить факт с планом за первые месяцы и решить, сохранять ли темп.',
  }]
  const months = result.gap.months
  if (finite(months) && months >= 4) {
    milestones.push({
      key: key(), title: 'Срок цели', date: addMonths(now, Math.round(months)), kpi: 'Выручка в год',
      description: finite(result.gap.targetAnnual) ? `Цель: ${fmtMoney(result.gap.targetAnnual)} в год.` : null,
    })
  }
  return { items, milestones }
}

/** Counts of a tree (what the draft answer and the audit report). */
export function draftCounts(s: PlanStrategy): { strategies: number; initiatives: number; tasks: number; milestones: number } {
  return {
    strategies: s.items.filter((n) => n.kind === 'strategy').length,
    initiatives: s.items.filter((n) => n.kind === 'initiative').length,
    tasks: s.items.filter((n) => n.kind === 'task').length,
    milestones: s.milestones.length,
  }
}
