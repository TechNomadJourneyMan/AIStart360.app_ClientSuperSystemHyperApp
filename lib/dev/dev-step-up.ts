/**
 * lib/dev/dev-step-up.ts — the database side of «dev mode counts as the second
 * factor». Node / server only. Dev routes call it only after
 * devAccessEnabledForRequest() (in a production build that guard is the
 * constant `false`, so this is never reached there).
 *
 * Middleware and the API gates treat the localhost developer as stepped up,
 * but since migration 143 staff / expert rights in RLS also need a
 * staff_mfa_sessions record of the GoTrue session (SR-01). Without it a staff
 * account entered through the dev login would see empty client lists on every
 * screen that reads through the user's own token.
 *
 * Best-effort: a failure is logged and the dev login still works (the screens
 * that read with the service role are unaffected).
 */
import { createServiceClient } from '@/lib/supabase-service'
import { authSessionFromAccessToken } from '@/lib/mfa/session-binding'
import { recordStepUpSession, stepUpSessionUuid } from '@/lib/mfa/step-up-session'

/** Record the session of `accessToken` (just issued for `userId`) as stepped up. */
export async function recordDevStepUp(accessToken: string | null | undefined, userId: string): Promise<boolean> {
  const claims = authSessionFromAccessToken(accessToken)
  if (!claims || claims.sub !== userId) return false
  return recordDevStepUpForSession(userId, claims.sessionKey)
}

/** Record session `sessionKey` of `userId` as stepped up (dev mode switched on). */
export async function recordDevStepUpForSession(userId: string, sessionKey: string | null | undefined): Promise<boolean> {
  try {
    await recordStepUpSession(userId, sessionKey, 'dev')
    return true
  } catch (err) {
    console.warn('[dev] step-up record failed — staff screens that read through RLS will be empty', err instanceof Error ? err.message : err)
    return false
  }
}

/** Dev mode switched off: drop the record this session got from dev mode (a real step-up stays). */
export async function forgetDevStepUp(sessionKey: string | null | undefined): Promise<void> {
  const sessionId = stepUpSessionUuid(sessionKey)
  if (!sessionId) return
  try {
    await createServiceClient().from('staff_mfa_sessions').delete().eq('session_id', sessionId).eq('method', 'dev')
  } catch {
    /* best-effort */
  }
}
