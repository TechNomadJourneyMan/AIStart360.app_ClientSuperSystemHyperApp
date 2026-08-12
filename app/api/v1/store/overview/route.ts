export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { MFA_COOKIE_NAME } from '@/lib/mfa/step-up'
import { createClient } from '@/lib/supabase/server'
import { hasStoreMfaStepUp, resolveStoreAccess } from '@/lib/store/access'
import { loadStoreOverview } from '@/lib/store/loader'

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  })
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return json({ ok: false, error: 'unauthorized' }, 401)
  }
  if (!hasStoreMfaStepUp(user, request.cookies.get(MFA_COOKIE_NAME)?.value)) {
    return json({ ok: false, error: 'mfa_step_up_required' }, 403)
  }

  const access = await resolveStoreAccess(supabase, user.id)
  if (access === 'forbidden') {
    return json({ ok: false, error: 'forbidden' }, 403)
  }
  if (access === 'unavailable') {
    return json({ ok: false, error: 'store_access_unavailable' }, 500)
  }

  try {
    const data = await loadStoreOverview(supabase, user.id)
    return json({ ok: true, data })
  } catch (error) {
    console.error('[store/overview] failed', error)
    return json({ ok: false, error: 'store_overview_unavailable' }, 500)
  }
}
