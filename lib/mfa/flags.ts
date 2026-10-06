/**
 * Whether a Supabase user has a second factor, from the JWT (edge-safe).
 *
 * The authoritative flags live in `app_metadata` (only the service role can
 * write it, migration 092 backfilled it). `user_metadata` is still honoured
 * for sessions issued before the backfill, but only to ADD the gate: a user
 * can edit their own user_metadata (supabase.auth.updateUser), so a `false`
 * there must never switch the gate off — hence OR, never "user_metadata wins".
 */
type Meta = Record<string, unknown> | null | undefined

export function mfaFlagsEnrolled(user: { app_metadata?: Meta; user_metadata?: Meta } | null | undefined): boolean {
  if (!user) return false
  const on = (m: Meta) => m?.mfa_totp === true || m?.mfa_webauthn === true
  return on(user.app_metadata) || on(user.user_metadata)
}
