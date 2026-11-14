export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { requireGiga } from '@/lib/admin/giga-actor'
import { dbError } from '@/lib/api-error'
import { filterByScope, scopedClientIds } from '@/lib/admin/client-scope'
import { loadSnapshotsByDiagnostic, officialPointA } from '@/lib/point-a/official'

/**
 * GET /api/giga-admin/clients
 * Returns approved clients from Supabase profiles + companies.
 */
export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, 'users.view')
  if (guard.response) return guard.response

  try {
    // Service-role: the giga HMAC cookie provides no Supabase auth session, so
    // an anon/SSR client would hit profiles' RLS with auth.uid() = NULL and get
    // an empty list. Authorization is enforced by requireGiga() above.
    const sb = createServiceClient()

    // Get approved client profiles
    const { data: profiles, error: pErr } = await sb
      .from('profiles')
      .select('id, email, full_name, organization, status, created_at')
      .eq('role', 'client')
      .eq('status', 'approved')
      .order('created_at', { ascending: false })

    if (pErr) {
      return dbError('giga-admin/clients', pErr)
    }

    // Get companies
    const { data: companies } = await sb
      .from('companies')
      .select('user_id, name, industry, employee_count')

    const companyMap = new Map<string, { name: string; industry?: string; employees?: number }>()
    for (const c of companies ?? []) {
      companyMap.set(c.user_id, { name: c.name, industry: c.industry, employees: c.employee_count })
    }

    // The current diagnostic of each client with its OFFICIAL numbers
    // (lib/point-a/official.ts, R-033/R-032): no score → null, never 0.
    // (diagnostics has no created_at — the old order by it failed silently.)
    const { data: diagnostics } = await sb
      .from('diagnostics')
      .select('id, user_id, overall_score, health_index, stage, calculated_at')
      .eq('is_current', true)
      .order('calculated_at', { ascending: false })
    const snaps = await loadSnapshotsByDiagnostic(sb, (diagnostics ?? []).map((d) => String(d.id)))

    const diagMap = new Map<string, { score: number | null; health: number | null; stage: string | null }>()
    for (const d of diagnostics ?? []) {
      if (!diagMap.has(d.user_id)) {
        const o = officialPointA(d as Record<string, unknown>, snaps.get(String(d.id)) ?? null)
        const scored = o.state === 'scored'
        diagMap.set(d.user_id, { score: scored ? o.overall : null, health: scored ? o.health_index : null, stage: scored ? o.stage : null })
      }
    }

    // Current GRI assessment per client (0..10 scale, same as the ScoreRing).
    // The store's GriBlock names map 1:1 onto the 7 canonical sections.
    const { data: griRows } = await sb
      .from('gri_assessments')
      .select('user_id, gri_index, section_avgs, created_at')
      .eq('is_current', true)
    const griMap = new Map<string, { gri_index: number; section_avgs: Record<string, number> | null; created_at: string }>()
    for (const g of griRows ?? []) griMap.set(g.user_id, g)

    // Эксперт со scope 'assigned' видит только назначенных ему клиентов.
    const allowed = await scopedClientIds(guard.actor)
    const clients = filterByScope(profiles ?? [], allowed, (p) => p.id).map((p) => {
      const comp = companyMap.get(p.id)
      const diag = diagMap.get(p.id)
      const gri = griMap.get(p.id)
      const avg = (id: string) => Number(gri?.section_avgs?.[id] ?? 0)
      return {
        id: p.id,
        name: comp?.name ?? p.organization ?? p.full_name ?? p.email,
        industry: comp?.industry ?? null,
        stage: diag?.stage ?? null,
        status: 'active',
        website: null,
        createdAt: p.created_at,
        manager: null,
        latestGri: gri ? {
          score: Number(gri.gri_index),
          calculatedAt: gri.created_at,
          productScore: avg('product-demand'),
          trustScore: avg('trust-positioning'),
          businessModelScore: avg('business-model'),
          cashScore: avg('cash-stability'),
          operationsScore: avg('operations'),
          teamScore: avg('team'),
          founderScore: avg('owner-readiness'),
        } : null,
        // Not derived from the Point A health index any more (I2): a «churn
        // probability» = 100 − health is not data. The old read ordered by a
        // column diagnostics does not have, so this was always null anyway.
        pulseMetrics: null,
      }
    })

    return NextResponse.json({ clients })
  } catch (error) {
    console.error('[giga-admin/clients] Error:', error)
    return NextResponse.json({ clients: [] })
  }
}
