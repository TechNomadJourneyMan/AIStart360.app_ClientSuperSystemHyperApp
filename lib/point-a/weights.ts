/**
 * Industry- and stage-aware weight presets for the Point A engine.
 *
 * This module is purely additive: it does not modify the existing engine,
 * which still uses hardcoded weights. Phase 6 may optionally wire these
 * presets into the scoring pipeline.
 *
 * All weight profiles must sum to 1.0 (±0.001). Use `pickWeightProfile`
 * to resolve an industry/stage pair to the most specific match,
 * falling back through stage='all' and industry='default'.
 */

export type Block = 'finance' | 'sales' | 'operations' | 'marketing' | 'strategy'

export type Industry =
  | 'retail'
  | 'ecommerce'
  | 'b2b_saas'
  | 'services'
  | 'manufacturing'
  | 'horeca'
  | 'education'
  | 'medical'
  | 'default'

export type Stage = 'seed' | 'early' | 'growth' | 'scale' | 'mature' | 'all'

export interface WeightProfile {
  industry: Industry
  stage: Stage
  weights: Record<Block, number>
  rationale: string
}

const KNOWN_INDUSTRIES: ReadonlySet<Industry> = new Set<Industry>([
  'retail',
  'ecommerce',
  'b2b_saas',
  'services',
  'manufacturing',
  'horeca',
  'education',
  'medical',
  'default',
])

const KNOWN_STAGES: ReadonlySet<Stage> = new Set<Stage>([
  'seed',
  'early',
  'growth',
  'scale',
  'mature',
  'all',
])

export const WEIGHT_PROFILES: WeightProfile[] = [
  // Baseline: matches the current hardcoded engine weights.
  {
    industry: 'default',
    stage: 'all',
    weights: { finance: 0.30, sales: 0.25, operations: 0.20, marketing: 0.15, strategy: 0.10 },
    rationale:
      'Базовый профиль: финансы 30%, продажи 25%, операции 20%, маркетинг 15%, стратегия 10%.',
  },
  // Retail: cash flow & sales dominate.
  {
    industry: 'retail',
    stage: 'all',
    weights: { finance: 0.35, sales: 0.25, operations: 0.20, marketing: 0.10, strategy: 0.10 },
    rationale: 'Розница: денежный поток и продажи доминируют — финансы 35%, продажи 25%.',
  },
  // E-commerce: marketing and traffic acquisition are critical.
  {
    industry: 'ecommerce',
    stage: 'all',
    weights: { finance: 0.20, sales: 0.25, operations: 0.15, marketing: 0.25, strategy: 0.15 },
    rationale: 'E-commerce: трафик и маркетинг критичны — маркетинг 25%, продажи 25%.',
  },
  // B2B SaaS: sales-led growth, recurring revenue.
  {
    industry: 'b2b_saas',
    stage: 'all',
    weights: { finance: 0.25, sales: 0.30, operations: 0.15, marketing: 0.15, strategy: 0.15 },
    rationale: 'B2B SaaS: воронка продаж и удержание — продажи 30%, финансы 25%.',
  },
  // B2B SaaS seed: product-market fit & strategy outweigh marketing.
  {
    industry: 'b2b_saas',
    stage: 'seed',
    weights: { finance: 0.20, sales: 0.25, operations: 0.20, marketing: 0.10, strategy: 0.25 },
    rationale:
      'B2B SaaS на ранней стадии: продукт-маркет фит важнее операций — стратегия 25%.',
  },
  // Services: close to default but a touch more sales.
  {
    industry: 'services',
    stage: 'all',
    weights: { finance: 0.30, sales: 0.25, operations: 0.20, marketing: 0.15, strategy: 0.10 },
    rationale: 'Услуги: сбалансированный профиль, близкий к базовому.',
  },
  // Manufacturing: operations + finance heavy.
  {
    industry: 'manufacturing',
    stage: 'all',
    weights: { finance: 0.30, sales: 0.10, operations: 0.30, marketing: 0.10, strategy: 0.20 },
    rationale:
      'Производство: операционная эффективность и капитал — операции 30%, финансы 30%.',
  },
  // HoReCa: operations-driven (kitchens, staff, logistics).
  {
    industry: 'horeca',
    stage: 'all',
    weights: { finance: 0.25, sales: 0.15, operations: 0.30, marketing: 0.15, strategy: 0.15 },
    rationale: 'HoReCa: бизнес операционно-ёмкий — операции 30%.',
  },
  // Education: marketing for enrolment, strategy for programmes.
  {
    industry: 'education',
    stage: 'all',
    weights: { finance: 0.20, sales: 0.15, operations: 0.20, marketing: 0.25, strategy: 0.20 },
    rationale:
      'Образование: набор студентов и программы — маркетинг 25%, стратегия 20%.',
  },
  // Medical: compliance-heavy operations, steady finance.
  {
    industry: 'medical',
    stage: 'all',
    weights: { finance: 0.20, sales: 0.20, operations: 0.25, marketing: 0.20, strategy: 0.15 },
    rationale:
      'Медицина: регуляторика и процессы — операции 25%, сбалансированные продажи и маркетинг.',
  },
  // Seed (any industry): strategy & runway dominate.
  {
    industry: 'default',
    stage: 'seed',
    weights: { finance: 0.20, sales: 0.20, operations: 0.15, marketing: 0.20, strategy: 0.25 },
    rationale:
      'Ранняя стадия: гипотезы и стратегия важнее зрелых процессов — стратегия 25%.',
  },
  // Mature (any industry): cash discipline & operations.
  {
    industry: 'default',
    stage: 'mature',
    weights: { finance: 0.35, sales: 0.15, operations: 0.25, marketing: 0.10, strategy: 0.15 },
    rationale:
      'Зрелая стадия: дисциплина капитала и операционка — финансы 35%, операции 25%.',
  },
  // Growth (any industry): sales & marketing acceleration.
  {
    industry: 'default',
    stage: 'growth',
    weights: { finance: 0.25, sales: 0.30, operations: 0.15, marketing: 0.20, strategy: 0.10 },
    rationale:
      'Стадия роста: ускорение продаж и маркетинга — продажи 30%, маркетинг 20%.',
  },
]

