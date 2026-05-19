/**
 * Industry benchmarks for Point A diagnostic scoring.
 *
 * Static curated dataset. Each row represents the median block + overall scores
 * for a given (industry, stage) pair. The comparison helpers convert raw scores
 * into percentiles vs. the benchmark and translate those into human ratings.
 *
 * NOTE: Values are curated estimates, not survey-derived. Replace with
 * community/aggregated data once we have enough diagnostics to power it.
 */

export type BenchmarkStage = 'seed' | 'early' | 'growth' | 'scale' | 'mature' | 'all'

export interface BenchmarkBlockData {
  industry: string
  stage: BenchmarkStage
  blocks: {
    finance: number
    sales: number
    operations: number
    marketing: number
    strategy: number
  }
  overall: number
  /** n that produced these benchmarks (synthetic for curated rows) */
  sampleSize: number
  source: 'curated' | 'community'
  /** ISO timestamp */
  updatedAt: string
}

export type BenchmarkBlockKey = keyof BenchmarkBlockData['blocks']

const UPDATED_AT = '2026-05-19T00:00:00.000Z'

/**
 * Static dataset. Covers 8 industries, each with an 'all'-stage row plus at
 * least one stage-specific override. Numbers reflect rough operational maturity
 * we'd expect from a representative SMB in that segment.
 */
