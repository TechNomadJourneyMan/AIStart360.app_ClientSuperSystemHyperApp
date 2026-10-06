/**
 * CRM credentials at rest (crm_provider_connections.access_token).
 *
 * New tokens are encrypted with AES-256-GCM (lib/crypto/secrets.ts, key
 * SECRETS_ENCRYPTION_KEY) and stored as "v1:…". Rows written before this
 * change are plaintext; they still work and are re-encrypted by
 * `scripts/encrypt-crm-tokens.ts` or on the next save. Without a configured
 * key the token is stored as before and a warning is logged — the health
 * check reports how many plaintext tokens remain.
 */
import { decryptSecret, encryptSecret, isEncryptionConfigured } from '@/lib/crypto/secrets'

export function sealCrmToken(token: string): string {
  if (!isEncryptionConfigured()) {
    console.warn('[crm] SECRETS_ENCRYPTION_KEY is not set — CRM token stored without encryption')
    return token
  }
  return encryptSecret(token)
}

export function isSealed(stored: string): boolean {
  return stored.startsWith('v1:')
}

/** Plain token for an API call. Throws when an encrypted token cannot be opened. */
export function openCrmToken(stored: string): string {
  return isSealed(stored) ? decryptSecret(stored) : stored
}
