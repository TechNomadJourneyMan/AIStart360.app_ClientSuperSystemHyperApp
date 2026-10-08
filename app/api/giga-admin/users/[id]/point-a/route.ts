export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { guardClientAccess } from '@/lib/admin/client-scope'
import { createServiceClient } from '@/lib/supabase-service'
import { POINT_A_BLOCKS, listItems, pointABlock } from '@/lib/admin/expert-client-data'

/**
 * GET /api/giga-admin/users/:id/point-a — Точка А клиента для вкладки User 360.
 *
 * Читает канонические таблицы: текущую строку `diagnostics` (блоки, риски,
 * инсайты, разбор ИИ) и текущий замер `gri_assessments`. Ничего не
 * подставляет: нет диагностики — `diagnostic: null`, и вкладка показывает
 * пустое состояние, а не выдуманные баллы.
 */

interface RoadmapStage { goals?: unknown; actions?: unknown }

function textList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, 8) : []
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, ['users.view', 'users.sensitive'])
  if (guard.response) return guard.response
  const scopeDenied = await guardClientAccess(guard.actor, params.id)
  if (scopeDenied) return scopeDenied

  const sb = createServiceClient()
  const [diagRes, historyRes, griRes] = await Promise.all([
    sb.from('diagnostics').select('*').eq('user_id', params.id).eq('is_current', true).order('calculated_at', { ascending: false }).limit(1),
    sb.from('diagnostics').select('id, overall_score, health_index, calculated_at').eq('user_id', params.id).order('calculated_at', { ascending: false }).limit(12),
    sb.from('gri_assessments').select('id, gri_index, section_avgs, top_5_limits, created_at').eq('user_id', params.id).eq('is_current', true).limit(1),
  ])
  if (diagRes.error) return NextResponse.json({ ok: false, error: 'Не удалось загрузить Точку А' }, { status: 500 })

  const diag = ((diagRes.data ?? [])[0] ?? null) as Record<string, unknown> | null
  const gri = ((griRes.data ?? [])[0] ?? null) as { id: string; gri_index: number | string; section_avgs: Record<string, number> | null; top_5_limits: unknown; created_at: string } | null

  const ai = (diag?.ai_analysis ?? null) as {
    executive_summary?: unknown
    strategic_priorities?: unknown
    growth_roadmap?: Record<string, RoadmapStage>
    industry_context?: { description?: unknown }
  } | null

  const num = (v: unknown) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v))

  return NextResponse.json({
    ok: true,
    data: {
      diagnostic: diag
        ? {
            id: String(diag.id),
            overallScore: num(diag.overall_score),
            healthIndex: num(diag.health_index),
            stage: (diag.stage as string | null) ?? null,
            calculatedAt: (diag.calculated_at as string | null) ?? null,
            aiStatus: (diag.ai_status as string | null) ?? null,
            blocks: POINT_A_BLOCKS.map((b) => pointABlock(diag, b.id, b.label, b.column)),
            risks: listItems(diag.risks),
            insights: listItems(diag.insights),
            quickWins: listItems(diag.quick_wins),
            dataGaps: listItems(diag.data_gaps),
            summary: typeof ai?.executive_summary === 'string' ? ai.executive_summary : null,
            priorities: listItems(ai?.strategic_priorities),
            roadmap: (['30_days', '90_days', '180_days'] as const).map((k) => ({
              key: k,
              goals: textList(ai?.growth_roadmap?.[k]?.goals),
              actions: textList(ai?.growth_roadmap?.[k]?.actions),
            })).filter((r) => r.goals.length || r.actions.length),
            industryContext: typeof ai?.industry_context?.description === 'string' ? ai.industry_context.description : null,
          }
        : null,
      history: (historyRes.data ?? []).map((h) => ({
        id: h.id as string,
        overallScore: num(h.overall_score),
        healthIndex: num(h.health_index),
        calculatedAt: h.calculated_at as string,
      })),
      gri: gri
        ? { id: gri.id, index: Number(gri.gri_index), sectionAvgs: gri.section_avgs ?? {}, top5: listItems(gri.top_5_limits, 5), assessedAt: gri.created_at }
        : null,
    },
  })
}
