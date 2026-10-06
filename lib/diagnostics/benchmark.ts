/**
 * lib/diagnostics/benchmark.ts — Point A block scores against the curated
 * industry benchmarks of lib/point-a/benchmarks.ts (agent `benchmark`, no LLM).
 *
 * The benchmark rows are expert estimates of the AIStart360 methodology, not
 * statistics over real companies, so every finding says so in its text and
 * evidence, and carries a moderate confidence. Only clear deviations become
 * findings: a block ≥ 15 points below the benchmark (gap) or ≥ 15 above
 * (strength). Unknown industry → no findings (and the stage says why).
 */
import type { BlockScore, PointA } from '@/types/onboarding'
import { findBenchmark, type BenchmarkBlockKey } from '@/lib/point-a/benchmarks'
import type { FindingDraft } from './findings-store'

export const BENCHMARK_SOURCE_LABEL = 'Ориентир методики AIStart360 (экспертная оценка, не статистика рынка)'
export const BENCHMARK_DEVIATION = 15
export const BENCHMARK_CONFIDENCE = 0.5

const BLOCK_AREA: Record<BenchmarkBlockKey, { area: string; label: string }> = {
  finance: { area: 'finance', label: 'Финансы' },
  sales: { area: 'sales', label: 'Продажи' },
  operations: { area: 'operations', label: 'Операции' },
  marketing: { area: 'marketing', label: 'Маркетинг' },
  strategy: { area: 'management', label: 'Стратегия' },
}

export interface BenchmarkResult {
  findings: FindingDraft[]
  /** Why nothing was compared (unknown industry), for the stage summary. */
  skippedReason: string | null
  benchmark: { industry: string; stage: string } | null
}

export function benchmarkFindings(args: {
  pointA: PointA
  industry: string | null
  stage: string | null
  diagnosticId: string
}): BenchmarkResult {
  const row = findBenchmark(args.industry, args.stage ?? args.pointA.stage)
  if (!row) {
    return {
      findings: [],
      skippedReason: args.industry
        ? `для отрасли «${args.industry}» нет ориентиров методики`
        : 'отрасль компании не указана',
      benchmark: null,
    }
  }
  const findings: FindingDraft[] = []
  for (const key of Object.keys(BLOCK_AREA) as BenchmarkBlockKey[]) {
    const block: BlockScore | undefined = args.pointA.blocks[key]
    if (!block || typeof block.score !== 'number') continue
    // A block with nothing to score (possible = 0) says nothing about the company.
    if (block.possible === 0) continue
    const bench = row.blocks[key]
    const delta = block.score - bench
    if (Math.abs(delta) < BENCHMARK_DEVIATION) continue
    const { area, label } = BLOCK_AREA[key]
    const below = delta < 0
    findings.push({
      key: `benchmark:${key}`,
      kind: below ? 'gap' : 'strength',
      area,
      title: below
        ? `«${label}»: ${block.score}/100 — на ${-delta} п. ниже ориентира отрасли`
        : `«${label}»: ${block.score}/100 — на ${delta} п. выше ориентира отрасли`,
      body: `Ориентир для «${row.industry}» (${row.stage === 'all' ? 'все стадии' : `стадия ${row.stage}`}): ${bench}/100. ${BENCHMARK_SOURCE_LABEL}.`,
      severity: below ? (delta <= -30 ? 'high' : 'medium') : 'info',
      provenance: 'CALCULATED',
      confidence: BENCHMARK_CONFIDENCE,
      evidence: [
        { type: 'diagnostic', ref: args.diagnosticId, field: `${key}_score`, value: block.score },
        { type: 'benchmark', ref: `${row.industry}|${row.stage}`, field: key, value: bench, benchmark_source: row.source, label: BENCHMARK_SOURCE_LABEL },
      ],
    })
  }
  return { findings, skippedReason: null, benchmark: { industry: row.industry, stage: row.stage } }
}
