// ============================================================
// GET /api/v1/point-a/block/[key][?companyId=] — «Подробнее» of a Point A
// block: the block of the latest snapshot (score, coverage, checks, what is
// missing, recommendations) and every catalog metric of the section with its
// real value, period, source, description, norm and dynamics
// (lib/point-a/v4/metric-views.ts). Read with the caller's session (RLS).
// ============================================================
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveTenantWith, tenantErrorMessage } from '@/lib/tenancy'
import { apiError } from '@/lib/api-error'
import { BLOCK_LIBRARY, isBlockKey } from '@/lib/point-a/v4/config'
import { blockMetricIds, loadMetricViews } from '@/lib/point-a/v4/metric-views'
import type { V4Block } from '@/lib/point-a/v4/engine'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: { key: string } }): Promise<NextResponse> {
  if (!isBlockKey(params.key)) return apiError('Раздел не найден', 404)
  const key = params.key
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError(tenantErrorMessage('unauthenticated'), 401)
  const tenant = await resolveTenantWith(supabase, user.id, { companyId: new URL(req.url).searchParams.get('companyId'), access: 'read' })
  if (!tenant.ok) return apiError(tenantErrorMessage(tenant.error), tenant.status)
  const companyId = tenant.tenant.companyId
  try {
    const [snap, metrics] = await Promise.all([
      supabase.from('point_a_snapshots').select('blocks, created_at').eq('company_id', companyId).order('created_at', { ascending: false }).limit(1),
      loadMetricViews(supabase, companyId, blockMetricIds(key)),
    ])
    const blocks = ((snap.data ?? [])[0]?.blocks ?? []) as V4Block[]
    return NextResponse.json({
      ok: true,
      data: {
        key,
        title: BLOCK_LIBRARY[key].title,
        description: BLOCK_LIBRARY[key].description,
        block: blocks.find((b) => b.key === key) ?? null,
        // values first, then the ones still missing
        metrics: [...metrics.filter((m) => m.value !== null), ...metrics.filter((m) => m.value === null)],
      },
    })
  } catch (err) {
    console.error('[api/v1/point-a/block] read failed', err instanceof Error ? err.message : err)
    return apiError('Не удалось загрузить раздел', 500)
  }
}
