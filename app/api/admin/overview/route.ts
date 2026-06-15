export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { GIGA_COOKIE_NAME, verifyGigaRole } from '@/lib/giga-cookie'

/**
 * GET /api/admin/overview
 *
 * Real aggregates for the admin overview tab — replaces the former hardcoded
 * mock (fake "48 clients / GRI 5.8 / Vortex Labs" data). Everything here is
 * counted from live Supabase tables; absent data surfaces as 0 / empty, never
 * fabricated.
 *
 * Access: Supabase session user with role admin/super_admin, OR the signed
 * super-admin giga cookie.
 */

type SB = ReturnType<typeof createServerClient>

async function isAdmin(req: NextRequest, sb: SB): Promise<boolean> {
  if (verifyGigaRole(req.cookies.get(GIGA_COOKIE_NAME)?.value) === 'super_admin') return true
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return false
  const { data: prof } = await sb.from('profiles').select('role').eq('id', user.id).maybeSingle()
  return prof?.role === 'admin' || prof?.role === 'super_admin'
}

async function countOf(sb: SB, table: string): Promise<number> {
  const { count } = await sb.from(table).select('*', { count: 'exact', head: true })
  return count ?? 0
}

const fmtTimeAgo = (iso: string | null): string => {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const h = Math.floor(diff / 3_600_000)
  if (h < 1) return 'только что'
  if (h < 24) return `${h}ч`
  const d = Math.floor(h / 24)
  return `${d}д`
}

export async function GET(req: NextRequest) {
  const sb = createServerClient()
  if (!(await isAdmin(req, sb))) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  }

  try {
    // ── Roles & headline counts ──────────────────────────────────────────────
    const { data: roleRows } = await sb.from('profiles').select('role')
    const byRole: Record<string, number> = {}
    for (const r of roleRows ?? []) byRole[(r.role as string) ?? 'unknown'] = (byRole[(r.role as string) ?? 'unknown'] ?? 0) + 1
    const totalUsers = (roleRows ?? []).length

    const [companies, diagnosticsTotal, documents, metrics, marketSnapshots, pointB, pointAInsights] =
      await Promise.all([
        countOf(sb, 'companies'),
        countOf(sb, 'diagnostics'),
        countOf(sb, 'documents'),
        countOf(sb, 'metrics'),
        countOf(sb, 'market_snapshots'),
        countOf(sb, 'point_b_analysis'),
        countOf(sb, 'point_a_insights'),
      ])

    // ── GRI: avg index + distribution buckets (from current assessments) ──────
    const { data: griRows } = await sb
      .from('gri_assessments')
      .select('gri_index, is_current')
      .eq('is_current', true)
    const griVals = (griRows ?? [])
      .map((g) => Number(g.gri_index))
      .filter((n) => Number.isFinite(n) && n > 0)
    const griCount = (griRows ?? []).length
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

    // ── Admin requests by status ─────────────────────────────────────────────
    const { data: reqRows } = await sb.from('admin_requests').select('status')
    const requestsByStatus: Record<string, number> = {}
    for (const r of reqRows ?? []) requestsByStatus[(r.status as string) ?? 'unknown'] = (requestsByStatus[(r.status as string) ?? 'unknown'] ?? 0) + 1
    const pendingRequests = (reqRows ?? []).filter((r) => !['approved', 'rejected', 'completed'].includes((r.status as string) ?? '')).length

    // ── Recent activity (real): newest diagnostics, users, requests ──────────
    // NOTE: timestamp columns differ per table — diagnostics.calculated_at
    // (Supabase), admin_requests.createdAt (Prisma camelCase), profiles.created_at.
    const [{ data: recentDiag }, { data: recentUsers }, { data: recentReq }] = await Promise.all([
      sb.from('diagnostics').select('user_id, overall_score, stage, calculated_at').order('calculated_at', { ascending: false }).limit(4),
      sb.from('profiles').select('full_name, role, created_at').order('created_at', { ascending: false }).limit(4),
      sb.from('admin_requests').select('type, status, createdAt').order('createdAt', { ascending: false }).limit(4),
    ])

    const activity: { icon: string; title: string; event: string; time: string; color: string; ts: number }[] = []
    for (const d of recentDiag ?? []) {
      const at = d.calculated_at as string
      activity.push({
        icon: 'radar', color: 'text-primary',
        title: 'Диагностика обновлена',
        event: `GRI ${typeof d.overall_score === 'number' ? d.overall_score : '—'} · стадия ${d.stage ?? '—'}`,
        time: fmtTimeAgo(at), ts: new Date(at ?? 0).getTime(),
      })
    }
    for (const u of recentUsers ?? []) {
      activity.push({
        icon: 'person_add', color: 'text-primary',
        title: u.full_name ? String(u.full_name) : 'Новый пользователь',
        event: `Добавлен · роль ${u.role ?? '—'}`,
        time: fmtTimeAgo(u.created_at as string), ts: new Date((u.created_at as string) ?? 0).getTime(),
      })
    }
    for (const r of recentReq ?? []) {
      const at = (r as Record<string, unknown>).createdAt as string
      activity.push({
        icon: 'inbox', color: 'text-secondary',
        title: 'Заявка',
        event: `${r.type ?? 'запрос'} · ${r.status ?? '—'}`,
        time: fmtTimeAgo(at), ts: new Date(at ?? 0).getTime(),
      })
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
          companies,
          diagnostics: diagnosticsTotal,
          griAssessments: griCount,
          griAvg: griAvg != null ? Math.round(griAvg * 10) / 10 : null,
          documents,
          metrics,
          marketSnapshots,
          pointB,
          pointAInsights,
          pendingRequests,
        },
        sectionCounts: {
          '/gri': griCount,
          '/market': marketSnapshots,
          '/metrics': metrics,
          '/point-a': diagnosticsTotal,
          '/point-b': pointB,
          '/insights': pointAInsights,
          '/reports': documents,
          '/clients': companies,
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