export const BENCHMARKS: BenchmarkBlockData[] = [
  // 1. Розничная торговля
  {
    industry: 'Розничная торговля',
    stage: 'all',
    blocks: { finance: 58, sales: 62, operations: 60, marketing: 50, strategy: 48 },
    overall: 56,
    sampleSize: 240,
    source: 'curated',
    updatedAt: UPDATED_AT,
  },
  {
    industry: 'Розничная торговля',
    stage: 'early',
    blocks: { finance: 45, sales: 50, operations: 48, marketing: 40, strategy: 38 },
    overall: 45,
    sampleSize: 95,
    source: 'curated',
    updatedAt: UPDATED_AT,
  },
  {
    industry: 'Розничная торговля',
    stage: 'growth',
    blocks: { finance: 62, sales: 68, operations: 65, marketing: 55, strategy: 52 },
    overall: 61,
    sampleSize: 110,
    source: 'curated',
    updatedAt: UPDATED_AT,
  },

  // 2. Электронная коммерция
  {
    industry: 'Электронная коммерция',
    stage: 'all',
    blocks: { finance: 60, sales: 68, operations: 58, marketing: 70, strategy: 55 },
    overall: 62,
    sampleSize: 180,
    source: 'curated',
    updatedAt: UPDATED_AT,
  },
  {
    industry: 'Электронная коммерция',
    stage: 'early',
    blocks: { finance: 48, sales: 55, operations: 45, marketing: 60, strategy: 45 },
    overall: 51,
    sampleSize: 70,
    source: 'curated',
    updatedAt: UPDATED_AT,
  },
  {
    industry: 'Электронная коммерция',
    stage: 'scale',
    blocks: { finance: 68, sales: 75, operations: 66, marketing: 78, strategy: 65 },
    overall: 70,
    sampleSize: 60,
    source: 'curated',
    updatedAt: UPDATED_AT,
  },

  // 3. B2B SaaS
  {
    industry: 'B2B SaaS',
    stage: 'all',
    blocks: { finance: 65, sales: 70, operations: 62, marketing: 65, strategy: 68 },
    overall: 66,
    sampleSize: 150,
    source: 'curated',
    updatedAt: UPDATED_AT,
  },
  {
    industry: 'B2B SaaS',
    stage: 'seed',
    blocks: { finance: 45, sales: 50, operations: 50, marketing: 48, strategy: 55 },
    overall: 49,
    sampleSize: 50,
    source: 'curated',
    updatedAt: UPDATED_AT,
  },
  {
    industry: 'B2B SaaS',
    stage: 'growth',
    blocks: { finance: 68, sales: 75, operations: 65, marketing: 70, strategy: 72 },
    overall: 70,
    sampleSize: 70,
    source: 'curated',
    updatedAt: UPDATED_AT,
  },

  // 4. Услуги
  {
    industry: 'Услуги',
    stage: 'all',
    blocks: { finance: 52, sales: 55, operations: 50, marketing: 45, strategy: 45 },
    overall: 50,
    sampleSize: 200,
    source: 'curated',
    updatedAt: UPDATED_AT,
  },
  {
    industry: 'Услуги',
    stage: 'early',
    blocks: { finance: 40, sales: 45, operations: 42, marketing: 35, strategy: 35 },
    overall: 40,
    sampleSize: 90,
    source: 'curated',
    updatedAt: UPDATED_AT,
  },
  {
    industry: 'Услуги',
    stage: 'mature',
    blocks: { finance: 65, sales: 65, operations: 62, marketing: 55, strategy: 58 },
    overall: 61,
    sampleSize: 50,
    source: 'curated',
    updatedAt: UPDATED_AT,
  },

  // 5. Производство
  {
    industry: 'Производство',
    stage: 'all',
    blocks: { finance: 60, sales: 55, operations: 68, marketing: 42, strategy: 52 },
    overall: 56,
    sampleSize: 170,
    source: 'curated',
    updatedAt: UPDATED_AT,
  },
  {
    industry: 'Производство',
    stage: 'growth',
    blocks: { finance: 65, sales: 60, operations: 72, marketing: 48, strategy: 58 },
    overall: 61,
    sampleSize: 80,
    source: 'curated',
    updatedAt: UPDATED_AT,
  },
  {
    industry: 'Производство',
    stage: 'mature',
    blocks: { finance: 70, sales: 62, operations: 78, marketing: 50, strategy: 62 },
    overall: 65,
    sampleSize: 60,
    source: 'curated',
    updatedAt: UPDATED_AT,
  },

  // 6. Общепит / HoReCa
  {
    industry: 'Общепит / HoReCa',
    stage: 'all',
    blocks: { finance: 50, sales: 60, operations: 55, marketing: 52, strategy: 42 },
    overall: 52,
    sampleSize: 210,
    source: 'curated',
    updatedAt: UPDATED_AT,
  },
  {
    industry: 'Общепит / HoReCa',
    stage: 'early',
    blocks: { finance: 38, sales: 48, operations: 45, marketing: 42, strategy: 35 },
    overall: 42,
    sampleSize: 110,
    source: 'curated',
    updatedAt: UPDATED_AT,
  },
  {
    industry: 'Общепит / HoReCa',
    stage: 'growth',
    blocks: { finance: 55, sales: 65, operations: 60, marketing: 58, strategy: 48 },
    overall: 57,
    sampleSize: 70,
    source: 'curated',
    updatedAt: UPDATED_AT,
  },

  // 7. Образование
  {
    industry: 'Образование',
    stage: 'all',
    blocks: { finance: 48, sales: 50, operations: 55, marketing: 52, strategy: 50 },
    overall: 51,
    sampleSize: 140,
    source: 'curated',
    updatedAt: UPDATED_AT,
  },
  {
    industry: 'Образование',
    stage: 'seed',
    blocks: { finance: 35, sales: 38, operations: 42, marketing: 45, strategy: 42 },
    overall: 40,
    sampleSize: 50,
    source: 'curated',
    updatedAt: UPDATED_AT,
  },
  {
    industry: 'Образование',
    stage: 'growth',
    blocks: { finance: 55, sales: 58, operations: 60, marketing: 60, strategy: 58 },
    overall: 58,
    sampleSize: 60,
    source: 'curated',
    updatedAt: UPDATED_AT,
  },

  // 8. Медицина / клиники
  {
    industry: 'Медицина / клиники',
    stage: 'all',
    blocks: { finance: 62, sales: 55, operations: 68, marketing: 48, strategy: 55 },
    overall: 58,
    sampleSize: 130,
    source: 'curated',
    updatedAt: UPDATED_AT,
  },
  {
    industry: 'Медицина / клиники',
    stage: 'early',
    blocks: { finance: 48, sales: 45, operations: 55, marketing: 40, strategy: 45 },
    overall: 47,
    sampleSize: 50,
    source: 'curated',
    updatedAt: UPDATED_AT,
  },
  {
    industry: 'Медицина / клиники',
    stage: 'mature',
    blocks: { finance: 72, sales: 62, operations: 78, marketing: 55, strategy: 65 },
    overall: 66,
    sampleSize: 50,
    source: 'curated',
    updatedAt: UPDATED_AT,
  },
]

