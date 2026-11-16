import { createServerClient } from '@/lib/supabase-server'
import { activeImpersonation } from '@/lib/impersonation/server'
import ImpersonationBar from './ImpersonationBar'
import { isSignupBlocked } from '@/lib/auth/invite-only-shared'

/** Server-rendered: shows the admin-mode bar only inside a live impersonation. */
export default async function ImpersonationBanner() {
  let userId: string | null = null
  let inviteOnly = false
  try {
    const { data } = await createServerClient().auth.getUser()
    userId = data.user?.id ?? null
    // R4 B3 (verify NV3-1): the account was created around the invitation — the
    // client cannot sign in; the staff member working «as» them is told so.
    inviteOnly = isSignupBlocked(data.user)
  } catch {
    return null
  }
  const imp = await activeImpersonation(userId)
  if (!imp) return null
  return (
    <ImpersonationBar
      mode={imp.mode}
      target={imp.tlabel}
      admin={imp.alabel}
      expiresAt={Number((imp as { exp?: number }).exp ?? 0) * 1000}
      inviteOnly={inviteOnly}
    />
  )
}
