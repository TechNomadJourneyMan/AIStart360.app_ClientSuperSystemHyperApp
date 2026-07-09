// lib/gri/decisive-bets.ts — «5 решающих ставок»: чистый трансформер
// top_5_limits (+section_avgs, +action_plan_90d) → до 5 карточек
// «ставка → ожидаемый эффект → первый шаг».
//
// Принципы честности:
// - эффект на GRI считается ТОЛЬКО из реально известного балла блока
//   (section_avgs, иначе — балл критерия как приближение);
// - если балл неизвестен — честная формулировка без чисел;
// - первый шаг берётся из action_plan_90d, иначе — честный generic.
//
// Толерантен к формам top_5_limits:
//   { title | criterionText, block | blockName | blockId, score?, rank? }

import { GRI_SECTIONS } from '@/lib/gri-assessment/sections'

export interface DecisiveBet {
  /** Название ограничения (ставки). */
  bet: string
  /** Русское название блока GRI. */
  block: string
  /** Честная оценка эффекта, напр. «+0.3–0.6 к GRI». */
  expectedEffect: string
  /** Первый шаг из плана на 90 дней (или честный generic). */
  firstStep: string
}

// Русские подписи 7 блоков GRI (sections.ts хранит английские shortTitle) —
// та же карта, что в GriResultPanel/GriDynamicsPanel.
const BLOCK_RU: Record<string, string> = {
  'product-demand': 'Продукт и спрос',
  'trust-positioning': 'Доверие и позиционирование',
  'business-model': 'Бизнес-модель',
  'cash-stability': 'Денежная стабильность',
  operations: 'Операции',
  team: 'Команда',
  'owner-readiness': 'Готовность собственника',
}

export const GENERIC_EFFECT = 'Подтянет самый слабый блок'
export const GENERIC_FIRST_STEP = 'Разберите блок с экспертом'
const NEAR_MAX_EFFECT = 'Блок уже близок к максимуму — эффект на GRI небольшой'

// Подписи горизонтов плана (как в GriResultPanel).
const HORIZON_RU: Record<string, string> = {
  days_1_30: '1–30 дней',
  days_31_60: '31–60 дней',
  days_61_90: '61–90 дней',
}
const HORIZON_ORDER = ['days_1_30', 'days_31_60', 'days_61_90'] as const

// ── helpers ──────────────────────────────────────────────────────────────────

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined
}

function asFiniteNumber(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : undefined
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

// name (title/shortTitle/RU-подпись, lowercase) → sectionId
const NAME_TO_ID: Map<string, string> = (() => {
  const m = new Map<string, string>()
  for (const s of GRI_SECTIONS) {
    m.set(s.id.toLowerCase(), s.id)
    m.set(s.title.toLowerCase(), s.id)
    m.set(s.shortTitle.toLowerCase(), s.id)
    const ru = BLOCK_RU[s.id]
    if (ru) m.set(ru.toLowerCase(), s.id)
  }
  return m
})()

interface ParsedLimit {
  bet: string
  blockId?: string
  blockLabel: string
  score?: number
  rank?: number
}

function resolveBlockId(
  candidates: (string | undefined)[],
  sectionAvgs: Record<string, number>,
): string | undefined {
  for (const c of candidates) {
    if (!c) continue
    const key = c.toLowerCase()
    const known = NAME_TO_ID.get(key)
    if (known) return known
    // Кастомный sectionId, которого нет в GRI_SECTIONS, но есть в section_avgs.
    if (Object.prototype.hasOwnProperty.call(sectionAvgs, c)) return c
  }
  return undefined
}

function parseLimit(raw: unknown, sectionAvgs: Record<string, number>): ParsedLimit | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>

  const bet = asString(r.title) ?? asString(r.criterionText)
  if (!bet) return null

  const blockIdStr = asString(r.blockId)
  const blockNameStr = asString(r.blockName) ?? asString(r.block)
  const blockId = resolveBlockId([blockIdStr, blockNameStr], sectionAvgs)

  // Предпочитаем чистую русскую подпись, если блок распознан.
  const blockLabel =
    (blockId ? BLOCK_RU[blockId] : undefined) ?? blockNameStr ?? blockIdStr ?? '—'

  return {
    bet,
    blockId,
    blockLabel,
    score: asFiniteNumber(r.score),
    rank: asFiniteNumber(r.rank),
  }
}

