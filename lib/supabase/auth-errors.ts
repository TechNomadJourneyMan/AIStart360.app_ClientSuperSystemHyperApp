const EMAIL_RATE_LIMIT_PATTERNS = [
  /email\s+rate\s+limit\s+exceeded/i,
  /rate\s+limit/i,
  /too\s+many\s+requests/i,
]

const EMAIL_NOT_CONFIRMED_PATTERNS = [
  /email\s+not\s+confirmed/i,
]

export function isSupabaseEmailRateLimitError(message: string | null | undefined): boolean {
  if (!message) return false
  return EMAIL_RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(message))
}

export function isSupabaseEmailNotConfirmedError(message: string | null | undefined): boolean {
  if (!message) return false
  return EMAIL_NOT_CONFIRMED_PATTERNS.some((pattern) => pattern.test(message))
}
