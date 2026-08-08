/**
 * block-score-rules — explains where a Point A block score came from.
 *
 * SOURCE OF TRUTH: `lib/point-a-engine.ts`. That module computes the numbers
 * stored in `diagnostics.<block>_score`; this module re-walks the SAME rules,
 * in the same order, with the same thresholds, so the UI can show the owner
 * which survey question produced which points. Nothing here invents a value:
 * every row names the survey key it read and the points that key's answer
 * contributed.
 *
 * Because it is a mirror, it can drift. `explainBlock()` therefore returns
 * both the raw sum and the clamped score, and the UI compares the clamped
 * value against the score stored in the database — a mismatch is shown to the
 * user as "пересчитайте диагностику", never hidden.
 *
 * Numeric parsing is imported from the engine's own helpers
 * (`lib/metrics/source-adapters`) rather than re-written.
 */

import { coerceNumeric, parsePercentChange } from '@/lib/metrics/source-adapters'
import { SURVEY_LABELS, formatSurveyValue } from '@/lib/survey-labels'

export type BlockId = 'finance' | 'sales' | 'operations' | 'marketing' | 'strategy'

export interface Contribution {
  /** Survey keys this rule reads, in the engine's priority order. */
  keys: string[]
  /** What the rule checks, in the owner's language. */
  title: string
  /** The answer as stored, formatted; null when nothing was answered. */
  answer: string | null
  /** Points this answer added (may be negative). */
  points: number
  /** Maximum this rule can add. */
  max: number
  /** Why exactly this many points. */
  note: string
}

export interface BlockExplanation {
  contributions: Contribution[]
  /** Sum of all contributions, before the 0–100 clamp. */
  raw: number
  /** Same sum after clamp(0, 100) — this is what the engine stores. */
  clamped: number
  /** Weight of the block inside the overall Point A score. */
  weight: number
}

type Answers = Record<string, unknown>

// ─── Engine helpers (mirrored) ───────────────────────────────────────────────

function clamp(v: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, v))
}

/** First value across `keys` that coerces to a finite, non-zero number. */
function readNumberAlias(a: Answers, keys: string[]): number {
  let firstZero: number | null = null
  for (const k of keys) {
    const n = coerceNumeric(a[k])
    if (n !== null && Number.isFinite(n)) {
      if (n !== 0) return n
      if (firstZero === null) firstZero = 0
    }
  }
  return firstZero ?? 0
}

function readStringAlias(a: Answers, keys: string[]): string {
  for (const k of keys) {
    const v = a[k]
    if (typeof v === 'string' && v.trim() !== '') return v
  }
  return ''
}

// ─── Answer display ──────────────────────────────────────────────────────────

function isFilled(v: unknown): boolean {
  if (v === undefined || v === null) return false
  if (typeof v === 'string') return v.trim() !== ''
  if (Array.isArray(v)) return v.length > 0
  return true
}

/** Formatted answer for the first filled key, or null when none is filled. */
function answerOf(a: Answers, keys: string[]): string | null {
  for (const k of keys) {
    if (isFilled(a[k])) return formatSurveyValue(k, a[k])
  }
  return null
}

/**
 * Human label for a survey key — falls back to the raw key.
 *
 * Deliberately no step number: several keys keep a legacy prefix that no
 * longer matches the form they live in (`s5_marketing_channels` is asked on
 * step 7), so a derived step would point the owner at the wrong screen.
 */
export function labelOfKey(key: string): string {
  return SURVEY_LABELS[key] ?? key
}

// ─── Finance (weight 30%) ────────────────────────────────────────────────────

