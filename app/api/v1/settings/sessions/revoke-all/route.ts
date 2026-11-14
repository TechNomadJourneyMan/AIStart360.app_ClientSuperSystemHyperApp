import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logActivity } from '@/lib/activity/log'
import { refuseDuringImpersonation } from '@/lib/impersonation/guard'

// Sign the user out of ALL sessions/devices (Supabase global scope). This also
// ends the current session, so the client should redirect to /login afterwards.
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  // SR-07: never «от имени клиента» (lib/impersonation/guard.ts).
  const impersonated = await refuseDuringImpersonation(request, user, 'sessions.revoke_all')
  if (impersonated) return impersonated

  const { error } = await supabase.auth.signOut({ scope: 'global' })
  if (error) {
    console.error('[settings/sessions/revoke-all]', error.message)
    return NextResponse.json({ ok: false, error: 'failed' }, { status: 500 })
  }

  await logActivity({
    userId: user.id,
    action: 'security.all_sessions_revoked',
    category: 'security',
    severity: 'critical',
    description: 'Завершены все сессии',
    req: request,
  })
  return NextResponse.json({ ok: true })
}