/**
 * Pick the best matching profile.
 *
 * Resolution order:
 *   1. exact industry × exact stage
 *   2. exact industry × stage='all'
 *   3. industry='default' × exact stage
 *   4. industry='default' × stage='all'
 *
 * Unknown industry/stage strings degrade to 'default'/'all'.
 */
export function pickWeightProfile(
  industry: string | null,
  stage: string | null,
): WeightProfile {
  const normalisedIndustry: Industry =
    industry && KNOWN_INDUSTRIES.has(industry as Industry)
      ? (industry as Industry)
      : 'default'
  const normalisedStage: Stage =
    stage && KNOWN_STAGES.has(stage as Stage) ? (stage as Stage) : 'all'

  const lookups: Array<[Industry, Stage]> = [
    [normalisedIndustry, normalisedStage],
    [normalisedIndustry, 'all'],
    ['default', normalisedStage],
    ['default', 'all'],
  ]

  for (const [ind, st] of lookups) {
    const match = WEIGHT_PROFILES.find((p) => p.industry === ind && p.stage === st)
    if (match) return match
  }

  // Guaranteed by the default/all entry above.
  return WEIGHT_PROFILES[0]
}

/**
 * Convenience: compute a single weighted-average score across blocks
 * using the given profile.
 */
export function applyWeights(
  blockScores: Record<Block, number>,
  profile: WeightProfile,
): number {
  const blocks: Block[] = ['finance', 'sales', 'operations', 'marketing', 'strategy']
  let total = 0
  for (const b of blocks) {
    total += (blockScores[b] ?? 0) * profile.weights[b]
  }
  return total
}

/**
 * Validate that a custom weight object sums to ~1.0 (±0.001).
 */
export function validateWeights(
  w: Record<Block, number>,
): { ok: boolean; sum: number; error?: string } {
  const blocks: Block[] = ['finance', 'sales', 'operations', 'marketing', 'strategy']
  let sum = 0
  for (const b of blocks) {
    const v = w[b]
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return { ok: false, sum: Number.NaN, error: `Вес блока "${b}" не является числом.` }
    }
    if (v < 0) {
      return { ok: false, sum, error: `Вес блока "${b}" не может быть отрицательным.` }
    }
    sum += v
  }
  const ok = Math.abs(sum - 1) <= 0.001
  return ok
    ? { ok: true, sum }
    : { ok: false, sum, error: `Сумма весов ${sum.toFixed(4)} ≠ 1.0 (±0.001).` }
}
