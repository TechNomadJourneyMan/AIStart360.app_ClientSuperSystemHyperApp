import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'

/**
 * One-time recovery codes for when the authenticator device is lost. Codes are
 * shown to the user exactly once and stored only as bcrypt hashes. Verification
 * consumes the matched code (caller removes it from the stored set).
 */

// Crockford-ish alphabet without ambiguous chars (no 0/O/1/I).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function normalize(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
}

/** e.g. "A7K2P-9QX4M". `count` codes of `len` chars each. */
export function generateBackupCodes(count = 10, len = 10): string[] {
  const codes: string[] = []
  for (let i = 0; i < count; i++) {
    const bytes = crypto.randomBytes(len)
    let c = ''
    for (let j = 0; j < len; j++) c += ALPHABET[bytes[j] % ALPHABET.length]
    codes.push(`${c.slice(0, 5)}-${c.slice(5)}`)
  }
  return codes
}

export async function hashBackupCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map((c) => bcrypt.hash(normalize(c), 10)))
}

/** Index of the hash matching `code`, or -1. Constant work per hash (bcrypt). */
export async function findBackupCodeIndex(code: string, hashes: string[]): Promise<number> {
  const n = normalize(code)
  if (!n) return -1
  for (let i = 0; i < hashes.length; i++) {
    if (hashes[i] && (await bcrypt.compare(n, hashes[i]))) return i
  }
  return -1
}
