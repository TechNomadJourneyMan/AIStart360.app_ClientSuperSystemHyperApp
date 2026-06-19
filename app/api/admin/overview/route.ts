export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { GIGA_COOKIE_NAME, verifyGigaRole } from '@/lib/giga-cookie'
import { srGet } from '@/lib/expert-auth'

/**
 * GET /api/admin/overview
 *
 * Real aggregates for the admin overview tab — replaces the former hardcoded
 * mock. Auth is checked via the session (own profile role, RLS-safe) or the
 * signed super-admin giga cookie. Aggregate DATA is read via service-role
 * (srGet) so RLS doesn't limit counts to the caller's own rows — see
 * lib/supabase-server.ts note. Absent data → 0 / empty, never fabricated.
 */

type SB = ReturnType<typeof createServerClient>

async function isAdmin(req: NextRequest, sb: SB): Promise<boolean> {
  if (verifyGigaRole(req.cookies.get(GIGA_COOKIE_NAME)?.value) === 'super_admin') return true
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return false
  const { data: prof } = await sb.from('profiles').select('role').eq('id', user.id).maybeSingle()
  return prof?.role === 'admin' || prof?.role === 'super_admin'
}

const fmtTimeAgo = (iso: string | null): string => {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const h = Math.floor(diff / 3_600_000)
  if (h < 1) return 'только что'
  if (h < 24) return `${h}ч`
  return `${Math.floor(h / 24)}д`
}

const len = (rows: unknown): number => (Array.isArray(rows) ? rows.length : 0)

export async function GET(req: NextRequest) {
  const sb = createServerClient()
  if (!(await isAdmin(req, sb))) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  }

  try {
    // All aggregate reads go through the service role (RLS bypass). Tables are
    // small, so we fetch minimal columns and count in JS.
    const [roleRows, companies, diagnostics, documents, metrics, marketSnap, pointB, pointAIns, griRows, reqRows,
      recentDiag, recentUsers, recentReq] = await Promise.all([
      srGet<Array<{ role: string | null }>>('profiles?select=role'),
      srGet<Array<{ id: string }>>('companies?select=id'),
      srGet<Array<{ id: string }>>('diagnostics?select=id'),
      srGet<Array<{ id: string }>>('documents?select=id'),
      srGet<Array<{ id: string }>>('metrics?select=id'),
      srGet<Array<{ id: string }>>('market_snapshots?select=id'),
      srGet<Array<{ id: string }>>('point_b_analysis?select=id'),
      srGet<Array<{ id: string }>>('point_a_insights?select=id'),
      srGet<Array<{ gri_index: number | null }>>('gri_assessments?select=gri_index&is_current=eq.true'),
      srGet<Array<{ status: string | null }>>('admin_requests?select=status'),
      srGet<Array<Record<string, unknown>>>('diagnostics?select=user_id,overall_score,stage,calculated_at&order=calculated_at.desc&limit=4'),
      srGet<Array<Record<string, unknown>>>('profiles?select=full_name,role,created_at&order=created_at.desc&limit=4'),
      srGet<Array<Record<string, unknown>>>('admin_requests?select=type,status,createdAt&order=createdAt.desc&limit=4'),
    ])

    const byRole: Record<string, number> = {}
    for (const r of roleRows ?? []) byRole[(r.role ?? 'unknown')] = (byRole[(r.role ?? 'unknown')] ?? 0) + 1
    const totalUsers = len(roleRows)

    // GRI: avg + distribution
    const griVals = (griRows ?? []).map((g) => Number(g.gri_index)).filter((n) => Number.isFinite(n) && n > 0)
    const griAvg = griVals.length ? griVals.reduce((a, b) => a + b, 0) / griVals.length : null
    const griDistribution = [
      { label: 'Excellent 8–10', band: [8, 10] as const, color: 'bg-primary' },
      { label: 'Strong 6–8', band: [6, 8] as const, color: 'bg-primary/60' },
      { label: 'Developing 4–6', band: [4, 6] as const, color: 'bg-secondary' },
      { label: 'Critical 0–4', band: [0, 4] as const, color: 'bg-error' },
    ].map((b) => {
      const count = griVals.filter((v) => v >= b.band[0] && (b.band[1] === 10 ? v <= 10 : v < b.band[1])).length
      return { label: b.label, count, pct: griVals.length ? Math.round((count / griVals.length) * 100) : 0, color: b.color }
    })

    const requestsByStatus: Record<string, number> = {}
    for (const r of reqRows ?? []) requestsByStatus[(r.status ?? 'unknown')] = (requestsByStatus[(r.status ?? 'unknown')] ?? 0) + 1
    const pendingRequests = (reqRows ?? []).filter((r) => !['approved', 'rejected', 'completed', 'archived'].includes(r.status ?? '')).length

    // Recent activity (real)
    const activity: { icon: string; title: string; event: string; time: string; color: string; ts: number }[] = []
    for (const d of recentDiag ?? []) {
      const at = d.calculated_at as string
      activity.push({ icon: 'radar', color: 'text-primary', title: 'Диагностика обновлена', event: `GRI ${typeof d.overall_score === 'number' ? d.overall_score : '—'} · стадия ${d.stage ?? '—'}`, time: fmtTimeAgo(at), ts: new Date(at ?? 0).getTime() })
    }
    for (const u of recentUsers ?? []) {
      const at = u.created_at as string
      activity.push({ icon: 'person_add', color: 'text-primary', title: u.full_name ? String(u.full_name) : 'Новый пользователь', event: `Добавлен · роль ${u.role ?? '—'}`, time: fmtTimeAgo(at), ts: new Date(at ?? 0).getTime() })
    }
    for (const r of recentReq ?? []) {
      const at = r.createdAt as string
      activity.push({ icon: 'inbox', color: 'text-secondary', title: 'Заявка', event: `${r.type ?? 'запрос'} · ${r.status ?? '—'}`, time: fmtTimeAgo(at), ts: new Date(at ?? 0).getTime() })
    }
    activity.sort((a, b) => b.ts - a.ts)

    return NextResponse.json({
      ok: true,
      data: {
        stats: {
          clients: byRole.client ?? 0,
          experts: byRole.expert ?? 0,
          admins: (byRole.admin ?? 0) + (byRole.super_admin ?? 0),
          owners: byRole.owner ?? 0,
          totalUsers,
          companies: len(companies),
          diagnostics: len(diagnostics),
          griAssessments: len(griRows),
          griAvg: griAvg != null ? Math.round(griAvg * 10) / 10 : null,
          documents: len(documents),
          metrics: len(metrics),
          marketSnapshots: len(marketSnap),
          pointB: len(pointB),
          pointAInsights: len(pointAIns),
          pendingRequests,
        },
        sectionCounts: {
          '/gri': len(griRows),
          '/market': len(marketSnap),
          '/metrics': len(metrics),
          '/point-a': len(diagnostics),
          '/point-b': len(pointB),
          '/insights': len(pointAIns),
          '/reports': len(documents),
          '/clients': len(companies),
          '/users': totalUsers,
          '/team': byRole.expert ?? 0,
        },
        griDistribution,
        requestsByStatus,
        activity: activity.slice(0, 6).map(({ ts, ...a }) => a),
      },
    })
  } catch (error) {
    console.error('[admin/overview] error:', error)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
