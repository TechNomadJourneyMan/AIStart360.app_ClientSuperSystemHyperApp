/**
 * Server record of a passed step-up (SR-01, migration 143).
 *
 * The step-up cookie (lib/mfa/step-up.ts) is invisible to Postgres, so staff
 * rights in RLS used to need only a password: a GoTrue token taken straight
 * from /auth/v1/token read every client through PostgREST. Now every RLS
 * helper of staff / experts asks public.staff_session_ok(), which wants a row
 * in public.staff_mfa_sessions for the JWT `session_id` whenever a second
 * factor applies to the person. This module writes that row — with the
 * service role, at the moment the cookie is issued and for the cookie's
 * lifetime — and removes it on sign-out.
 *
 * Fail closed: when the row cannot be written, the cookie is NOT issued
 * (issueStepUp throws StepUpRecordError), otherwise the app would let the
 * person in while the database shows them nothing. Removal is best-effort:
 * GoTrue deletes the auth.sessions row on sign-out and staff_session_ok()
 * requires it, so a left-over record grants nothing.
 */
import { createServiceClient } from '@/lib/supabase-service'
import { MFA_COOKIE_NAME, MFA_COOKIE_OPTIONS, STEP_UP_TTL_MS, signStepUp } from './step-up'

export type StepUpMethod = 'totp' | 'backup_code' | 'passkey' | 'first_factor_totp' | 'first_factor_passkey' | 'dev'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** What a route answers when the record could not be written. */
export const STEP_UP_RECORD_FAILED_MESSAGE =
  'Код принят, но подтвердить вход не удалось: сервер временно недоступен. Повторите через минуту.'

export class StepUpRecordError extends Error {
  constructor(readonly code: 'no_session' | 'store_failed', detail?: string) {
    super(`step-up record: ${code}${detail ? ` (${detail})` : ''}`)
    this.name = 'StepUpRecordError'
  }
}

/** HTTP answer of a route whose step-up could not be recorded. */
export function stepUpFailure(err: unknown): { status: number; error: string } {
  if (err instanceof StepUpRecordError && err.code === 'no_session') {
    return { status: 401, error: 'Сессия не найдена. Войдите заново.' }
  }
  return { status: 503, error: STEP_UP_RECORD_FAILED_MESSAGE }
}

/**
 * The GoTrue session id when `sessionKey` is one. A token without
 * `session_id` (NO_SESSION_ID) cannot be bound in the database (SR-16).
 */
export function stepUpSessionUuid(sessionKey: string | null | undefined): string | null {
  return typeof sessionKey === 'string' && UUID_RE.test(sessionKey) ? sessionKey.toLowerCase() : null
}

/** Write (or renew) the record of `sessionKey`. Throws StepUpRecordError. */
export async function recordStepUpSession(
  userId: string,
  sessionKey: string | null | undefined,
  method: StepUpMethod,
  ttlMs: number = STEP_UP_TTL_MS,
): Promise<void> {
  const sessionId = stepUpSessionUuid(sessionKey)
  if (!sessionId || !userId) throw new StepUpRecordError('no_session')
  let sb
  try {
    sb = createServiceClient()
  } catch (err) {
    throw new StepUpRecordError('store_failed', err instanceof Error ? err.message : 'no service client')
  }
  const now = Date.now()
  const { error } = await sb.from('staff_mfa_sessions').upsert(
    {
      session_id: sessionId,
      user_id: userId,
      verified_at: new Date(now).toISOString(),
      expires_at: new Date(now + ttlMs).toISOString(),
      method,
    },
    { onConflict: 'session_id' },
  )
  if (error) throw new StepUpRecordError('store_failed', error.code ?? error.message)

  // Housekeeping: this user's expired records. Never fails the step-up.
  try {
    await sb.from('staff_mfa_sessions').delete().eq('user_id', userId).lt('expires_at', new Date(now).toISOString())
  } catch {
    /* ignore */
  }
}

interface CookieJar {
  set(name: string, value: string, options: typeof MFA_COOKIE_OPTIONS): unknown
}

/**
 * The one way to hand out a step-up: record it for the database first, then
 * set the cookie. Throws StepUpRecordError (the cookie is not set then).
 */
export async function issueStepUp(jar: CookieJar, userId: string, sessionKey: string, method: StepUpMethod): Promise<void> {
  await recordStepUpSession(userId, sessionKey, method)
  jar.set(MFA_COOKIE_NAME, signStepUp(userId, sessionKey), MFA_COOKIE_OPTIONS)
}

/** Remove the record of one session (sign-out, factor removed). Best-effort. */
export async function forgetStepUpSession(sessionKey: string | null | undefined): Promise<void> {
  const sessionId = stepUpSessionUuid(sessionKey)
  if (!sessionId) return
  try {
    const { error } = await createServiceClient().from('staff_mfa_sessions').delete().eq('session_id', sessionId)
    if (error) console.warn('[step-up-session] forget failed', error.code ?? error.message)
  } catch (err) {
    console.warn('[step-up-session] forget failed', err instanceof Error ? err.message : err)
  }
}

/** Remove every record of a user («выйти со всех устройств»). Best-effort. */
export async function forgetStepUpSessionsOfUser(userId: string | null | undefined): Promise<void> {
  if (!userId) return
  try {
    const { error } = await createServiceClient().from('staff_mfa_sessions').delete().eq('user_id', userId)
    if (error) console.warn('[step-up-session] forget-all failed', error.code ?? error.message)
  } catch (err) {
    console.warn('[step-up-session] forget-all failed', err instanceof Error ? err.message : err)
  }
}
