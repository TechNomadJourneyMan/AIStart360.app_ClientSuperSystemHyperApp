import { createClient } from '@supabase/supabase-js'

/**
 * Service-role access to `public.webauthn_credentials` (RLS-on, no client
 * policies). Credential public keys and counters must be managed only by server
 * code. IDs and public keys are stored base64url-encoded.
 */

export interface WebAuthnCredentialRow {
  id: string
  user_id: string
  public_key: string
  counter: number
  transports: string[]
  device_type: string | null
  backed_up: boolean
  label: string | null
  created_at: string
  last_used_at: string | null
}

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function listCredentials(userId: string): Promise<WebAuthnCredentialRow[]> {
  const { data } = await admin()
    .from('webauthn_credentials')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  return (data as WebAuthnCredentialRow[] | null) ?? []
}

export async function countCredentials(userId: string): Promise<number> {
  const { count } = await admin()
    .from('webauthn_credentials')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
  return count ?? 0
}

/** Look up a credential by its ID (PK), scoped to the given user. */
export async function getCredentialForUser(userId: string, id: string): Promise<WebAuthnCredentialRow | null> {
  const { data } = await admin()
    .from('webauthn_credentials')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle()
  return (data as WebAuthnCredentialRow | null) ?? null
}

export async function insertCredential(row: {
  id: string
  user_id: string
  public_key: string
  counter: number
  transports: string[]
  device_type: string | null
  backed_up: boolean
  label: string | null
}): Promise<void> {
  await admin().from('webauthn_credentials').insert(row)
}

export async function updateCredentialCounter(id: string, counter: number): Promise<void> {
  await admin()
    .from('webauthn_credentials')
    .update({ counter, last_used_at: new Date().toISOString() })
    .eq('id', id)
}

/** Delete one credential, scoped to the owner. Returns true if a row was removed. */
export async function deleteCredential(userId: string, id: string): Promise<boolean> {
  const { data } = await admin()
    .from('webauthn_credentials')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
    .select('id')
  return Array.isArray(data) && data.length > 0
}
