/** R-138: an address for the logs — first letter and the domain (a***@company.kz). Never the full address. */
export function maskEmail(address: string | null | undefined): string {
  const value = (address ?? '').trim()
  const at = value.lastIndexOf('@')
  if (at < 1 || at === value.length - 1) return '***'
  return `${value[0]}***@${value.slice(at + 1)}`
}
