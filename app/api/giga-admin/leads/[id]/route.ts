export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { GIGA_COOKIE_NAME, verifyGigaRole } from '@/lib/giga-cookie'

// A2b: verify the HMAC-SIGNED giga cookie, not an unsigned static string.
function isSuperAdmin(req: NextRequest): boolean {
  return verifyGigaRole(req.cookies.get(GIGA_COOKIE_NAME)?.value) === 'super_admin'
}

/**
 * PATCH /api/giga-admin/leads/:id
 * Toggle a mini-GRI lead's `converted` flag ("лид обработан/сконвертирован").
 * Body: { converted: boolean }. Service-role write (mini_gri_leads has no RLS).
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isSuperAdmin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const converted = (body as { converted?: unknown })?.converted
  if (typeof converted !== 'boolean') {
    return NextResponse.json({ error: 'Body must include boolean `converted`' }, { status: 422 })
  }

  try {
    const sb = createServiceClient()

    const { data, error } = await sb
      .from('mini_gri_leads')
      .update({ converted })
      .eq('id', params.id)
      .select('id, email, overall_score, source, converted, createdAt')
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    return NextResponse.json({
      lead: {
        id: data.id as string,
        email: (data.email as string) ?? '—',
        overallScore: (data.overall_score as number) ?? 0,
        source: (data.source as string | null) ?? null,
        converted: Boolean(data.converted),
        createdAt: data.createdAt as string,
      },
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[giga-admin/leads/:id] PATCH error:', msg)
    return NextResponse.json({ error: `Server error: ${msg.slice(0, 200)}` }, { status: 500 })
  }
}
