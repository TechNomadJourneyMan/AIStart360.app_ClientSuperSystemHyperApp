/**
 * Value-add scoring engine v2 for Point A.
 *
 * Pure, additive layer on top of:
 *  - `lib/point-a-engine.ts`        rule-based base scores (consumed unchanged)
 *  - `lib/point-a/weights.ts`       industry × stage weight profiles
 *  - `lib/point-a/benchmarks.ts`    industry benchmark percentiles
 *  - `lib/metrics/resolver.ts`      live MetricValue array (optional)
 *
 * This module does NOT modify any existing file. Consumers explicitly opt in
 * by calling `scoreV2(...)`.
 */

import type { PointA, BlockScore } from '@/types/onboarding'
import type { MetricValue } from '@/lib/metrics/types'
import {
  applyWeights,
  pickWeightProfile,
  type Block,
  type Industry,
  type Stage,
  type WeightProfile,
} from '@/lib/point-a/weights'
import {
  findBenchmark,
  percentileAgainstBenchmark,
  ratingLabel,
} from '@/lib/point-a/benchmarks'

// ─── Public types ───────────────────────────────────────────

export interface ScoringV2Input {
  /** Output of calculatePointA() — the rule-based base. */
  base: PointA
  /** Optional industry / stage hints — if omitted, defaults to 'default' × 'all'. */
  industry?: Industry | string | null
  stage?: Stage | string | null
  /** Optional resolved metrics from the Phase 1 resolver. Lifts confidence when populated. */
  resolvedMetrics?: MetricValue[]
}

export interface BlockScoreV2 extends BlockScore {
  /** Confidence in this block's score, 0..1, derived from how many of its underlying signals were resolved. */
  confidence: number
  /** % vs industry benchmark — 50 = same, 75 = top quartile, 25 = bottom quartile. */
  percentileVsBenchmark: number | null
  /** Russian rating label: "Выше среднего" / "На уровне" / "Ниже среднего". */
  benchmarkRating: string | null
  /** Russian rationale combining base + benchmark + confidence note. */
  rationale: string
}

export interface PointAScoreV2 {
  /** New weighted-aggregate overall score. */
  overall_score_v2: number
  /** Block-level scores, enriched. */
  blocks_v2: Record<Block, BlockScoreV2>
  /** Confidence-weighted overall (lifts when more live data available). */
  overall_score_calibrated: number
  /** Which weight profile drove this calculation. */
  weight_profile: WeightProfile
  /** Map of metric_id → which block it contributed to (audit trail). */
  metric_to_block: Record<string, Block>
  /** Russian executive note summarising deltas vs base. */
  notes: string
}

// ─── Internals ──────────────────────────────────────────────

const ALL_BLOCKS: Block[] = ['finance', 'sales', 'operations', 'marketing', 'strategy']

/**
 * English industry enum → Russian benchmark industry label.
 * `benchmarks.ts` keys its dataset on Russian names; `weights.ts` on English.
 */
