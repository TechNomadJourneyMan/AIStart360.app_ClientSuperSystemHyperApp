// lib/gri/reality-check.ts — «GRI Reality Check»: детерминированная сверка
// САМООЦЕНКИ из GRI-теста (gri_assessments.section_avgs, шкала 0–10) с ФАКТАМИ
// из анкеты (survey_answers) и Точки А (diagnostics).
//
// АНТИ-ГАЛЛЮЦИНАЦИОННЫЙ КОНТРАКТ (главный): НИКАКОГО LLM. Только чистые
// правила над реальными полями. Каждое расхождение обязано цитировать
// конкретное значение из данных («по анкете чистая прибыль −1 200 000»,
// «Точка А оценивает финансы в 25/100»). Нет данных → нет расхождения:
// молчим, не спекулируем.
//
// Источники фактов (все проверены по коду):
//   - sectionAvgs        — app/api/v1/gri/assessment/route.ts computeSectionAvgs()
//                          (среднее критериев 1..10; 0 = блок не заполнен)
//   - ctx.answers        — плоская карта question_key → value из
//                          lib/assistant/context.ts buildAssistantContext()
//   - ctx.pointA.blocks  — статусы BlockStatus из types/onboarding.ts:
//                          'critical' | 'weak' | 'average' | 'strong' | 'excellent',
//                          score 0..100; health_index 0..100 (lib/point-a-engine.ts)
//   - ctx.pointB.realism — lib/point-b/engine.ts:
//                          'realistic' | 'ambitious' | 'aggressive' | 'unrealistic' | 'unknown'
//   - ctx.pointB.gap.required_mom_growth — требуемый % роста в месяц (12m горизонт)

// ─── Типы ────────────────────────────────────────────────────────────────────

export type RealityCheckSeverity = 'mismatch' | 'note'

export interface RealityCheckItem {
  /** GRI-блок из lib/gri-assessment/sections.ts (или 'overall' для индексов). */
  blockId: string
  blockLabelRu: string
  /** Самооценка блока по GRI-тесту, 0–10 (для 'overall' — GRI-индекс). */
  selfScore: number
  /** Русская фраза с КОНКРЕТНОЙ цифрой/фактом из данных — никогда не выдумана. */
  finding: string
  severity: RealityCheckSeverity
}

/** Минимальный подтип AssistantContext (lib/assistant/types.ts) — только то,
 *  что реально читают правила. */
export interface RealityCheckContext {
  /** Плоская карта question_key → value (buildAssistantContext .answers). */
  answers: Record<string, unknown>
  pointA: {
    has_diagnostic: boolean
    /** 0..100 (lib/point-a-engine.ts), null без диагностики. */
    health_index: number | null
    blocks: Array<{ key: string; label: string; score: number; status: string }>
  }
  pointB: {
    current_revenue_year: number | null
    goal_12m_revenue_year: number | null
    gap: { required_mom_growth: number | null }
    realism: { level: string; score: number }
  }
  metrics: { revenue: number | null }
}

export interface RealityCheckInput {
  /** gri_assessments.section_avgs — { sectionId: 0..10 }. */
  sectionAvgs: Record<string, number>
  ctx: RealityCheckContext
}

// ─── Карты (явные, без инвенции) ─────────────────────────────────────────────

/** RU-подписи 7 блоков GRI — как в components/gri/page/GriDynamicsPanel.tsx. */
const BLOCK_RU: Record<string, string> = {
  'product-demand': 'Продукт и спрос',
  'trust-positioning': 'Доверие и позиционирование',
  'business-model': 'Бизнес-модель',
  'cash-stability': 'Денежная стабильность',
  operations: 'Операции',
  team: 'Команда',
  'owner-readiness': 'Готовность собственника',
}

/**
 * ЯВНЫЙ маппинг GRI-блоков → блоки Точки А (finance/sales/operations/
 * marketing/strategy из lib/assistant/context.ts BLOCK_LABELS).
 * 'team' и 'owner-readiness' сознательно НЕ замаплены: в Точке А нет
 * HR/личного блока — несоответствующие пары пропускаем, а не притягиваем.
 */
const GRI_TO_POINT_A: Partial<Record<string, string>> = {
  'cash-stability': 'finance',
  'business-model': 'finance',
  operations: 'operations',
  'product-demand': 'marketing',
  'trust-positioning': 'marketing',
}

const POINT_A_STATUS_RU: Record<string, string> = {
  critical: 'критично',
  weak: 'слабо',
  average: 'средне',
  strong: 'сильно',
  excellent: 'отлично',
}

const REALISM_RU: Record<string, string> = {
  realistic: 'реалистичная',
  ambitious: 'амбициозная',
  aggressive: 'агрессивная',
  unrealistic: 'нереалистичная',
}

// ─── Пороги (детерминированные, задокументированные) ─────────────────────────

