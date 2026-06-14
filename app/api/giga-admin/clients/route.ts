export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { GIGA_COOKIE_NAME, verifyGigaRole } from '@/lib/giga-cookie'

// A2b: verify the HMAC-SIGNED giga cookie, not an unsigned static string.
function isSuperAdmin(req: NextRequest): boolean {
  return verifyGigaRole(req.cookies.get(GIGA_COOKIE_NAME)?.value) === 'super_admin'
}

/**
 * GET /api/giga-admin/clients
 * Returns approved clients from Supabase profiles + companies.
 */
export async function GET(req: NextRequest) {
  if (!isSuperAdmin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const sb = createServerClient()

    // Get approved client profiles
    const { data: profiles, error: pErr } = await sb
      .from('profiles')
      .select('id, email, full_name, organization, status, created_at')
      .eq('role', 'client')
      .eq('status', 'approved')
      .order('created_at', { ascending: false })

    if (pErr) {
      return NextResponse.json({ error: pErr.message }, { status: 500 })
    }

    // Get companies
    const { data: companies } = await sb
      .from('companies')
      .select('user_id, name, industry, employee_count')

    const companyMap = new Map<string, { name: string; industry?: string; employees?: number }>()
    for (const c of companies ?? []) {
      companyMap.set(c.user_id, { name: c.name, industry: c.industry, employees: c.employee_count })
    }

    // Get latest diagnostics for each client
    const { data: diagnostics } = await sb
      .from('diagnostics')
      .select('user_id, overall_score, health_index, stage, created_at')
      .order('created_at', { ascending: false })

    const diagMap = new Map<string, { score: number; health: number; stage: string }>()
    for (const d of diagnostics ?? []) {
      if (!diagMap.has(d.user_id)) {
        diagMap.set(d.user_id, { score: d.overall_score ?? 0, health: d.health_index ?? 0, stage: d.stage ?? '' })
      }
    }

    const clients = (profiles ?? []).map((p) => {
      const comp = companyMap.get(p.id)
      const diag = diagMap.get(p.id)
      return {
        id: p.id,
        name: comp?.name ?? p.organization ?? p.full_name ?? p.email,
        industry: comp?.industry ?? null,
        stage: diag?.stage ?? null,
        status: 'active',
        website: null,
        createdAt: p.created_at,
        manager: null,
        latestGri: null,
        pulseMetrics: diag ? {
          riskScore: diag.health < 40 ? 80 : diag.health < 60 ? 50 : 20,
          churnLevel: diag.health < 40 ? 'high' : diag.health < 60 ? 'medium' : 'low',
          churnProb: Math.max(0, 100 - diag.health),
          avgCheck: 0,
          lastOrder: null,
          daysSince: null,
        } : null,
      }
    })

    return NextResponse.json({ clients })
  } catch (error) {
    console.error('[giga-admin/clients] Error:', error)
    return NextResponse.json({ clients: [] })
  }
}
