/**
 * SSRF guard for stored document URLs. `documents.file_url` is later fetched
 * server-side by the parsing pipeline, so it must be constrained to files that
 * actually live in OUR Supabase Storage — never an arbitrary attacker-supplied
 * URL (which could target internal services or cloud metadata endpoints).
 */

/** True only for a public/sign URL under our own Supabase Storage host. */
export function isSupabaseStorageUrl(raw: unknown): boolean {
  if (typeof raw !== 'string' || raw.length === 0) return false

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }

  if (url.protocol !== 'https:') return false

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (base) {
    let allowedHost: string
    try {
      allowedHost = new URL(base).host
    } catch {
      return false
    }
    if (url.host !== allowedHost) return false
  } else if (!/\.supabase\.(co|in)$/i.test(url.host)) {
    // Fallback when the env var is absent: accept only *.supabase.co / *.supabase.in
    return false
  }

  // Must be a Storage object path.
  return url.pathname.startsWith('/storage/v1/object/')
}