/** Самооценка «высокая» для финансового правила и правила реалистичности. */
const HIGH_SELF = 7
/** Самооценка «очень высокая» для общего правила против Точки А. */
const VERY_HIGH_SELF = 8
/** Самооценка «заниженная» для обратного правила. */
const LOW_SELF = 3
/** Требуемый рост в месяц (%), который считаем аномально высоким. */
const ANOMALOUS_MOM_GROWTH = 15
/** Расхождение GRI-индекса (0–10) и health_index Точки А (нормирован /10). */
const INDEX_GAP = 3

// ─── Хелперы ─────────────────────────────────────────────────────────────────

/** Число из значения анкеты ('1 200 000', '12,5', 42) — иначе null. */
function coerceNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const cleaned = v.replace(/\s+/g, '').replace(',', '.')
  if (cleaned === '' || cleaned === '-') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

/** 1234567.8 → '1 234 568' (обычные пробелы — стабильно для тестов и UI). */
function fmtNum(n: number): string {
  const rounded = Math.round(n)
  const sign = rounded < 0 ? '−' : ''
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

/** Самооценка блока: конечное число > 0 (0 = блок не заполнен в тесте). */
function selfScoreOf(sectionAvgs: Record<string, number>, blockId: string): number | null {
  const v = sectionAvgs[blockId]
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
}

/** GRI-индекс из section_avgs — та же формула, что computeGriIndex() в
 *  app/api/v1/gri/assessment/route.ts (среднее положительных средних). */
function selfGriIndex(sectionAvgs: Record<string, number>): number | null {
  const positive = Object.values(sectionAvgs).filter((v) => Number.isFinite(v) && v > 0)
  if (positive.length === 0) return null
  return Math.round((positive.reduce((a, b) => a + b, 0) / positive.length) * 100) / 100
}

function pointABlock(
  ctx: RealityCheckContext,
  key: string,
): { key: string; label: string; score: number; status: string } | null {
  if (!ctx.pointA.has_diagnostic) return null
  return ctx.pointA.blocks.find((b) => b.key === key) ?? null
}

const fmt1 = (n: number): string => (Math.round(n * 10) / 10).toString().replace('.', ',')

// ─── Правила ─────────────────────────────────────────────────────────────────

/**
 * R1 — «Денежная стабильность»: selfScore >= 7 при том, что
 *   (а) по анкете чистая прибыль s9n_net_profit отрицательная, И/ИЛИ
 *   (б) Точка А ставит блоку «Финансы» статус 'critical'.
 * Поля runway в анкете НЕТ (s9n_* — см. lib/assistant/sections.ts), поэтому
 * runway-ветка сознательно не реализована — не выдумываем.
 */
function ruleCashStability(input: RealityCheckInput): RealityCheckItem | null {
  const blockId = 'cash-stability'
  const self = selfScoreOf(input.sectionAvgs, blockId)
  if (self == null || self < HIGH_SELF) return null

  const facts: string[] = []
  const netProfit = coerceNumber(input.ctx.answers['s9n_net_profit'])
  if (netProfit != null && netProfit < 0) {
    facts.push(`по анкете чистая прибыль отрицательная (${fmtNum(netProfit)})`)
  }
  const finance = pointABlock(input.ctx, 'finance')
  if (finance && finance.status === 'critical') {
    facts.push(`Точка А оценивает финансы в ${Math.round(finance.score)}/100 (критично)`)
  }
  if (facts.length === 0) return null

  return {
    blockId,
    blockLabelRu: BLOCK_RU[blockId],
    selfScore: self,
    finding: `Блок оценён на ${fmt1(self)}/10, но ${facts.join(', а ')}.`,
    severity: 'mismatch',
  }
}

/**
 * R3 — общий: selfScore >= 8 при статусе соответствующего блока Точки А
 * 'critical'/'weak' (реальные статусы BlockStatus; 'warning' в системе нет).
 * Пары берём ТОЛЬКО из явной карты GRI_TO_POINT_A.
 */
function ruleHighSelfVsPointA(
  input: RealityCheckInput,
  blockId: string,
): RealityCheckItem | null {
  const self = selfScoreOf(input.sectionAvgs, blockId)
  if (self == null || self < VERY_HIGH_SELF) return null
  const paKey = GRI_TO_POINT_A[blockId]
  if (!paKey) return null
  const pa = pointABlock(input.ctx, paKey)
  if (!pa || (pa.status !== 'critical' && pa.status !== 'weak')) return null

  const statusRu = POINT_A_STATUS_RU[pa.status] ?? pa.status
  return {
    blockId,
    blockLabelRu: BLOCK_RU[blockId] ?? blockId,
    selfScore: self,
    finding: `Самооценка ${fmt1(self)}/10, но Точка А оценивает блок «${pa.label}» в ${Math.round(pa.score)}/100 (${statusRu}).`,
    severity: 'mismatch',
  }
}

/**
 * R2 — «Продукт и спрос» / «Бизнес-модель»: selfScore >= 7 при низкой
 * реалистичности цели (realism.level 'aggressive'/'unrealistic' из Точки B)
 * или аномально высоком требуемом росте (required_mom_growth >= 15 %/мес).
 * Цитируем конкретный процент, если он есть; иначе — уровень и score
 * реалистичности (оба — реальные значения calculatePointBV2).
 */
function ruleGoalRealism(input: RealityCheckInput, blockId: string): RealityCheckItem | null {
  const self = selfScoreOf(input.sectionAvgs, blockId)
  if (self == null || self < HIGH_SELF) return null

  const { realism, gap } = input.ctx.pointB
  const mom = gap.required_mom_growth
  const lowRealism = realism.level === 'aggressive' || realism.level === 'unrealistic'
  const anomalousMom = mom != null && mom >= ANOMALOUS_MOM_GROWTH
  if (!lowRealism && !anomalousMom) return null

  const levelRu = REALISM_RU[realism.level] ?? realism.level
  const finding =
    mom != null
      ? `Самооценка ${fmt1(self)}/10, но цель требует ~${fmt1(mom)}% роста в месяц — реалистичность по данным: ${levelRu}.`
      : `Самооценка ${fmt1(self)}/10, но реалистичность цели по данным Точки B — ${levelRu} (${Math.round(realism.score)}/100).`

  return {
    blockId,
    blockLabelRu: BLOCK_RU[blockId] ?? blockId,
    selfScore: self,
    finding,
    severity: 'note',
  }
}

/**
 * R4 — обратное направление: selfScore <= 3 при статусе соответствующего
 * блока Точки А 'strong'/'excellent' → мягкая note «вы строже к себе».
 */
function ruleLowSelfVsPointA(
  input: RealityCheckInput,
  blockId: string,
): RealityCheckItem | null {
  const self = selfScoreOf(input.sectionAvgs, blockId)
  if (self == null || self > LOW_SELF) return null
  const paKey = GRI_TO_POINT_A[blockId]
  if (!paKey) return null
  const pa = pointABlock(input.ctx, paKey)
  if (!pa || (pa.status !== 'strong' && pa.status !== 'excellent')) return null

  const statusRu = POINT_A_STATUS_RU[pa.status] ?? pa.status
  return {
    blockId,
    blockLabelRu: BLOCK_RU[blockId] ?? blockId,
    selfScore: self,
    finding: `Самооценка ${fmt1(self)}/10, но Точка А даёт блоку «${pa.label}» ${Math.round(pa.score)}/100 (${statusRu}) — возможно, вы строже к себе, чем данные.`,
    severity: 'note',
  }
}

/**
 * R5 — общий индекс: GRI-индекс (0–10, из section_avgs) против health_index
 * Точки А (0–100 → честно нормируем /10). Расхождение > 3 пунктов → note.
 */
function ruleOverallIndex(input: RealityCheckInput): RealityCheckItem | null {
  const griIndex = selfGriIndex(input.sectionAvgs)
  const health = input.ctx.pointA.has_diagnostic ? input.ctx.pointA.health_index : null
  if (griIndex == null || health == null || !Number.isFinite(health)) return null

  const healthOn10 = health / 10
  if (Math.abs(griIndex - healthOn10) <= INDEX_GAP) return null

  const direction = griIndex > healthOn10 ? 'выше' : 'ниже'
  return {
    blockId: 'overall',
    blockLabelRu: 'Общий индекс',
    selfScore: griIndex,
    finding: `Ваш GRI-индекс ${fmt1(griIndex)}/10 заметно ${direction} индекса здоровья Точки А — ${Math.round(health)}/100 (≈${fmt1(healthOn10)}/10).`,
    severity: 'note',
  }
}

// ─── computeRealityCheck ─────────────────────────────────────────────────────

/**
 * Чистая детерминированная функция: самооценка GRI vs факты анкеты/Точки А/
 * Точки B. Не пишет в БД, не зовёт LLM. Максимум одна карточка на блок
 * (mismatch приоритетнее note). Нет данных → пустой массив.
 */
export function computeRealityCheck(input: RealityCheckInput): RealityCheckItem[] {
  const { sectionAvgs, ctx } = input
  if (!sectionAvgs || Object.keys(sectionAvgs).length === 0) return []
  if (!ctx?.answers || Object.keys(ctx.answers).length === 0) return []

  const items: RealityCheckItem[] = []
  const seen = new Set<string>()
  const push = (item: RealityCheckItem | null) => {
    if (item && !seen.has(item.blockId)) {
      seen.add(item.blockId)
      items.push(item)
    }
  }

  // Порядок в пределах блока: сначала mismatch-правила, потом note-правила —
  // «одна карточка на блок» выбирает более строгий вердикт.
  push(ruleCashStability(input))
  for (const blockId of Object.keys(GRI_TO_POINT_A)) {
    push(ruleHighSelfVsPointA(input, blockId))
  }
  for (const blockId of ['product-demand', 'business-model']) {
    push(ruleGoalRealism(input, blockId))
  }
  for (const blockId of Object.keys(GRI_TO_POINT_A)) {
    push(ruleLowSelfVsPointA(input, blockId))
  }
  push(ruleOverallIndex(input))

  return items
}
