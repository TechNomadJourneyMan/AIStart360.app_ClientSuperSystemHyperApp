/**
 * lib/mcp/pii.ts — personal data in MCP results.
 *
 * The rule is the panel's: without `users.sensitive` (MCP scope `clients:pii`)
 * contacts are masked with lib/admin/mask.ts (the same helpers the GIGA users
 * list, User 360 and the admin bot use), and free text that may carry a
 * contact (errors, notes) has e-mails and phone numbers masked. Names stay
 * visible, as in the panel. Survey answers and documents are never returned.
 */
import { maskEmail, maskPhone } from '@/lib/admin/mask'

const EMAIL_IN_TEXT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const PHONE_IN_TEXT = /\+?\d[\d\s().-]{7,}\d/g

export function contactEmail(v: string | null | undefined, pii: boolean): string | null {
  if (!v) return null
  return pii ? v : maskEmail(v)
}

export function contactPhone(v: string | null | undefined, pii: boolean): string | null {
  if (!v) return null
  return pii ? v : maskPhone(v)
}

/** Truncate free text and, without the PII scope, mask e-mails and phone numbers inside it. */
export function freeText(v: unknown, pii: boolean, max = 300): string | null {
  if (v === null || v === undefined) return null
  let s = String(v).replace(/\s+/g, ' ').trim()
  if (!pii) s = s.replace(EMAIL_IN_TEXT, (m) => maskEmail(m) ?? '***').replace(PHONE_IN_TEXT, (m) => maskPhone(m) ?? '•••')
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}
