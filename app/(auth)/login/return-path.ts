export function safeInternalPath(value: string | null): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return null
  }

  try {
    const baseUrl = 'http://aistart360.internal'
    const parsed = new URL(value, baseUrl)

    if (parsed.origin !== baseUrl) {
      return null
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return null
  }
}
