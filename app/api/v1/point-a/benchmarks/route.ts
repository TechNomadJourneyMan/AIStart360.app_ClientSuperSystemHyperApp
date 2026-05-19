export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import {
  BENCHMARKS,
  findBenchmark,
  percentileAgainstBenchmark,
  ratingLabel,
  type BenchmarkBlockData,
  type BenchmarkBlockKey,
  type BenchmarkRating,
} from '@/lib/point-a/benchmarks'

const BLOCK_KEYS: BenchmarkBlockKey[] = [
  'finance',
  'sales',
  'operations',
  'marketing',
  'strategy',
]

interface BlockComparison {
  block: BenchmarkBlockKey | 'overall'
  score: number
  benchmark: number
  percentile: number
  rating: BenchmarkRating
}

interface ComparisonPayload {
  /** Per-block comparison plus the rolled-up 'overall' entry. */
  blocks: BlockComparison[]
  diagnosticId: string | null
  computedAt: string | null
}

interface ResponseBody {
  ok: true
  data: {
    benchmark: BenchmarkBlockData | null
    comparison: ComparisonPayload | null
    /** Raw list available for clients that want to render a picker. */
    available: { industry: string; stage: BenchmarkBlockData['stage'] }[]
  }
}

function extractScore(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const candidate = obj.score ?? obj.value
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate
  }
  return null
}

function buildComparison(
  benchmark: BenchmarkBlockData,
  diagnostic: Record<string, unknown> | null,
): ComparisonPayload | null {
  if (!diagnostic) return null

  const rawBlocks = (diagnostic.blocks ?? null) as Record<string, unknown> | null
  if (!rawBlocks) return null

  const blocks: BlockComparison[] = []
  for (const key of BLOCK_KEYS) {
    const score = extractScore(rawBlocks[key])
    if (score === null) continue
    const benchScore = benchmark.blocks[key]
    const percentile = percentileAgainstBenchmark(score, benchScore)
    blocks.push({
      block: key,
      score,
      benchmark: benchScore,
      percentile,
      rating: ratingLabel(percentile),
    })
  }

  const overallScore =
    extractScore(diagnostic.overall_score) ??
    extractScore((diagnostic as Record<string, unknown>).overall)
  if (overallScore !== null) {
    const percentile = percentileAgainstBenchmark(overallScore, benchmark.overall)
    blocks.push({
      block: 'overall',
      score: overallScore,
      benchmark: benchmark.overall,
      percentile,
      rating: ratingLabel(percentile),
    })
  }

  if (blocks.length === 0) return null

  return {
    blocks,
    diagnosticId: (diagnostic.id as string | undefined) ?? null,
    computedAt:
      (diagnostic.computed_at as string | undefined) ??
      (diagnostic.created_at as string | undefined) ??
      null,
  }
}

/**
 * GET /api/v1/point-a/benchmarks?industry=X&stage=Y[&user_id=Z]
 *
 * Returns the matching benchmark row plus, when a current diagnostic exists,
 * a per-block comparison (percentile + rating). If no diagnostic is available
 * the `comparison` field is null and clients should render the benchmark alone.
 */
export async function GET(req: NextRequest) {
  try {
    const url = req.nextUrl
    const industry = url.searchParams.get('industry')
    const stage = url.searchParams.get('stage')
    const explicitUserId = url.searchParams.get('user_id')

    const benchmark = findBenchmark(industry, stage)

    const available = BENCHMARKS.map((row) => ({
      industry: row.industry,
      stage: row.stage,
    }))

    if (!benchmark) {
      const body: ResponseBody = {
        ok: true,
        data: { benchmark: null, comparison: null, available },
      }
      return NextResponse.json(body)
    }

    const supabase = createServerClient()

    let userId: string | null = explicitUserId
    if (!userId) {
      const { data: auth } = await supabase.auth.getUser()
      userId = auth?.user?.id ?? null
    }

    let comparison: ComparisonPayload | null = null
    if (userId) {
      const { data: diagnostic, error } = await supabase
        .from('diagnostics')
        .select('*')
        .eq('user_id', userId)
        .eq('is_current', true)
        .maybeSingle()

      if (!error && diagnostic) {
        comparison = buildComparison(benchmark, diagnostic as Record<string, unknown>)
      }
    }

    const body: ResponseBody = {
      ok: true,
      data: { benchmark, comparison, available },
    }
    return NextResponse.json(body)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    return NextResponse.json(
      { ok: false, error: `benchmarks route failed: ${message}` },
      { status: 500 },
    )
  }
}
