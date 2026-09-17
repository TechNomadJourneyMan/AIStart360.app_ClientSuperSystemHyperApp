/** Redaction for staff without `users.sensitive` (e.g. analysts). */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null
  const [name, domain] = email.split('@')
  if (!domain) return '***'
  return `${name.slice(0, 1)}***@${domain}`
}

export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  return digits.length > 4 ? `•••${digits.slice(-2)}` : '•••'
}
