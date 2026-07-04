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

export async function getUserSecurity(userId: string): Promise<UserSecurityRow | null> {
  const { data } = await admin().from('user_security').select('*').eq('user_id', userId).maybeSingle()
  return (data as UserSecurityRow | null) ?? null
}

export async function upsertUserSecurity(userId: string, patch: Partial<Omit<UserSecurityRow, 'user_id'>>): Promise<void> {
  await admin()
    .from('user_security')
    .upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
}

/**
 * Set the TOTP enforcement flag that middleware reads from the (server-verified)
 * Supabase JWT. Merges into existing user_metadata — does not wipe other keys.
 */
export async function setMfaMetadataFlag(userId: string, enabled: boolean): Promise<void> {
  await admin().auth.admin.updateUserById(userId, { user_metadata: { mfa_totp: enabled } })
}

/** Set the passkey (WebAuthn) enforcement flag — middleware gates on TOTP OR passkey. */
export async function setMfaWebauthnFlag(userId: string, enabled: boolean): Promise<void> {
  await admin().auth.admin.updateUserById(userId, { user_metadata: { mfa_webauthn: enabled } })
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
  await sb.from('user_security').upsert(
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
  await sb.from('webauthn_credentials').delete().eq('user_id', userId)
  await sb.auth.admin.updateUserById(userId, {
    user_metadata: { mfa_totp: false, mfa_webauthn: false },
  })
}
