/**
 * lib/registration/risk.ts — self-serve activation risk scoring (D3).
 *
 * Pure heuristic that decides whether a new registration can be auto-approved or
 * needs manual review. Used only in the opt-in 'auto' registration mode; the
 * default 'approval' mode is unchanged. Signals come from the caller (email,
 * IP-burst count, form timing…). See spec 04 §D3.
 */

const THRESHOLD_AUTO = 30

const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com',
  'temp-mail.org', 'yopmail.com', 'trashmail.com', 'getnada.com', 'sharklasers.com',
  'throwawaymail.com', 'maildrop.cc', 'fakeinbox.com', 'dispostable.com',
])

const SPAM_TERMS = /\b(free\s*crypto|casino|viagra|loan[s]?|forex|betting|porn|escort|\$\$\$|earn\s+\$?\d+k)\b/i
const BANNED_TOPICS = /\b(weapon[s]?|наркотик|drugs|counterfeit|hacking\s+service|отмыв)/i

export interface RegistrationCandidate {
  email: string
  name?: string
  organization?: string
  aboutText?: string
  /** How many registrations from this IP in the last 24h (from a counter). */
  ipRegistrationsLast24h?: number
  /** Whether the email is confirmed. `false` blocks auto-approval outright. */
  emailConfirmed?: boolean
  /** How long the form took to fill, ms (bot detection). */
  formFillMs?: number
  previouslyRejected?: boolean
}

export interface RiskAssessment {
  score: number
  flags: string[]
  recommend: 'auto_approve' | 'manual_review'
}

function emailDomain(email: string): string {
  const at = email.lastIndexOf('@')
  return at >= 0 ? email.slice(at + 1).toLowerCase().trim() : ''
}

export function computeRiskFlags(c: RegistrationCandidate): RiskAssessment {
  const flags: string[] = []
  let score = 0

  if (DISPOSABLE_DOMAINS.has(emailDomain(c.email))) { score += 25; flags.push('disposable_email') }

  if ((c.ipRegistrationsLast24h ?? 0) >= 3) { score += 30; flags.push('ip_burst') }

  const text = `${c.name ?? ''} ${c.organization ?? ''}`
  if (SPAM_TERMS.test(text)) { score += 20; flags.push('spam_terms') }

  if (c.aboutText && BANNED_TOPICS.test(c.aboutText)) { score += 40; flags.push('banned_topic') }

  if (c.formFillMs != null && c.formFillMs < 5000) { score += 15; flags.push('too_fast') }

  if (c.previouslyRejected) { score += 40; flags.push('previously_rejected') }

  // Email verification is a hard prerequisite for auto-approval.
  const emailBlocks = c.emailConfirmed === false

  const recommend = score < THRESHOLD_AUTO && !emailBlocks ? 'auto_approve' : 'manual_review'
  return { score, flags, recommend }
}
