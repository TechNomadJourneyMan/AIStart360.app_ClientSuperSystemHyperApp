/**
 * Edge-safe DB helpers for impersonation (plain PostgREST fetch with the
 * service key — no supabase-js, no node:crypto). Used only by middleware.
 * The row itself is read and cached in state-edge.ts (R-008).
 */
import { edgeSupabaseFetch } from '@/lib/supabase/transport-edge'
import { forgetImpersonationRow, impersonationRowEdge } from './state-edge'

function rest(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  return url && key ? { url, key } : null
}

/**
 * Is the DB session still open? Fails CLOSED (unknown → inactive). The row is
 * read and cached by state-edge.ts (R-008), which also gives its mode.
 */
export async function isImpersonationActiveEdge(sid: string): Promise<boolean> {
  return (await impersonationRowEdge(sid))?.active === true
}

export function forgetImpersonation(sid: string): void {
  forgetImpersonationRow(sid)
}

/** Close a session that expired while the browser still held it. */
export async function endImpersonationEdge(sid: string, reason: string): Promise<void> {
  const r = rest()
  if (!r || !/^[0-9a-f-]{36}$/i.test(sid)) return
  forgetImpersonation(sid)
  try {
    await edgeSupabaseFetch(`${r.url}/rest/v1/impersonation_sessions?id=eq.${sid}&ended_at=is.null`, {
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
    await edgeSupabaseFetch(`${r.url}/rest/v1/admin_audit_log`, {
      method: 'POST',
      headers: { apikey: r.key, Authorization: `Bearer ${r.key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        actor_id: entry.adminId,
        actor_kind: 'session',
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