function explainFinance(a: Answers): Contribution[] {
  const out: Contribution[] = []

  const rev23 = readNumberAlias(a, ['s2_revenue_2023'])
  const rev24 = readNumberAlias(a, ['s2_revenue_2024', 's9n_revenue_2024'])
  const rev25 = readNumberAlias(a, ['s2_revenue_2025'])
  const changeVs2023 = parsePercentChange(a['s9n_change_vs_2023'])

  // 1. Revenue growth
  let growth: number | null = null
  if (rev24 > 0 && rev23 > 0) growth = ((rev24 - rev23) / rev23) * 100
  else if (rev24 > 0 && changeVs2023 !== null) growth = changeVs2023

  const growthKeys = ['s2_revenue_2024', 's9n_revenue_2024', 's2_revenue_2023', 's9n_change_vs_2023']
  if (growth === null) {
    out.push({
      keys: growthKeys,
      title: 'Рост выручки год к году',
      answer: answerOf(a, growthKeys),
      points: -10,
      max: 20,
      note: 'Нет выручки за два года подряд и нет процента изменения — движок вычитает 10 баллов',
    })
  } else {
    const points = growth > 20 ? 20 : growth > 0 ? 10 : 0
    out.push({
      keys: growthKeys,
      title: 'Рост выручки год к году',
      answer: `${growth > 0 ? '+' : ''}${growth.toFixed(1)}%`,
      points,
      max: 20,
      note:
        points === 20
          ? 'Рост более 20% — максимум'
          : points === 10
          ? 'Рост есть, но менее 20%'
          : 'Выручка не растёт или падает — 0 баллов',
    })
  }

  // 2. Gross margin
  const marginKeys = ['s2_gross_margin', 's9n_net_margin']
  const margin = readNumberAlias(a, marginKeys)
  out.push({
    keys: marginKeys,
    title: 'Маржинальность',
    answer: answerOf(a, marginKeys),
    points: margin > 30 ? 15 : margin > 15 ? 8 : margin > 0 ? 3 : 0,
    max: 15,
    note:
      margin > 30
        ? 'Более 30% — максимум'
        : margin > 15
        ? 'От 15% до 30%'
        : margin > 0
        ? 'Ниже 15% — почти без баллов'
        : 'Не указана или ноль — 0 баллов',
  })

  // 3. LTV / CAC
  const ltv = Number(a['s2_ltv'] ?? 0)
  const cac = Number(a['s2_cac'] ?? 1)
  if (cac > 0 && ltv > 0) {
    const ratio = ltv / cac
    out.push({
      keys: ['s2_ltv', 's2_cac'],
      title: 'Отношение LTV к CAC',
      answer: `LTV/CAC = ${ratio.toFixed(1)}`,
      points: ratio >= 3 ? 15 : ratio >= 2 ? 8 : 0,
      max: 15,
      note:
        ratio >= 3
          ? 'Норма — 3 и выше'
          : ratio >= 2
          ? 'Ниже нормы (норма ≥ 3)'
          : 'Меньше 2 — привлечение убыточно, 0 баллов',
    })
  } else {
    out.push({
      keys: ['s2_ltv', 's2_cac'],
      title: 'Отношение LTV к CAC',
      answer: answerOf(a, ['s2_ltv', 's2_cac']),
      points: -5,
      max: 15,
      note: 'LTV или CAC не заполнены — движок вычитает 5 баллов',
    })
  }

  // 4. Breakeven
  const beKeys = ['s2_knows_breakeven', 's9n_breakeven_point']
  const knowsBE = Boolean(a['s2_knows_breakeven']) || readStringAlias(a, ['s9n_breakeven_point']) !== ''
  out.push({
    keys: beKeys,
    title: 'Точка безубыточности известна',
    answer: answerOf(a, beKeys),
    points: knowsBE ? 10 : 0,
    max: 10,
    note: knowsBE ? 'Точка посчитана' : 'Неизвестна — 0 баллов',
  })

  // 5. Debt load
  const debtKeys = ['s2_debt_load', 's9n_debts_amount']
  const debt =
    a['s2_debt_load'] != null
      ? String(a['s2_debt_load'])
      : readNumberAlias(a, ['s9n_debts_amount']) > 0
      ? 'moderate'
      : 'none'
  out.push({
    keys: debtKeys,
    title: 'Долговая нагрузка',
    answer: answerOf(a, debtKeys) ?? 'Нет (по умолчанию)',
    points: debt === 'none' ? 10 : debt === 'moderate' ? 5 : 0,
    max: 10,
    note:
      debt === 'none'
        ? 'Долгов нет — максимум. Внимание: пустой ответ движок тоже считает «нет»'
        : debt === 'moderate'
        ? 'Умеренная нагрузка'
        : 'Высокая нагрузка — 0 баллов',
  })

  // 6. Cash-flow heuristic on 2025 vs 2024
  const cashOk = rev25 > 0 && rev24 > 0 && rev25 >= rev24
  out.push({
    keys: ['s2_revenue_2025', 's2_revenue_2024', 's9n_revenue_2024'],
    title: 'Выручка 2025 не ниже 2024',
    answer: answerOf(a, ['s2_revenue_2025']),
    points: cashOk ? 15 : 0,
    max: 15,
    note: cashOk
      ? 'Выручка держится или растёт'
      : rev25 > 0 && rev24 > 0
      ? 'Снижение выручки в 2025 — 0 баллов'
      : 'Не с чем сравнивать: нет выручки за 2025 и/или 2024 — 0 баллов',
  })

  return out
}

