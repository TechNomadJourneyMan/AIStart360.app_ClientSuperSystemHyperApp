export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { authorizeStore } from '@/lib/store/request'
import { loadStoreOverview } from '@/lib/store/loader'

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  })
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const supabase = await createClient()
  const access = await authorizeStore(supabase, request.nextUrl.searchParams.get('companyId'))
  if (!access.ok) return json({ ok: false, error: access.error.code }, access.error.status)

  try {
    const data = await loadStoreOverview(supabase, access.userId, access.company.id)
    return json({ ok: true, data })
  } catch (error) {
    console.error('[store/overview] failed', error)
    return json({ ok: false, error: 'store_overview_unavailable' }, 500)
  }
}
