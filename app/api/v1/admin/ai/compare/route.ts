/**
 * GET /api/v1/admin/ai/compare?since=<iso>&until=<iso>
 *
 * Aggregates ai_runs metrics grouped by `backbone` (inngest | n8n | inline).
 * Returns per-backbone:
 *   - total runs
 *   - status breakdown (completed / failed / partial / running)
 *   - failure rate %
 *   - latency percentiles (p50, p95, avg)
 *   - cost (total + avg per run)
 *   - trigger breakdown
 *   - per-step success rate
 *
 * Used by /admin/ai/compare dashboard to pick the winner between
 * inngest and n8n async backbones.
 *
 * Default window: last 7 days. Admin/super_admin only.
 */

export const dynamic = 'force-dynamic'

import { NextResponse, type NextRequest } from 'next/server'

import { createServerClient } from '@/lib/supabase-server'

type Backbone = 'inngest' | 'n8n' | 'inline'
type Status = 'running' | 'completed' | 'failed' | 'partial'

interface AiRunRow {
  id: string
  backbone: Backbone
  status: Status
  trigger: string
  steps: Array<{ name: string; status: string; duration_ms?: number }>
  total_cost_usd: number | null
  started_at: string
  finished_at: string | null
}

export interface BackboneMetrics {
  backbone: Backbone
  total: number
  status: Record<Status, number>
  failureRate: number
  triggers: Record<string, number>
  latency: {
    avgMs: number | null
    p50Ms: number | null
    p95Ms: number | null
  }
  cost: {
    totalUsd: number
    avgUsd: number | null
  }
  steps: Record<string, { completed: number; failed: number; skipped: number }>
}

export interface CompareResponse {
  since: string
  until: string
  backbones: BackboneMetrics[]
  /** High-level summary for quick reading. */
  summary: {
    totalRuns: number
    winnerBackbone: Backbone | null
    winnerReason: string
  }
}

export async function GET(req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user?.id) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const { data: profile } = await sb
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile || !['admin', 'super_admin'].includes(profile.role)) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  const until = req.nextUrl.searchParams.get('until') ?? new Date().toISOString()
  const defaultSince = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const since = req.nextUrl.searchParams.get('since') ?? defaultSince

  const { data, error } = await sb
    .from('ai_runs')
    .select('id, backbone, status, trigger, steps, total_cost_usd, started_at, finished_at')
    .gte('started_at', since)
    .lte('started_at', until)
    .order('started_at', { ascending: false })
    .limit(5000)

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  const rows = (data ?? []) as AiRunRow[]
  const byBackbone = new Map<Backbone, AiRunRow[]>()
  for (const r of rows) {
    const bucket = byBackbone.get(r.backbone) ?? []
    bucket.push(r)
    byBackbone.set(r.backbone, bucket)
  }

  const backbones: BackboneMetrics[] = []
  for (const [backbone, subset] of byBackbone) {
    backbones.push(aggregate(backbone, subset))
  }
  backbones.sort((a, b) => b.total - a.total)

  const summary = pickWinner(backbones)

  const payload: CompareResponse = {
    since,
    until,
    backbones,
    summary,
  }

  return NextResponse.json({ ok: true, data: payload })
}

// -----------------------------------------------------------------------------

