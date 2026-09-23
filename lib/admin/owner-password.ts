/**
 * lib/admin/owner-password.ts — пароль входа в ГИГА-Панель, которого нет в БД.
 *
 * Вход в панель — только владелец (GIGA_OWNER_EMAIL) и пароль. Сам пароль
 * нигде не хранится: в окружении лежит лишь его scrypt-хеш
 * (GIGA_OWNER_PASSWORD_HASH), в Supabase — ничего. После проверки сервер
 * создаёт обычную личную сессию Supabase для аккаунта владельца, так что
 * каждое действие в панели записывается на человека, а не на «общий пароль».
 *
 * Формат хеша: `scrypt:<N>:<salt-hex>:<hash-hex>` — без символа `$`, чтобы
 * .env-загрузчик Next.js не пытался подставлять в него переменные.
 * Получить хеш: `npx tsx scripts/set-giga-password.ts`.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

export const DEFAULT_OWNER_EMAIL = 'technomadjourneyman@gmail.com'
const KEY_LEN = 64
const DEFAULT_N = 16384
export const MAX_PASSWORD_LENGTH = 512

export function ownerEmail(): string {
  return (process.env.GIGA_OWNER_EMAIL || DEFAULT_OWNER_EMAIL).trim().toLowerCase()
}

export function hashOwnerPassword(password: string, n = DEFAULT_N): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, KEY_LEN, { N: n, maxmem: 64 * 1024 * 1024 })
  return `scrypt:${n}:${salt.toString('hex')}:${hash.toString('hex')}`
}

/** Constant-time check against the stored hash. Malformed hash → false. */
export function verifyOwnerPassword(password: string, stored: string | undefined | null): boolean {
  if (!stored || !password || password.length > MAX_PASSWORD_LENGTH) return false
  const m = /^scrypt:(\d{4,7}):([0-9a-f]{32}):([0-9a-f]{128})$/.exec(stored.trim())
  if (!m) return false
  const n = Number(m[1])
  if (n & (n - 1)) return false // N must be a power of two
  try {
    const expected = Buffer.from(m[3], 'hex')
    const actual = scryptSync(password, Buffer.from(m[2], 'hex'), KEY_LEN, { N: n, maxmem: 64 * 1024 * 1024 })
    return timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}
