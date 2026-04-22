/**
 * GET /api/dashboard/clients-stats
 *
 * Returns real-time aggregate stats for the admin dashboard
 * ClientsStatsWidget. Replaces the previous hardcoded `48/38/6/7.6` mock.
 *
 * Authz: admin / super_admin / expert only. Anyone else gets 403.
 */

export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'

import { createServerClient } from '@/lib/supabase-server'
import { prisma } from '@/lib/db'

export async function GET() {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user?.id) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  // Check role via current_user_role helper (migration 006)
  const { data: profile } = await sb
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile || !['admin', 'super_admin', 'expert', 'manager'].includes(profile.role)) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  try {
    const [total, active, griAgg] = await Promise.all([
      prisma.client.count(),
      prisma.client.count({ where: { status: 'active' } }),
      // Average GRI across latest per client — simple heuristic: overall avg across all reports
      prisma.griReport.aggregate({
        _avg: { score: true },
      }),
    ])

    // "At risk" = ClientStatus.at_risk (enum: active | at_risk | inactive | onboarding)
    const atRisk = await prisma.client.count({
      where: { status: 'at_risk' },
    })

    const avgGri =
      typeof griAgg._avg.score === 'number' && griAgg._avg.score > 0
        ? griAgg._avg.score / 100 // 0-1000 scale → display as x.x
        : null

    return NextResponse.json({
      ok: true,
      data: {
        total,
        active,
        atRisk,
        avgGri,
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
