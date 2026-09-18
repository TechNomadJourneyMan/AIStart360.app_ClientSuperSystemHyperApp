import { cookies } from 'next/headers'
import { createServiceClient } from '@/lib/supabase-service'
import { IMP_COOKIE_NAME, readImpersonation, type ImpersonationClaims } from './token'

/**
 * The active impersonation for the CURRENT request, if the browser's Supabase
 * session belongs to its target and the DB session is still open.
 */
export async function activeImpersonation(sessionUserId: string | null | undefined): Promise<ImpersonationClaims | null> {
  if (!sessionUserId) return null
  let token: string | undefined
  try {
    token = cookies().get(IMP_COOKIE_NAME)?.value
  } catch {
    return null
  }
  if (!token) return null
  const v = await readImpersonation(token)
  if (!v.ok || v.claims.uid !== sessionUserId) return null
  try {
    const { data } = await createServiceClient()
      .from('impersonation_sessions')
      .select('ended_at, expires_at')
      .eq('id', v.claims.sid)
      .maybeSingle()
    const row = data as { ended_at: string | null; expires_at: string } | null
    if (!row || row.ended_at || new Date(row.expires_at).getTime() <= Date.now()) return null
  } catch {
    return null
  }
  return v.claims
}