function aggregate(backbone: Backbone, rows: AiRunRow[]): BackboneMetrics {
  const status: Record<Status, number> = { running: 0, completed: 0, failed: 0, partial: 0 }
  const triggers: Record<string, number> = {}
  const steps: BackboneMetrics['steps'] = {}

  const durationsMs: number[] = []
  let totalCost = 0
  let costRows = 0

  for (const r of rows) {
    status[r.status] = (status[r.status] ?? 0) + 1
    triggers[r.trigger] = (triggers[r.trigger] ?? 0) + 1

    if (r.finished_at) {
      const d = new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()
      if (Number.isFinite(d) && d >= 0) durationsMs.push(d)
    }

    if (typeof r.total_cost_usd === 'number') {
      totalCost += r.total_cost_usd
      costRows += 1
    }

    for (const s of r.steps ?? []) {
      const bucket = (steps[s.name] = steps[s.name] ?? { completed: 0, failed: 0, skipped: 0 })
      if (s.status === 'completed') bucket.completed += 1
      else if (s.status === 'failed') bucket.failed += 1
      else if (s.status === 'skipped') bucket.skipped += 1
    }
  }

  const total = rows.length
  const failureRate = total > 0 ? status.failed / total : 0

  return {
    backbone,
    total,
    status,
    failureRate: Number(failureRate.toFixed(4)),
    triggers,
    latency: {
      avgMs: avg(durationsMs),
      p50Ms: percentile(durationsMs, 0.5),
      p95Ms: percentile(durationsMs, 0.95),
    },
    cost: {
      totalUsd: Number(totalCost.toFixed(4)),
      avgUsd: costRows > 0 ? Number((totalCost / costRows).toFixed(4)) : null,
    },
    steps,
  }
}

function avg(vals: number[]): number | null {
  if (!vals.length) return null
  return Math.round(vals.reduce((s, n) => s + n, 0) / vals.length)
}

function percentile(vals: number[], p: number): number | null {
  if (!vals.length) return null
  const sorted = [...vals].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length))
  return sorted[idx]
}

/**
 * Winner rules (in order):
 *   1. Only 'inngest' and 'n8n' compete — 'inline' is for dev, ignored.
 *   2. Backbone with <10 runs is excluded (not enough data).
 *   3. Failure rate gap > 5pp → lower-failure wins.
 *   4. Otherwise p95 latency gap > 20% → faster wins.
 *   5. Otherwise cost gap > 20% → cheaper wins.
 *   6. Else "tie" — manual call.
 */
function pickWinner(backbones: BackboneMetrics[]): CompareResponse['summary'] {
  const total = backbones.reduce((s, b) => s + b.total, 0)
  const contenders = backbones.filter(
    (b) => (b.backbone === 'inngest' || b.backbone === 'n8n') && b.total >= 10
  )

  if (contenders.length < 2) {
    return {
      totalRuns: total,
      winnerBackbone: null,
      winnerReason:
        contenders.length === 0
          ? 'Нет runs у inngest / n8n — загрузи тестовые файлы'
          : `Только ${contenders[0].backbone} имеет >= 10 runs`,
    }
  }

  const [a, b] = contenders

  const failureGap = Math.abs(a.failureRate - b.failureRate)
  if (failureGap > 0.05) {
    const winner = a.failureRate < b.failureRate ? a : b
    return {
      totalRuns: total,
      winnerBackbone: winner.backbone,
      winnerReason: `${winner.backbone} имеет ниже failure rate: ${(winner.failureRate * 100).toFixed(1)}% vs ${((failureGap + winner.failureRate) * 100).toFixed(1)}%`,
    }
  }

  const p95a = a.latency.p95Ms
  const p95b = b.latency.p95Ms
  if (p95a && p95b) {
    const ratio = Math.max(p95a, p95b) / Math.min(p95a, p95b)
    if (ratio > 1.2) {
      const winner = p95a < p95b ? a : b
      return {
        totalRuns: total,
        winnerBackbone: winner.backbone,
        winnerReason: `${winner.backbone} быстрее по p95: ${winner.latency.p95Ms}ms`,
      }
    }
  }

  const costa = a.cost.avgUsd
  const costb = b.cost.avgUsd
  if (costa && costb) {
    const ratio = Math.max(costa, costb) / Math.min(costa, costb)
    if (ratio > 1.2) {
      const winner = costa < costb ? a : b
      return {
        totalRuns: total,
        winnerBackbone: winner.backbone,
        winnerReason: `${winner.backbone} дешевле: $${winner.cost.avgUsd} avg`,
      }
    }
  }

  return {
    totalRuns: total,
    winnerBackbone: null,
    winnerReason: 'Ничья в рамках порогов — решай по dev experience',
  }
}
