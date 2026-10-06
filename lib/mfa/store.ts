import { createClient } from '@supabase/supabase-js'

/**
 * Service-role access to `public.user_security` (RLS-on, no client policies — MFA
 * secrets must never be readable by the browser). Also flips the fast-path
 * `user_metadata.mfa_totp` flag that middleware reads to decide whether to gate.
 */

export interface UserSecurityRow {
  user_id: string
  totp_enabled: boolean
  totp_secret_enc: string | null
  totp_pending_enc: string | null
  backup_codes: string[]
}

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * Every write below THROWS on failure. supabase-js reports PostgREST and GoTrue
 * failures as `{ error }` instead of throwing, so an ignored result would let a
 * route report "2FA enabled" without the gate flag, or an admin reset that left
 * the user locked out. The calling route turns the throw into a 5xx.
 */
function fail(what: string, error: { message?: string; code?: string; status?: number }): never {
  throw new Error(`mfa store: ${what} failed (${error.code ?? error.status ?? 'unknown'})`)
}

export async function getUserSecurity(userId: string): Promise<UserSecurityRow | null> {
  // A read error is not "no 2FA": callers would report the factor as off.
  const { data, error } = await admin().from('user_security').select('*').eq('user_id', userId).maybeSingle()
  if (error) fail('user_security read', error)
  return (data as UserSecurityRow | null) ?? null
}

export async function upsertUserSecurity(userId: string, patch: Partial<Omit<UserSecurityRow, 'user_id'>>): Promise<void> {
  const { error } = await admin()
    .from('user_security')
    .upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  if (error) fail('user_security upsert', error)
}

/**
 * Set the TOTP enforcement flag that middleware reads from the (server-verified)
 * Supabase JWT. Merges into existing metadata — does not wipe other keys.
 */
export async function setMfaMetadataFlag(userId: string, enabled: boolean): Promise<void> {
  // app_metadata is the authoritative copy (users cannot edit it); user_metadata
  // is kept in sync for older readers (lib/mfa/flags.ts ORs both).
  const { error } = await admin().auth.admin.updateUserById(userId, { app_metadata: { mfa_totp: enabled }, user_metadata: { mfa_totp: enabled } })
  if (error) fail('mfa_totp flag', error)
}

/** Set the passkey (WebAuthn) enforcement flag — middleware gates on TOTP OR passkey. */
export async function setMfaWebauthnFlag(userId: string, enabled: boolean): Promise<void> {
  const { error } = await admin().auth.admin.updateUserById(userId, { app_metadata: { mfa_webauthn: enabled }, user_metadata: { mfa_webauthn: enabled } })
  if (error) fail('mfa_webauthn flag', error)
}

/**
 * Emergency admin MFA reset for a LOCKED-OUT user (lost authenticator + no saved
 * backup codes). Clears the TOTP secret & backup-code hashes, deletes every
 * passkey, and clears BOTH middleware gate flags (user_metadata.mfa_totp /
 * mfa_webauthn) so the user can sign in with just their password again.
 *
 * Service-role only. There is NO way for a user to do this themselves once
 * locked out — this is the sole recovery path, so it is gated by admin
 * authorization at the route layer, not by a user-supplied code.
 */
export async function adminResetUserMfa(userId: string): Promise<void> {
  const sb = admin()
  const sec = await sb.from('user_security').upsert(
    {
      user_id: userId,
      totp_enabled: false,
      totp_secret_enc: null,
      totp_pending_enc: null,
      backup_codes: [],
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )
  if (sec.error) fail('user_security reset', sec.error)
  const keys = await sb.from('webauthn_credentials').delete().eq('user_id', userId)
  if (keys.error) fail('webauthn_credentials delete', keys.error)
  // Last: until the gate flags are cleared the reset is NOT done — a failure
  // here must reach the admin, or the user stays redirected to /2fa with no
  // factor left. Re-running the reset is safe (every step is idempotent).
  const { error } = await sb.auth.admin.updateUserById(userId, {
    app_metadata: { mfa_totp: false, mfa_webauthn: false },
    user_metadata: { mfa_totp: false, mfa_webauthn: false },
  })
  if (error) fail('mfa flags reset', error)
}
