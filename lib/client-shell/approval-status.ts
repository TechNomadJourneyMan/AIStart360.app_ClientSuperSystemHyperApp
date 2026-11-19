/**
 * The signed-in client's own approval status (GET /api/client/status).
 *
 * R-250: identity comes from the session cookie only — the URL carries no user id (it used to
 * be ?userId=<id>: visible in proxy / access logs and the browser history, and never read by the
 * route). Returns null when the status could not be read.
 */
export async function fetchOwnApprovalStatus(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl('/api/client/status', { cache: 'no-store', credentials: 'same-origin' })
    if (!res.ok) return null
    const data = (await res.json()) as { status?: unknown } | null
    return typeof data?.status === 'string' ? data.status : null
  } catch {
    return null
  }
}
