import crypto from 'node:crypto'

/**
 * AES-256-GCM field encryption for secrets stored at rest — TOTP secrets and
 * (next) CRM access tokens. Authenticated encryption: tamper of the ciphertext
 * fails `decrypt()`.
 *
 * Key: `SECRETS_ENCRYPTION_KEY` — 32 bytes as hex (64 chars) or base64. Keep it
 * ONLY in prod secrets (Vercel env), never in git. Generate one with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *
 * Stored format: `v1:<iv>:<tag>:<ciphertext>` (each part base64url).
 */

function key(): Buffer {
  const raw = process.env.SECRETS_ENCRYPTION_KEY
  if (!raw) throw new Error('SECRETS_ENCRYPTION_KEY is not set')
  const k = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64')
  if (k.length !== 32) throw new Error('SECRETS_ENCRYPTION_KEY must decode to exactly 32 bytes')
  return k
}

export function isEncryptionConfigured(): boolean {
  try {
    key()
    return true
  } catch {
    return false
  }
}

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${ct.toString('base64url')}`
}

export function decryptSecret(payload: string): string {
  const [v, ivB, tagB, ctB] = payload.split(':')
  if (v !== 'v1' || !ivB || !tagB || !ctB) throw new Error('malformed ciphertext')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagB, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64url')), decipher.final()]).toString('utf8')
}