const INDUSTRY_TO_BENCHMARK_NAME: Record<Industry, string | null> = {
  retail: 'Розничная торговля',
  ecommerce: 'Электронная коммерция',
  b2b_saas: 'B2B SaaS',
  services: 'Услуги',
  manufacturing: 'Производство',
  horeca: 'Общепит / HoReCa',
  education: 'Образование',
  medical: 'Медицина / клиники',
  default: null,
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

/**
 * Normalise a raw industry string. Accepts:
 *   - the English enum directly (retail/ecommerce/...)
 *   - common Russian aliases ("Розница", "Розничная торговля")
 *   - anything else → 'default'
 */
function normaliseIndustry(value: Industry | string | null | undefined): Industry {
  if (!value) return 'default'
  const lower = String(value).trim().toLocaleLowerCase('ru')
  // exact enum?
  if (KNOWN_INDUSTRIES.has(lower as Industry)) return lower as Industry
  // common Russian → English mapping
  if (/розн/.test(lower)) return 'retail'
  if (/(e[- ]?commerce|электронн)/.test(lower)) return 'ecommerce'
  if (/(saas|b2b)/.test(lower)) return 'b2b_saas'
  if (/услуг/.test(lower)) return 'services'
  if (/произв/.test(lower)) return 'manufacturing'
  if (/(horeca|общепит|ресторан|каф)/.test(lower)) return 'horeca'
  if (/образован/.test(lower)) return 'education'
  if (/(медиц|клиник)/.test(lower)) return 'medical'
  return 'default'
}

function normaliseStage(value: Stage | string | null | undefined): Stage {
  if (!value) return 'all'
  const lower = String(value).trim().toLocaleLowerCase('en')
  if (KNOWN_STAGES.has(lower as Stage)) return lower as Stage
  return 'all'
}

/**
 * Classify a metric id into one of the five business blocks.
 *
 * Heuristic precedence:
 *   1. biz.<dept>.* — explicit department slug
 *   2. kpi.*       — mostly finance ratios
 *   3. gri.*       — mapped per the GRI block taxonomy
 *   4. goal.*      — strategy by default (goal blocks are objective-driven)
 *
 * Returns null if the id does not look like a metric id at all.
 */
export function classifyMetricToBlock(metricId: string): Block | null {
  if (!metricId || typeof metricId !== 'string') return null
  const id = metricId.toLowerCase()

  // biz.<dept>.<slug>
  if (id.startsWith('biz.')) {
    const dept = id.split('.')[1] ?? ''
    if (dept === 'finansy') return 'finance'
    if (dept === 'prodazhi') return 'sales'
    if (dept === 'marketing') return 'marketing'
    if (dept === 'operatsii') return 'operations'
    // HR / Продукт / Клиенты / Команда — fall through to operations as the
    // closest of the 5 PointA blocks (people & process == ops bucket).
    if (dept === 'hr' || dept === 'komanda') return 'operations'
    if (dept === 'produkt' || dept === 'klienty') return 'sales'
    return 'operations'
  }

  // kpi.* — most KPIs are financial ratios (ROE, ROI, margin, etc.)
  // A few revenue/sales KPIs land in sales; CAC/LTV in marketing.
  if (id.startsWith('kpi.')) {
    if (/cac|ltv|roas|roi_marketing|marketing/.test(id)) return 'marketing'
    if (/win_rate|conversion|deal|sales/.test(id)) return 'sales'
    if (/cycle|throughput|defect|delivery|sla|capacity/.test(id)) return 'operations'
    return 'finance'
  }

  // gri.* — per the GRI block taxonomy (lib/metrics/descriptions.ts).
  if (id.startsWith('gri.')) {
    // Бизнес-модель → strategy (unit economics, scalability)
    if (/biznes_model|business_model|model/.test(id)) return 'strategy'
    // Готовность основателя → strategy
    if (/founder|osnovatel/.test(id)) return 'strategy'
    // Доверие и позиция → marketing (positioning, brand)
    if (/doveri|trust|pozicii|position/.test(id)) return 'marketing'
    // Стабильность кассы → finance
    if (/kass|cash|stabilnost/.test(id)) return 'finance'
    // Продукт и спрос → sales (demand, product-market fit)
    if (/produkt|product|spros|demand/.test(id)) return 'sales'
    // Команда → operations (HR / org maturity)
    if (/komanda|team|hr/.test(id)) return 'operations'
    // Операции (GRI) → operations
    if (/operatsii|operations|process/.test(id)) return 'operations'
    return 'strategy'
  }

  // goal.* — strategy by default.
  if (id.startsWith('goal.')) {
    // A few goals are clearly sales/marketing — best-effort.
    if (/sales|conversion|deal|win_rate|prodazh/.test(id)) return 'sales'
    if (/cac|ltv|marketing|brand|traffic/.test(id)) return 'marketing'
    if (/cash|revenue|margin|cost|profit|finans/.test(id)) return 'finance'
    if (/cycle|throughput|process|delivery|operatsii/.test(id)) return 'operations'
    return 'strategy'
  }

  return null
}

/**
 * Compute per-block confidence from the resolved-metrics array.
 *
 * Rules:
 *   - A metric counts toward a block only if it has a non-null `picked`
 *     source (i.e. resolver actually found a value).
 *   - Block confidence = mean(confidence) across its contributing metrics.
 *   - If a block has zero contributing metrics, confidence = 0.5 (rule-based
 *     fallback — neither low nor high signal density).
 */
function deriveBlockConfidences(
  resolvedMetrics: MetricValue[] | undefined,
): { confidences: Record<Block, number>; metricToBlock: Record<string, Block> } {
  const sums: Record<Block, number> = {
    finance: 0, sales: 0, operations: 0, marketing: 0, strategy: 0,
  }
  const counts: Record<Block, number> = {
    finance: 0, sales: 0, operations: 0, marketing: 0, strategy: 0,
  }
  const metricToBlock: Record<string, Block> = {}

  if (resolvedMetrics && resolvedMetrics.length > 0) {
    for (const m of resolvedMetrics) {
      if (!m || !m.metricId) continue
      const block = classifyMetricToBlock(m.metricId)
      if (!block) continue
      metricToBlock[m.metricId] = block

      // Only resolved values lift confidence — misses don't contribute.
      if (m.picked === null || m.picked === undefined) continue
      const c = typeof m.confidence === 'number' && Number.isFinite(m.confidence)
        ? clamp01(m.confidence)
        : 0
      sums[block] += c
      counts[block] += 1
    }
  }

  const confidences: Record<Block, number> = {
    finance: 0.5, sales: 0.5, operations: 0.5, marketing: 0.5, strategy: 0.5,
  }
  for (const b of ALL_BLOCKS) {
    confidences[b] = counts[b] > 0 ? sums[b] / counts[b] : 0.5
  }
  return { confidences, metricToBlock }
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0
  if (v < 0) return 0
  if (v > 1) return 1
  return v
}

function clamp0to100(v: number): number {
  if (!Number.isFinite(v)) return 0
  if (v < 0) return 0
  if (v > 100) return 100
  return v
}

// ─── Public API ─────────────────────────────────────────────

export function scoreV2(input: ScoringV2Input): PointAScoreV2 {
  const { base, resolvedMetrics } = input
  const industry = normaliseIndustry(input.industry ?? null)
  const stage = normaliseStage(input.stage ?? null)

  // 1. Pick the industry × stage profile.
  const weight_profile = pickWeightProfile(industry, stage)

  // 2. Weighted overall.
  const blockScores: Record<Block, number> = {
    finance: base.blocks.finance.score,
    sales: base.blocks.sales.score,
    operations: base.blocks.operations.score,
    marketing: base.blocks.marketing.score,
    strategy: base.blocks.strategy.score,
  }
  const overall_score_v2 = clamp0to100(applyWeights(blockScores, weight_profile))

  // 3. Per-block confidence from resolved metrics.
  const { confidences, metricToBlock } = deriveBlockConfidences(resolvedMetrics)

  // 4. Benchmark lookup (industry-specific Russian label, falls back to null).
  const benchmarkIndustry = INDUSTRY_TO_BENCHMARK_NAME[industry] ?? null
  const benchmark = benchmarkIndustry
    ? findBenchmark(benchmarkIndustry, stage === 'all' ? null : stage)
    : null

  // 5. Build enriched block scores.
  const blocks_v2: Record<Block, BlockScoreV2> = {} as Record<Block, BlockScoreV2>
  for (const b of ALL_BLOCKS) {
    const baseBlock: BlockScore = base.blocks[b]
    const conf = clamp01(confidences[b])
    let percentile: number | null = null
    let rating: string | null = null
    if (benchmark) {
      percentile = percentileAgainstBenchmark(baseBlock.score, benchmark.blocks[b])
      rating = ratingLabel(percentile).label
    }
    const benchmarkPhrase = benchmark
      ? `На ${Math.round(percentile as number)}% перцентиле против индустрии (${rating}).`
      : 'Бенчмарк недоступен.'
    const confPct = Math.round(conf * 100)
    const rationale = `Базовая оценка ${baseBlock.score}/100. Уверенность ${confPct}%. ${benchmarkPhrase}`

    blocks_v2[b] = {
      ...baseBlock,
      confidence: conf,
      percentileVsBenchmark: percentile,
      benchmarkRating: rating,
      rationale,
    }
  }

  // 6. Calibrated overall: blend confidence with the weighted score.
  // Average confidence across blocks, weighted equally (each block matters
  // for our trust in the aggregate regardless of its weight in the score).
  const avgConfidence = ALL_BLOCKS.reduce((acc, b) => acc + confidences[b], 0) / ALL_BLOCKS.length
  let calibrated = overall_score_v2
  if (avgConfidence < 0.4) {
    calibrated = overall_score_v2 * 0.9
  } else if (avgConfidence > 0.8) {
    calibrated = overall_score_v2 * 1.05
  }
  calibrated = clamp0to100(calibrated)

  // 7. Top-level executive notes (Russian).
  const w = weight_profile.weights
  const pct = (n: number) => `${Math.round(n * 100)}%`
  const delta = overall_score_v2 - base.overall_score
  const deltaPhrase =
    Math.abs(delta) < 0.5
      ? 'совпадает с базовой оценкой'
      : delta > 0
        ? `выше базовой на ${delta.toFixed(1)} балла`
        : `ниже базовой на ${Math.abs(delta).toFixed(1)} балла`
  const notes =
    `По профилю «${industry}» × «${stage}» вес финансов ${pct(w.finance)}, ` +
    `продаж ${pct(w.sales)}, операций ${pct(w.operations)}, ` +
    `маркетинга ${pct(w.marketing)}, стратегии ${pct(w.strategy)}. ` +
    `Взвешенная оценка v2 = ${overall_score_v2.toFixed(1)} (${deltaPhrase}). ` +
    `Калиброванная оценка = ${calibrated.toFixed(1)} при общей уверенности ${pct(avgConfidence)}.`

  return {
    overall_score_v2,
    blocks_v2,
    overall_score_calibrated: calibrated,
    weight_profile,
    metric_to_block: metricToBlock,
    notes,
  }
}
