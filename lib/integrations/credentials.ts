/**
 * Integration credentials at rest (integration_connections.secret_ciphertext,
 * migration 105).
 *
 * Unlike the older CRM token store, there is NO plaintext fallback: without
 * SECRETS_ENCRYPTION_KEY a connection cannot be saved (the CHECK constraint of
 * 105 rejects anything that is not «v1:…» as well). Credentials are a JSON
 * object (one or more fields of the provider's form) sealed as one value.
 */
import { decryptSecret, encryptSecret, isEncryptionConfigured } from '@/lib/crypto/secrets'

export class CredentialsUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CredentialsUnavailableError'
  }
}

export function credentialsStorageReady(): boolean {
  return isEncryptionConfigured()
}

export function sealCredentials(secret: Record<string, string>): string {
  if (!isEncryptionConfigured()) {
    throw new CredentialsUnavailableError('SECRETS_ENCRYPTION_KEY не настроен — ключи интеграций не сохраняются в открытом виде')
  }
  return encryptSecret(JSON.stringify(secret))
}

export function openCredentials(ciphertext: string | null | undefined): Record<string, string> {
  if (!ciphertext) throw new CredentialsUnavailableError('ключ интеграции не сохранён')
  let plain: string
  try {
    plain = decryptSecret(ciphertext)
  } catch {
    throw new CredentialsUnavailableError('ключ интеграции не расшифровывается (сменился SECRETS_ENCRYPTION_KEY?) — переподключите интеграцию')
  }
  const parsed = JSON.parse(plain) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new CredentialsUnavailableError('ключ интеграции повреждён')
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) if (typeof v === 'string') out[k] = v
  return out
}

/** Every secret value, for masking error texts. */
export function secretValues(secret: Record<string, string>): string[] {
  const out: string[] = []
  for (const v of Object.values(secret)) {
    out.push(v)
    // A JSON key file: mask its private key and key id separately too.
    if (v.trim().startsWith('{')) {
      try {
        const j = JSON.parse(v) as Record<string, unknown>
        for (const f of ['private_key', 'private_key_id', 'client_secret']) if (typeof j[f] === 'string') out.push(j[f] as string)
      } catch {
        /* not JSON */
      }
    }
  }
  return out.filter((s) => s.length >= 4)
}
