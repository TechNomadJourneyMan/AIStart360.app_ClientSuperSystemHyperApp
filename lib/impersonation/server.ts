import { cookies } from 'next/headers'
import { createServiceClient } from '@/lib/supabase-service'
import { NO_SESSION_ID, stepUpSessionKeyFromCookies } from '@/lib/mfa/session-binding'
import { IMP_BINDING_ACTION, IMP_BINDING_ENTITY, IMP_COOKIE_NAME, readImpersonation, type ImpersonationClaims, type ImpersonationMode } from './token'

/** The impersonation_sessions row as the server keeps it (R-008: the source of truth). */
export interface ImpersonationRow {
  id: string
  admin_id: string
  admin_email: string | null
  admin_role: string | null
  target_user_id: string
  mode: ImpersonationMode
  expires_at: string
  ended_at: string | null
}

const ROW_COLUMNS = 'id, admin_id, admin_email, admin_role, target_user_id, mode, expires_at, ended_at'

export function isRowActive(row: Pick<ImpersonationRow, 'ended_at' | 'expires_at'> | null | undefined): boolean {
  return !!row && !row.ended_at && new Date(row.expires_at).getTime() > Date.now()
}

/** View wins: the DB row and the cookie must both say «edit» for edit mode. */
export function effectiveMode(claimsMode: ImpersonationMode, rowMode: ImpersonationMode | null | undefined): ImpersonationMode {
  return claimsMode === 'view' || rowMode === 'view' ? 'view' : 'edit'
}

export async function readImpersonationRow(sid: string): Promise<ImpersonationRow | null> {
  const { data, error } = await createServiceClient().from('impersonation_sessions').select(ROW_COLUMNS).eq('id', sid).maybeSingle()
  if (error) throw new Error('impersonation row unavailable')
  return (data as ImpersonationRow | null) ?? null
}

/**
 * The impersonation a Supabase session was minted for (R-008 binding written
 * by POST /api/giga-admin/impersonation), or null for an ordinary session.
 */
export async function impersonationForAuthSession(sessionKey: string | null | undefined): Promise<ImpersonationRow | null> {
  if (!sessionKey || sessionKey === NO_SESSION_ID) return null
  const sb = createServiceClient()
  const { data, error } = await sb
    .from('admin_audit_log')
    .select('impersonation_session_id')
    .eq('action', IMP_BINDING_ACTION)
    .eq('entity_type', IMP_BINDING_ENTITY)
    .eq('entity_id', sessionKey)
    .limit(1)
    .maybeSingle()
  if (error) throw new Error('impersonation binding unavailable')
  const sid = (data as { impersonation_session_id?: string | null } | null)?.impersonation_session_id
  return sid ? readImpersonationRow(sid) : null
}

/**
 * The active impersonation for the CURRENT request, if the browser's Supabase
 * session belongs to its target, is the very session minted for it (R-008),
 * and the DB session is still open. The mode is the stricter of cookie and DB.
 */
export async function activeImpersonation(sessionUserId: string | null | undefined): Promise<ImpersonationClaims | null> {
  if (!sessionUserId) return null
  let token: string | undefined
  let sessionKey: string | null = null
  try {
    const jar = cookies()
    token = jar.get(IMP_COOKIE_NAME)?.value
    sessionKey = stepUpSessionKeyFromCookies(jar.getAll())
  } catch {
    return null
  }
  if (!token) return null
  const v = await readImpersonation(token)
  if (!v.ok || v.claims.uid !== sessionUserId) return null
  if (v.claims.asid && v.claims.asid !== sessionKey) return null
  try {
    const row = await readImpersonationRow(v.claims.sid)
    if (!isRowActive(row)) return null
    return { ...v.claims, mode: effectiveMode(v.claims.mode, row!.mode) }
  } catch {
    return null
  }
}
