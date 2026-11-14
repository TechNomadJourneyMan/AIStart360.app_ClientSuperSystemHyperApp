/**
 * Impersonation cookie ("кабинет от имени пользователя"). Runtime-neutral
 * (Web Crypto) so middleware and route handlers share one implementation.
 *
 * The cookie does NOT grant access by itself: the browser also holds the
 * target's Supabase session, minted server-side when the session started. The
 * cookie marks that session as an admin's, carries the mode (view/edit) and the
 * DB session id every action is audited under, and bounds its lifetime.
 */
import { signToken, verifyToken, type VerifyResult } from '@/lib/security/signed-token'

export const IMP_COOKIE_NAME = 'aistart360_imp'
export const IMP_TTL_SECONDS = 30 * 60
/** The cookie outlives the token so an expired session can be detected and closed. */
export const IMP_COOKIE_MAX_AGE = 12 * 60 * 60

export type ImpersonationMode = 'view' | 'edit'

export interface ImpersonationClaims extends Record<string, unknown> {
  /** impersonation_sessions.id */
  sid: string
  /** target user id */
  uid: string
  mode: ImpersonationMode
  /** admin id (profiles UUID) and a display label */
  aid: string
  alabel: string
  /** admin staff role at start (for the audit trail) */
  arole?: string
  /** target label for the banner */
  tlabel: string
  /**
   * GoTrue session id of the client session minted for this impersonation
   * (R-008). The cookie is valid only together with that very session; the
   * server-side binding (IMP_BINDING_ACTION) lets middleware recognise the
   * session even when the cookie is gone. Absent on cookies issued before.
   */
  asid?: string
}

/**
 * Audit action that binds an impersonation_sessions row to the Supabase
 * session minted for it: admin_audit_log row with entity_type
 * IMP_BINDING_ENTITY, entity_id = GoTrue session id, impersonation_session_id
 * = the row. Written (required) before the cookie is handed out.
 */
export const IMP_BINDING_ACTION = 'impersonation.session_bound'
export const IMP_BINDING_ENTITY = 'auth_session'

export function signImpersonation(claims: ImpersonationClaims, ttlSeconds = IMP_TTL_SECONDS): Promise<string> {
  return signToken('imp', claims, ttlSeconds)
}

export function readImpersonation(token: string | null | undefined): Promise<VerifyResult<ImpersonationClaims>> {
  return verifyToken<ImpersonationClaims>('imp', token)
}

/** Mutating API paths that stay allowed in view-only mode. */
// SR-06: «Выйти» during an impersonation ends only that session (scope
// 'local', app/api/v1/auth/sign-out) — it must work in view mode too.
export const VIEW_MODE_ALLOWED_API = ['/api/v1/impersonation/exit', '/api/v1/events', '/api/v1/auth/sign-out']

/** POST endpoints that only compute and return data (no writes): not audited, allowed in view mode. */
export const READ_ONLY_POST_API = ['/api/v1/assistant/validate']

export function isViewModeAllowed(pathname: string): boolean {
  return pathname.startsWith('/api/giga-admin/') || VIEW_MODE_ALLOWED_API.includes(pathname) || READ_ONLY_POST_API.includes(pathname)
}

export const IMP_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: IMP_COOKIE_MAX_AGE,
}
