/**
 * Edge-safe DB helpers for impersonation (plain PostgREST fetch with the
 * service key — no supabase-js, no node:crypto). Used only by middleware and
 * only when an impersonation cookie is present, so normal traffic pays nothing.
 */

const cache = new Map<string, { active: boolean; at: number }>()
const CACHE_MS = 15_000

function rest(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  return url && key ? { url, key } : null
}

/** Is the DB session still open? Fails CLOSED (unknown → inactive). */
export async function isImpersonationActiveEdge(sid: string): Promise<boolean> {
  const hit = cache.get(sid)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.active
  const r = rest()
  if (!r || !/^[0-9a-f-]{36}$/i.test(sid)) return false
  try {
    const res = await fetch(`${r.url}/rest/v1/impersonation_sessions?id=eq.${sid}&select=ended_at,expires_at`, {
      headers: { apikey: r.key, Authorization: `Bearer ${r.key}` },
      cache: 'no-store',
    })
    if (!res.ok) return false
    const rows = (await res.json()) as Array<{ ended_at: string | null; expires_at: string }>
    const row = rows[0]
    const active = !!row && !row.ended_at && new Date(row.expires_at).getTime() > Date.now()
    if (cache.size > 500) cache.clear()
    cache.set(sid, { active, at: Date.now() })
    return active
  } catch {
    return false
  }
}

export function forgetImpersonation(sid: string): void {
  cache.delete(sid)
}

/** Close a session that expired while the browser still held it. */
export async function endImpersonationEdge(sid: string, reason: string): Promise<void> {
  const r = rest()
  if (!r || !/^[0-9a-f-]{36}$/i.test(sid)) return
  forgetImpersonation(sid)
  try {
    await fetch(`${r.url}/rest/v1/impersonation_sessions?id=eq.${sid}&ended_at=is.null`, {
      method: 'PATCH',
      headers: { apikey: r.key, Authorization: `Bearer ${r.key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ ended_at: new Date().toISOString(), end_reason: reason }),
    })
  } catch {
    /* best-effort */
  }
}

/** Append an audit row for a request made inside an impersonation session. */
export async function auditImpersonatedRequestEdge(entry: {
  sid: string
  adminId: string
  adminLabel: string
  adminRole?: string | null
  targetUserId: string
  method: string
  path: string
  ip: string | null
  ua: string | null
}): Promise<void> {
  const r = rest()
  if (!r) return
  try {
    await fetch(`${r.url}/rest/v1/admin_audit_log`, {
      method: 'POST',
      headers: { apikey: r.key, Authorization: `Bearer ${r.key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        actor_id: entry.adminId,
        actor_kind: entry.adminId.startsWith('giga:') ? 'break_glass' : 'session',
        actor_email: entry.adminLabel,
        actor_role: entry.adminRole ?? null,
        target_user_id: entry.targetUserId,
        impersonation_session_id: entry.sid,
        action: 'impersonation.request',
        entity_type: 'api',
        entity_id: `${entry.method} ${entry.path}`.slice(0, 300),
        metadata: { method: entry.method, path: entry.path },
        ip_address: entry.ip,
        user_agent: entry.ua,
      }),
    })
  } catch {
    /* the route itself also audits data changes */
  }
}
