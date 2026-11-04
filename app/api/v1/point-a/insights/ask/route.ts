export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireExpert, srGet } from '@/lib/expert-auth'

// ---------------------------------------------------------------------------
// POST /api/v1/point-a/insights/ask
//
// Staff (expert / admin / super_admin) authors a clarifying question for a
// specific client. The row lands in the client's Point A feed and — thanks to
// Realtime on point_a_insights — appears in their cabinet instantly.
//
// Follows the established expert-portal pattern: authorise via requireExpert()
// (Supabase session + service-role role lookup) and write via service-role REST
// to avoid the profiles-RLS recursion hit during the insert policy check.
// ---------------------------------------------------------------------------

const bodySchema = z.object({
  client_user_id: z.string().uuid('client_user_id must be a UUID'),
  question_text: z.string().min(4).max(2000),
  category: z.string().min(1).max(64),
})

function srBase() {
  return {
    url: (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, ''),
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  }
}

export async function POST(req: NextRequest) {
  const viewer = await requireExpert()
  if (!viewer) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  const rawBody = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })
  }
  const { client_user_id, question_text, category } = parsed.data

  const { url, key } = srBase()
  if (!url || !key) {
    return NextResponse.json({ ok: false, error: 'server misconfigured' }, { status: 500 })
  }

  // Best-effort: the client's company + the author's display name.
  const companyRows = await srGet<Array<{ id: string }>>(
    `companies?user_id=eq.${client_user_id}&select=id&limit=1`,
  )
  const companyId = companyRows?.[0]?.id ?? null

  const profileRows = await srGet<Array<{ full_name: string | null }>>(
    `profiles?id=eq.${viewer.id}&select=full_name&limit=1`,
  )
  const callerName = profileRows?.[0]?.full_name?.trim() || viewer.email || 'Эксперт'

  // expert → type 'expert'; admin/super_admin → type 'admin'.
  const insightType = viewer.role === 'expert' ? 'expert' : 'admin'
  const authorName = insightType === 'expert' ? `Эксперт · ${callerName}` : `Админ · ${callerName}`

  const row = {
    user_id: client_user_id,
    company_id: companyId,
    type: insightType,
    category,
    question_text,
    author_name: authorName,
    status: 'awaiting_answer',
    source_meta: { authored_by: viewer.id, author_role: viewer.role },
  }

  let inserted: unknown = null
  try {
    const res = await fetch(`${url}/rest/v1/point_a_insights`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(row),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return NextResponse.json(
        { ok: false, error: `Failed to create insight (${res.status})`, detail: detail.slice(0, 300) },
        { status: 500 },
      )
    }
    const json = (await res.json()) as unknown[]
    inserted = Array.isArray(json) ? json[0] : json
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'network error' },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true, data: inserted }, { status: 201 })
}
