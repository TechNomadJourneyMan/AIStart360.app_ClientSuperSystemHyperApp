/**
 * Edge-safe server-side state of impersonation sessions (R-008): the
 * impersonation_sessions row (expiry, end, mode) and the binding of a Supabase
 * session to it. Plain PostgREST fetch with the service key — no supabase-js,
 * no node:crypto. Used by middleware.
 *
 * Caches (per server instance):
 *  - rows: 15 s, so closing a session from the panel takes effect within
 *    seconds;
 *  - bindings: a session that is NOT bound stays unbound for good (the binding
 *    is written before the minted session is handed to the browser), so the
 *    negative answer is cached until the map is recycled — every ordinary
 *    session costs one indexed read per instance. Read errors are not cached.
 */
import { edgeSupabaseFetch } from '@/lib/supabase/transport-edge'
import { NO_SESSION_ID } from '@/lib/mfa/session-binding'
import { IMP_BINDING_ACTION, IMP_BINDING_ENTITY, type ImpersonationMode } from './token'

export interface ImpersonationRowState {
  active: boolean
  mode: ImpersonationMode
  targetUserId: string
}

const ROW_CACHE_MS = 15_000
const rows = new Map<string, { row: ImpersonationRowState | null; at: number }>()
const bindings = new Map<string, string | null>()
const UUID = /^[0-9a-f-]{36}$/i

function rest(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  return url && key ? { url, key } : null
}

async function getRows(path: string): Promise<unknown[] | null> {
  const r = rest()
  if (!r) return null
  try {
    const res = await edgeSupabaseFetch(`${r.url}/rest/v1/${path}`, {
      headers: { apikey: r.key, Authorization: `Bearer ${r.key}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(3_000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as unknown
    return Array.isArray(data) ? data : null
  } catch {
    return null
  }
}

/**
 * The DB state of impersonation `sid`: null when there is no such row OR it
 * cannot be read (callers treat both as «not active» — fail closed).
 */
export async function impersonationRowEdge(sid: string): Promise<ImpersonationRowState | null> {
  if (!UUID.test(sid)) return null
  const hit = rows.get(sid)
  if (hit && Date.now() - hit.at < ROW_CACHE_MS) return hit.row
  const data = await getRows(`impersonation_sessions?id=eq.${sid}&select=ended_at,expires_at,mode,target_user_id`)
  if (!data) return null
  const raw = data[0] as { ended_at: string | null; expires_at: string; mode: string; target_user_id: string } | undefined
  const row: ImpersonationRowState | null = raw
    ? {
        active: !raw.ended_at && new Date(raw.expires_at).getTime() > Date.now(),
        mode: raw.mode === 'edit' ? 'edit' : 'view',
        targetUserId: raw.target_user_id,
      }
    : null
  if (rows.size > 500) rows.clear()
  rows.set(sid, { row, at: Date.now() })
  return row
}

export function forgetImpersonationRow(sid: string): void {
  rows.delete(sid)
}

/**
 * The impersonation id a Supabase session (GoTrue `session_id`) was minted
 * for; null for an ordinary session; 'unknown' when it cannot be read now.
 */
export async function boundImpersonationEdge(sessionKey: string | null | undefined): Promise<string | null | 'unknown'> {
  if (!sessionKey || sessionKey === NO_SESSION_ID || !UUID.test(sessionKey)) return null
  if (bindings.has(sessionKey)) return bindings.get(sessionKey) ?? null
  const data = await getRows(
    `admin_audit_log?action=eq.${encodeURIComponent(IMP_BINDING_ACTION)}&entity_type=eq.${IMP_BINDING_ENTITY}&entity_id=eq.${sessionKey}&select=impersonation_session_id&limit=1`,
  )
  if (!data) return 'unknown'
  const sid = (data[0] as { impersonation_session_id?: string | null } | undefined)?.impersonation_session_id ?? null
  if (bindings.size > 20_000) bindings.clear()
  bindings.set(sessionKey, sid)
  return sid
}
