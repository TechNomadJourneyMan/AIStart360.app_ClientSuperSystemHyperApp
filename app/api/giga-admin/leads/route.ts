export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { GIGA_COOKIE_NAME, verifyGigaRole } from '@/lib/giga-cookie'

// A2b: verify the HMAC-SIGNED giga cookie, not an unsigned static string.
function isSuperAdmin(req: NextRequest): boolean {
  return verifyGigaRole(req.cookies.get(GIGA_COOKIE_NAME)?.value) === 'super_admin'
}

interface RawBlockScore {
  key?: string
  label?: string
  score?: number
}

/**
 * GET /api/giga-admin/leads
 * Reads mini-GRI leads (the /gri-free lead magnet) from Supabase.
 *
 * `mini_gri_leads` is a Prisma-owned table with NO RLS, so it MUST be read via
 * the service-role client (same privileged path as the other giga-admin GET
 * routes: requests/clients). Authorization is enforced by isSuperAdmin() above.
 *
 * NOTE the mixed casing in the DDL (033_app_share_payments_leads.sql / Prisma
 * @map): overall_score / block_scores are snake_case, but createdAt is camelCase.
 */
export async function GET(req: NextRequest) {
  if (!isSuperAdmin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const sb = createServiceClient()

    const { data, error } = await sb
      .from('mini_gri_leads')
      .select('id, email, overall_score, block_scores, source, converted, createdAt')
      .order('createdAt', { ascending: false })
      .limit(500)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const leads = (data ?? []).map((r) => {
      const blocks = Array.isArray(r.block_scores) ? (r.block_scores as RawBlockScore[]) : []
      return {
        id: r.id as string,
        email: (r.email as string) ?? '—',
        overallScore: (r.overall_score as number) ?? 0,
        source: (r.source as string | null) ?? null,
        converted: Boolean(r.converted),
        createdAt: r.createdAt as string,
        blockScores: blocks.map((b) => ({
          key: b.key ?? '',
          label: b.label ?? '',
          score: typeof b.score === 'number' ? b.score : 0,
        })),
      }
    })

    return NextResponse.json({ leads })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[giga-admin/leads] GET error:', msg)
    return NextResponse.json({ error: `Server error: ${msg.slice(0, 200)}` }, { status: 500 })
  }
}
