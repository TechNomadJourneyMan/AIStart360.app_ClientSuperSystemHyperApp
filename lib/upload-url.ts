/**
 * SSRF guard for stored document URLs. `documents.file_url` is later fetched
 * server-side by the parsing pipeline, so it must be constrained to files that
 * actually live in OUR Supabase Storage — never an arbitrary attacker-supplied
 * URL (which could target internal services or cloud metadata endpoints).
 */

/** True only for a public/sign URL under our own Supabase Storage origin (NEXT_PUBLIC_SUPABASE_URL). */
export function isSupabaseStorageUrl(raw: unknown): boolean {
  if (typeof raw !== 'string' || raw.length === 0) return false

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }

  if (url.protocol !== 'https:') return false

  // Only OUR Storage origin (Round 1, P: cloud audit): without NEXT_PUBLIC_SUPABASE_URL nothing is accepted —
  // the old «any *.supabase.co / *.supabase.in» fallback let a foreign cloud project's storage through.
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!base) return false
  let allowedOrigin: string
  try {
    allowedOrigin = new URL(base).origin
  } catch {
    return false
  }
  if (url.origin !== allowedOrigin) return false

  // Must be a Storage object path.
  return url.pathname.startsWith('/storage/v1/object/')
}
