/**
 * Middleware-side section gate (PostgREST fetch, Edge-safe). Loaded sections are
 * cached per instance for 60 s; user facts are fetched only when the requested
 * path belongs to a section that is disabled or segment-restricted.
 */
import { isVisible, type UserFacts } from './visibility'

interface EdgeSection { key: string; paths: string[]; enabled: boolean; visibility: unknown }

let cache: { at: number; rows: EdgeSection[] } | null = null
const TTL_MS = 60_000

function rest() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  return url && key ? { url, key } : null
}

async function sections(): Promise<EdgeSection[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows
  const r = rest()
  if (!r) return []
  try {
    const res = await fetch(`${r.url}/rest/v1/platform_sections?select=key,paths,enabled,visibility`, {
      headers: { apikey: r.key, Authorization: `Bearer ${r.key}` },
      cache: 'no-store',
    })
    const rows = res.ok ? ((await res.json()) as EdgeSection[]) : []
    cache = { at: Date.now(), rows }
    return rows
  } catch {
    return cache?.rows ?? []
  }
}

async function facts(userId: string): Promise<UserFacts | null> {
  const r = rest()
  if (!r) return null
  try {
    const res = await fetch(`${r.url}/rest/v1/rpc/user_segment_facts`, {
      method: 'POST',
      headers: { apikey: r.key, Authorization: `Bearer ${r.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_user: userId }),
      cache: 'no-store',
    })
    return res.ok ? ((await res.json()) as UserFacts) : null
  } catch {
    return null
  }
}

/** Key of the section that blocks `pathname` for this client, or null. */
export async function blockedSectionFor(pathname: string, userId: string): Promise<string | null> {
  const all = await sections()
  const match = all.find((s) => s.paths.some((p) => pathname === p || pathname.startsWith(`${p}/`)))
  if (!match) return null
  if (!match.enabled) return match.key
  const rule = match.visibility as { audience?: string } | null
  if (!rule || rule.audience === 'all') return null
  return isVisible(match.visibility, await facts(userId)) ? null : match.key
}

export function resetSectionCache(): void {
  cache = null
}
