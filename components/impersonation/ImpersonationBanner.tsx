import { createServerClient } from '@/lib/supabase-server'
import { activeImpersonation } from '@/lib/impersonation/server'
import ImpersonationBar from './ImpersonationBar'

/** Server-rendered: shows the admin-mode bar only inside a live impersonation. */
export default async function ImpersonationBanner() {
  let userId: string | null = null
  try {
    const { data } = await createServerClient().auth.getUser()
    userId = data.user?.id ?? null
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
    />
  )
}