// ─── Sales (weight 25%) ──────────────────────────────────────────────────────

function explainSales(a: Answers): Contribution[] {
  const out: Contribution[] = []

  const crm = String(a['s3_has_crm'] ?? 'none')
  const cycleDays = Number(a['s3_deal_cycle_days'] ?? 0)
  const deals24 = Number(a['s3_deals_2024'] ?? 0)
  const rejections24 = Number(a['s3_rejections_2024'] ?? 0)
  const repeatClients24 = Number(a['s2_repeat_clients_2024'] ?? 0)
  const newClients24 = Number(a['s2_new_clients_2024'] ?? 0)
  const hasLoyalty = Boolean(a['s3_has_loyalty'])

  const crmOk = crm !== 'none' && crm !== ''
  out.push({
    keys: ['s3_has_crm'],
    title: 'CRM-система',
    answer: answerOf(a, ['s3_has_crm']),
    points: crmOk ? 20 : 0,
    max: 20,
    note: crmOk ? 'CRM есть — максимум' : 'CRM нет — 0 баллов, движок оценивает потери лидов ~30%',
  })

  out.push({
    keys: ['s3_deal_cycle_days'],
    title: 'Цикл сделки',
    answer: answerOf(a, ['s3_deal_cycle_days']),
    points: cycleDays > 0 && cycleDays < 30 ? 15 : cycleDays <= 60 ? 8 : 0,
    max: 15,
    note:
      cycleDays > 0 && cycleDays < 30
        ? 'Менее 30 дней — максимум'
        : cycleDays === 0
        ? 'Не указан: движок засчитывает 8 баллов как «до 60 дней». Заполните, чтобы балл стал честным'
        : cycleDays <= 60
        ? 'От 30 до 60 дней'
        : 'Более 60 дней — 0 баллов',
  })

  const clientsTotal = newClients24 + repeatClients24
  const repeatPct = clientsTotal > 0 ? (repeatClients24 / clientsTotal) * 100 : null
  out.push({
    keys: ['s2_repeat_clients_2024', 's2_new_clients_2024'],
    title: 'Доля повторных клиентов',
    answer: repeatPct === null ? null : `${repeatPct.toFixed(0)}%`,
    points: repeatPct !== null && repeatPct >= 30 ? 15 : 0,
    max: 15,
    note:
      repeatPct === null
        ? 'Нет числа новых и повторных клиентов за 2024 — правило не сработало, 0 баллов'
        : repeatPct >= 30
        ? 'Норма — 30% и выше'
        : 'Ниже нормы 30% — 0 баллов',
  })

  out.push({
    keys: ['s3_deals_2024'],
    title: 'Размер воронки (сделок за 2024)',
    answer: answerOf(a, ['s3_deals_2024']),
    points: deals24 > 50 ? 10 : deals24 > 20 ? 5 : 0,
    max: 10,
    note:
      deals24 > 50
        ? 'Более 50 сделок — максимум'
        : deals24 > 20
        ? 'От 21 до 50 сделок'
        : deals24 > 0
        ? 'Маленькая воронка — 0 баллов'
        : 'Не заполнено — 0 баллов',
  })

  const refusalPct = deals24 > 0 ? (rejections24 / (deals24 + rejections24)) * 100 : null
  out.push({
    keys: ['s3_rejections_2024', 's3_deals_2024'],
    title: 'Процент отказов',
    answer: refusalPct === null ? null : `${refusalPct.toFixed(0)}%`,
    points: refusalPct !== null && refusalPct < 20 ? 10 : 0,
    max: 10,
    note:
      refusalPct === null
        ? 'Нет числа сделок за 2024 — правило не сработало, 0 баллов'
        : refusalPct < 20
        ? 'Менее 20% — максимум'
        : 'Отказов 20% и больше — 0 баллов',
  })

  out.push({
    keys: ['s3_has_loyalty'],
    title: 'Программа лояльности',
    answer: answerOf(a, ['s3_has_loyalty']),
    points: hasLoyalty ? 10 : 0,
    max: 10,
    note: hasLoyalty ? 'Программа есть' : 'Программы нет — 0 баллов',
  })

  return out
}