const KNOWN_STAGES: ReadonlySet<BenchmarkStage> = new Set<BenchmarkStage>([
  'seed',
  'early',
  'growth',
  'scale',
  'mature',
  'all',
])

function normalizeIndustry(value: string): string {
  return value.trim().toLocaleLowerCase('ru')
}

function normalizeStage(stage: string | null | undefined): BenchmarkStage | null {
  if (!stage) return null
  const lower = stage.trim().toLocaleLowerCase('en') as BenchmarkStage
  return KNOWN_STAGES.has(lower) ? lower : null
}

/**
 * Find the most relevant benchmark row.
 * - Industry is matched case-insensitively.
 * - If `stage` matches a stage-specific row, return that row.
 * - Else fall back to the 'all'-stage row for the industry.
 * - Returns null if the industry isn't known.
 */
export function findBenchmark(
  industry: string | null,
  stage: string | null,
): BenchmarkBlockData | null {
  if (!industry) return null
  const wanted = normalizeIndustry(industry)
  const rowsForIndustry = BENCHMARKS.filter(
    (row) => normalizeIndustry(row.industry) === wanted,
  )
  if (rowsForIndustry.length === 0) return null

  const wantedStage = normalizeStage(stage)
  if (wantedStage && wantedStage !== 'all') {
    const exact = rowsForIndustry.find((row) => row.stage === wantedStage)
    if (exact) return exact
  }

  return rowsForIndustry.find((row) => row.stage === 'all') ?? rowsForIndustry[0] ?? null
}

/**
 * Translate a raw score (0..100) into a percentile (0..100) versus a benchmark
 * median. We assume the benchmark represents the 50th percentile and use a
 * piecewise-linear mapping so that:
 *   - score === benchmark → 50
 *   - score === 100       → 100
 *   - score === 0         → 0
 *
 * The slope on each side is calibrated by the distance from the benchmark to
 * the extremes, so an above-median benchmark naturally compresses the upper
 * range and vice-versa.
 */
export function percentileAgainstBenchmark(score: number, benchmark: number): number {
  const s = clamp(score, 0, 100)
  const b = clamp(benchmark, 0, 100)

  if (s === b) return 50
  if (s > b) {
    const range = 100 - b
    if (range <= 0) return 100
    const ratio = (s - b) / range
    return clamp(50 + ratio * 50, 0, 100)
  }
  const range = b
  if (range <= 0) return 0
  const ratio = (b - s) / range
  return clamp(50 - ratio * 50, 0, 100)
}

export interface BenchmarkRating {
  label: string
  tone: 'strong' | 'average' | 'weak'
}

/**
 * Map a percentile (0..100) to a human label.
 *   ≥ 75 → strong  "Выше среднего"
 *   ≥ 40 → average "На уровне"
 *   < 40 → weak    "Ниже среднего"
 */
export function ratingLabel(percentile: number): BenchmarkRating {
  const p = clamp(percentile, 0, 100)
  if (p >= 75) return { label: 'Выше среднего', tone: 'strong' }
  if (p >= 40) return { label: 'На уровне', tone: 'average' }
  return { label: 'Ниже среднего', tone: 'weak' }
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  if (value < min) return min
  if (value > max) return max
  return value
}
