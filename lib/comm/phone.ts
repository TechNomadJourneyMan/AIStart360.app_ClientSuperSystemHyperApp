/**
 * lib/comm/phone.ts — a phone number reduced to its E.164 digits.
 *
 * The SAME rule lives in SQL as public.comm_phone_key() (migration 120); an
 * expression index on profiles uses it, so «which user wrote from this
 * WhatsApp number» is one indexed lookup (comm_user_by_phone). Change both
 * together.
 *
 *   digits only (spaces, brackets, dashes, «+» dropped)
 *   8XXXXXXXXXX (11 digits, KZ/RU domestic)  → 7XXXXXXXXXX
 *   7XXXXXXXXX / 9XXXXXXXXX (10 digits)      → 7 + digits (country code omitted)
 *   11–15 digits not starting with 0          → as is
 *   anything else                             → null
 */

export function phoneKey(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const d = raw.replace(/\D/g, '')
  if (!d) return null
  if (d.length === 11 && d.startsWith('8')) return `7${d.slice(1)}`
  if (d.length === 10 && (d.startsWith('7') || d.startsWith('9'))) return `7${d}`
  if (d.length >= 11 && d.length <= 15 && !d.startsWith('0')) return d
  return null
}

/** «+77011234567» or null. */
export function phoneE164(raw: string | null | undefined): string | null {
  const k = phoneKey(raw)
  return k ? `+${k}` : null
}

/** One-to-one WhatsApp JID of a number, e.g. `77011234567@s.whatsapp.net`. */
export function whatsappJid(raw: string | null | undefined): string | null {
  const k = phoneKey(raw)
  return k ? `${k}@s.whatsapp.net` : null
}