// ─── Operations (weight 20%) ─────────────────────────────────────────────────

function explainOperations(a: Answers): Contribution[] {
  const reporting = String(a['s4_reporting_tool'] ?? 'none')
  const taskMgr = String(a['s4_task_manager'] ?? 'none')
  const mgmtMethod = String(a['s4_management_method'] ?? 'manual')

  const flag = (key: string, title: string, max: number, yes: string, no: string): Contribution => {
    const ok = Boolean(a[key])
    return {
      keys: [key],
      title,
      answer: answerOf(a, [key]),
      points: ok ? max : 0,
      max,
      note: ok ? yes : no,
    }
  }

  return [
    flag('s4_has_org_chart', 'Оргструктура задокументирована', 15, 'Оргсхема есть', 'Оргсхемы нет — 0 баллов'),
    flag('s4_has_dept_kpi', 'KPI по отделам', 20, 'KPI заданы — самый весомый пункт блока', 'KPI не заданы — 0 баллов'),
    flag('s4_has_regular_meetings', 'Регулярные планёрки', 10, 'Планёрки есть', 'Планёрок нет — 0 баллов'),
    {
      keys: ['s4_reporting_tool'],
      title: 'Система отчётности',
      answer: answerOf(a, ['s4_reporting_tool']),
      points: reporting === 'bi' || reporting === 'crm' ? 15 : reporting === 'excel' ? 5 : 0,
      max: 15,
      note:
        reporting === 'bi' || reporting === 'crm'
          ? 'BI или CRM — максимум'
          : reporting === 'excel'
          ? 'Excel — 5 баллов, движок считает это слепой зоной'
          : 'Системы отчётности нет — 0 баллов',
    },
    {
      keys: ['s4_task_manager'],
      title: 'Таск-менеджер',
      answer: answerOf(a, ['s4_task_manager']),
      points: taskMgr !== 'none' && taskMgr !== '' ? 10 : 0,
      max: 10,
      note: taskMgr !== 'none' && taskMgr !== '' ? 'Инструмент задач есть' : 'Таск-менеджер не используется — 0 баллов',
    },
    {
      keys: ['s4_management_method'],
      title: 'Метод управления',
      answer: answerOf(a, ['s4_management_method']),
      points: mgmtMethod === 'manual' ? 0 : 10,
      max: 10,
      note:
        mgmtMethod === 'manual'
          ? 'Ручное управление — 0 баллов. Пустой ответ движок тоже считает ручным'
          : 'Управление по KPI/OKR или гибридное',
    },
  ]
}

// ─── Marketing (weight 15%) ──────────────────────────────────────────────────

function explainMarketing(a: Answers): Contribution[] {
  const budgetPct = Number(a['s5_marketing_budget_pct'] ?? 0)
  const channels = Array.isArray(a['s5_marketing_channels']) ? (a['s5_marketing_channels'] as unknown[]) : []
  const audience = String(a['s5_target_audience'] ?? '')
  const hasCompetitorAnalysis = Boolean(a['s5_has_competitor_analysis'])
  const usp = String(a['s5_usp'] ?? '')
  const hasLoyalty = Boolean(a['s3_has_loyalty'])

  return [
    {
      keys: ['s5_marketing_budget_pct'],
      title: 'Бюджет маркетинга (% выручки)',
      answer: answerOf(a, ['s5_marketing_budget_pct']),
      points: budgetPct >= 5 ? 15 : budgetPct > 0 ? 7 : 0,
      max: 15,
      note:
        budgetPct >= 5
          ? 'Норма — 5% и выше'
          : budgetPct > 0
          ? 'Ниже нормы 5% — 7 баллов из 15'
          : 'Бюджет не определён — 0 баллов',
    },
    {
      keys: ['s5_marketing_channels'],
      title: 'Каналы привлечения',
      answer: answerOf(a, ['s5_marketing_channels']),
      points: channels.length >= 3 ? 15 : channels.length >= 1 ? 7 : 0,
      max: 15,
      note:
        channels.length >= 3
          ? `${channels.length} канала и больше — максимум`
          : channels.length >= 1
          ? `Каналов ${channels.length} — меньше трёх, 7 баллов из 15`
          : 'Каналы не выбраны — 0 баллов',
    },
    {
      keys: ['s5_target_audience'],
      title: 'Описание целевой аудитории',
      answer: answerOf(a, ['s5_target_audience']),
      points: audience.length > 20 ? 15 : 0,
      max: 15,
      note:
        audience.length > 20
          ? 'Аудитория описана развёрнуто'
          : 'Описание короче 20 символов или пустое — 0 баллов',
    },
    {
      keys: ['s5_has_competitor_analysis'],
      title: 'Конкурентный анализ',
      answer: answerOf(a, ['s5_has_competitor_analysis']),
      points: hasCompetitorAnalysis ? 10 : 0,
      max: 10,
      note: hasCompetitorAnalysis ? 'Анализ проводился' : 'Анализ не проводился — 0 баллов',
    },
    {
      keys: ['s3_has_loyalty'],
      title: 'Программа лояльности (учитывается и здесь)',
      answer: answerOf(a, ['s3_has_loyalty']),
      points: hasLoyalty ? 10 : 0,
      max: 10,
      note: hasLoyalty
        ? 'Тот же ответ, что и в блоке «Продажи»'
        : 'Программы нет — 0 баллов. Этот ответ влияет сразу на два блока',
    },
    {
      keys: ['s5_usp'],
      title: 'УТП сформулировано',
      answer: answerOf(a, ['s5_usp']),
      points: usp.length > 10 ? 5 : 0,
      max: 5,
      note: usp.length > 10 ? 'УТП есть' : 'УТП короче 10 символов или пустое — 0 баллов',
    },
  ]
}

