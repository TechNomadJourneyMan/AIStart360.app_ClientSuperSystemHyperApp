/**
 * lib/auth/invite-only-edge.ts — то, что правилу «регистрация по приглашению»
 * нужно в middleware (Edge runtime): PostgREST и GoTrue admin через
 * edgeSupabaseFetch служебным ключом, без supabase-js и node:crypto
 * (Раунд 4, B3; ревью W3A-1). Решение — lib/auth/invite-only-shared.ts.
 *
 * Вызывается ТОЛЬКО для клиента «на одобрении» без метки и без invited_at:
 * персонал и одобренные лишних запросов не делают. Режим кешируется на 5 с.
 */
import { edgeSupabaseFetch } from '@/lib/supabase/transport-edge'
import {
  INVITED_STATUSES,
  SIGNUP_BLOCKED_KEY,
  SIGNUP_BLOCKED_VALUE,
  pendingSignupVerdict,
  type PendingVerdict,
} from './invite-only-shared'

const TTL_MS = 5_000
let modeCache: { at: number; value: { mode: string; since: string | null } } | null = null
const UUID = /^[0-9a-f-]{36}$/i

function env(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  return url && key ? { url, key } : null
}

async function rows(path: string): Promise<unknown[] | null> {
  const e = env()
  if (!e) return null
  try {
    const res = await edgeSupabaseFetch(`${e.url}/rest/v1/${path}`, {
      headers: { apikey: e.key, Authorization: `Bearer ${e.key}` },
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

/** Режим регистрации и когда его записали; null — прочитать не удалось. Нет строки — 'approval'. */
export async function registrationModeEdge(): Promise<{ mode: string; since: string | null } | null> {
  if (modeCache && Date.now() - modeCache.at < TTL_MS) return modeCache.value
  const r = await rows('system_settings?key=eq.registration_mode&select=value,updated_at')
  if (!r) return null
  const row = r[0] as { value?: unknown; updated_at?: unknown } | undefined
  const raw = row?.value
  const mode = typeof raw === 'string' ? raw : (raw as { mode?: unknown } | null | undefined)?.mode
  const value = {
    mode: mode === 'open' || mode === 'approval' || mode === 'invite' ? mode : 'approval',
    since: typeof row?.updated_at === 'string' ? row.updated_at : null,
  }
  modeCache = { at: Date.now(), value }
  return value
}

/** Есть ли приглашение на эту почту; null — прочитать не удалось. */
export async function invitedEdge(email: string): Promise<boolean | null> {
  const statuses = INVITED_STATUSES.join(',')
  const r = await rows(`platform_invitations?email=eq.${encodeURIComponent(email)}&status=in.(${statuses})&select=id&limit=1`)
  return r === null ? null : r.length > 0
}

/** Поставить метку (best-effort): GoTrue admin, app_metadata сливается. */
export async function markSignupBlockedEdge(userId: string, now: Date = new Date()): Promise<void> {
  const e = env()
  if (!e || !UUID.test(userId)) return
  try {
    const res = await edgeSupabaseFetch(`${e.url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: 'PUT',
      headers: { apikey: e.key, Authorization: `Bearer ${e.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ app_metadata: { [SIGNUP_BLOCKED_KEY]: SIGNUP_BLOCKED_VALUE, signup_blocked_at: now.toISOString() } }),
      cache: 'no-store',
      signal: AbortSignal.timeout(3_000),
    })
    if (!res.ok) console.warn('[invite-only-edge] mark failed:', res.status)
  } catch (err) {
    console.warn('[invite-only-edge] mark failed:', err instanceof Error ? err.message : err)
  }
}

/** Правило для ожидающего без метки (middleware). */
export function pendingSignupVerdictEdge(user: { created_at?: string | null; invited_at?: string | null; email?: string | null }): Promise<PendingVerdict> {
  return pendingSignupVerdict(
    { createdAt: user.created_at, invitedAt: user.invited_at ?? null, email: user.email },
    { mode: registrationModeEdge, invited: invitedEdge },
  )
}

/** Tests only. */
export function __resetInviteOnlyEdgeCacheForTests(): void {
  modeCache = null
}