/**
 * Честная оценка эффекта на GRI из балла блока.
 *
 * Логика: GRI = среднее по n блокам, значит рост блока на Δ даёт Δ/n к индексу.
 * Реалистичный сдвиг блока за 90 дней — 25–50% от «запаса» (10 − балл).
 * Чем ниже балл, тем больше потенциал; точные числа НЕ выдумываются —
 * без известного балла возвращается словесная формулировка.
 */
function formatExpectedEffect(blockScore: number | undefined, blockCount: number): string {
  if (blockScore === undefined) return GENERIC_EFFECT

  const headroom = clamp(10 - blockScore, 0, 10)
  if (headroom < 0.5) return NEAR_MAX_EFFECT

  const n = blockCount > 0 ? blockCount : 7
  const low = Math.max(round1((headroom * 0.25) / n), 0.1)
  const high = Math.max(round1((headroom * 0.5) / n), low)
  if (high <= low) return `≈ +${low.toFixed(1)} к GRI`
  return `+${low.toFixed(1)}–${high.toFixed(1)} к GRI`
}

interface PlanCardish {
  limitation?: unknown
  focus?: unknown
  firstStep?: unknown
  action?: unknown
  step?: unknown
}

/** Первый шаг из action_plan_90d для конкретной ставки/блока. */
function findFirstStep(actionPlan90d: unknown, limit: ParsedLimit): string {
  if (!actionPlan90d || typeof actionPlan90d !== 'object') return GENERIC_FIRST_STEP
  const plan = actionPlan90d as Record<string, unknown>

  const needles = [limit.bet, limit.blockLabel, limit.blockId]
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .map((s) => s.toLowerCase())

  // Сначала — прямое совпадение по критерию/блоку, начиная с раннего горизонта.
  for (const key of HORIZON_ORDER) {
    const cards = plan[key]
    if (!Array.isArray(cards)) continue
    for (const card of cards) {
      if (!card || typeof card !== 'object') continue
      const c = card as PlanCardish
      const limitation = asString(c.limitation)?.toLowerCase() ?? ''
      if (!needles.some((n) => limitation.includes(n))) continue
      const step = asString(c.firstStep) ?? asString(c.action) ?? asString(c.step) ?? asString(c.focus)
      if (step) return `${HORIZON_RU[key]} — ${step}`
    }
  }
  return GENERIC_FIRST_STEP
}

function countPositiveBlocks(sectionAvgs: Record<string, number>): number {
  return Object.values(sectionAvgs).filter((v) => Number.isFinite(v) && v > 0).length
}

// ── main transformer ─────────────────────────────────────────────────────────

/**
 * top_5_limits (+section_avgs, +action_plan_90d) → до 5 «решающих ставок».
 * Чистая функция, без I/O. Мусорный вход → пустой массив.
 */
export function computeDecisiveBets(
  top5Limits: unknown,
  sectionAvgs?: Record<string, number> | null,
  actionPlan90d?: unknown,
): DecisiveBet[] {
  if (!Array.isArray(top5Limits)) return []
  const avgs = sectionAvgs && typeof sectionAvgs === 'object' ? sectionAvgs : {}
  const blockCount = countPositiveBlocks(avgs)

  const parsed = top5Limits
    .map((raw) => parseLimit(raw, avgs))
    .filter((p): p is ParsedLimit => p !== null)

  // rank (если есть) упорядочивает; без rank — исходный порядок (стабильно).
  const ordered = parsed
    .map((p, idx) => ({ p, key: p.rank ?? idx, idx }))
    .sort((a, b) => (a.key !== b.key ? a.key - b.key : a.idx - b.idx))
    .map(({ p }) => p)

  return ordered.slice(0, 5).map((limit) => {
    // Балл блока: приоритет — section_avgs; иначе балл критерия как приближение.
    const fromAvgs = limit.blockId ? asFiniteNumber(avgs[limit.blockId]) : undefined
    const blockScore =
      fromAvgs !== undefined && fromAvgs > 0
        ? fromAvgs
        : limit.score !== undefined && limit.score > 0
          ? limit.score
          : undefined

    return {
      bet: limit.bet,
      block: limit.blockLabel,
      expectedEffect: formatExpectedEffect(
        blockScore !== undefined ? clamp(blockScore, 0, 10) : undefined,
        blockCount,
      ),
      firstStep: findFirstStep(actionPlan90d, limit),
    }
  })
}