// ─── Strategy (weight 10%) ───────────────────────────────────────────────────

function explainStrategy(a: Answers): Contribution[] {
  const goal3yKeys = ['s6_goal_3years', 's2n_goal_3y_what', 's2n_goal_3y_metrics']
  const goal12mKeys = ['s6_goal_12months', 's2n_goal_12m_what', 's2n_goal_12m_metrics']
  const goal3y = readStringAlias(a, goal3yKeys)
  const goal12m = readStringAlias(a, goal12mKeys)
  const pain = String(a['s6_main_pain'] ?? '')
  const blockers = Array.isArray(a['s6_growth_blockers']) ? (a['s6_growth_blockers'] as unknown[]) : []

  return [
    {
      keys: goal3yKeys,
      title: 'Цель на 3 года',
      answer: answerOf(a, goal3yKeys),
      points: goal3y.length > 20 ? 20 : 0,
      max: 20,
      note: goal3y.length > 20 ? 'Цель описана развёрнуто' : 'Цель короче 20 символов или не задана — 0 баллов',
    },
    {
      keys: goal12mKeys,
      title: 'Цель на 12 месяцев',
      answer: answerOf(a, goal12mKeys),
      points: goal12m.length > 20 ? 15 : 0,
      max: 15,
      note: goal12m.length > 20 ? 'Цель описана развёрнуто' : 'Цель короче 20 символов или не задана — 0 баллов',
    },
    {
      keys: ['s6_main_pain'],
      title: 'Главная боль бизнеса',
      answer: answerOf(a, ['s6_main_pain']),
      points: pain.length > 10 ? 15 : 0,
      max: 15,
      note: pain.length > 10 ? 'Проблема сформулирована' : 'Ответ короче 10 символов или пустой — 0 баллов',
    },
    {
      keys: ['s6_growth_blockers'],
      title: 'Барьеры роста',
      answer: answerOf(a, ['s6_growth_blockers']),
      points: blockers.length > 0 ? 10 : 0,
      max: 10,
      note: blockers.length > 0 ? `Отмечено барьеров: ${blockers.length}` : 'Барьеры не отмечены — 0 баллов',
    },
  ]
}

// ─── Public API ──────────────────────────────────────────────────────────────

export const BLOCK_WEIGHT: Record<BlockId, number> = {
  finance: 0.3,
  sales: 0.25,
  operations: 0.2,
  marketing: 0.15,
  strategy: 0.1,
}

const EXPLAINERS: Record<BlockId, (a: Answers) => Contribution[]> = {
  finance: explainFinance,
  sales: explainSales,
  operations: explainOperations,
  marketing: explainMarketing,
  strategy: explainStrategy,
}

export function explainBlock(block: BlockId, answers: Answers): BlockExplanation {
  const contributions = EXPLAINERS[block](answers)
  const raw = contributions.reduce((sum, c) => sum + c.points, 0)
  return { contributions, raw, clamped: clamp(raw), weight: BLOCK_WEIGHT[block] }
}
