/**
 * Middleware-side settings (PostgREST fetch, Edge-safe, 5 s cache).
 * Only the few switches middleware enforces are read here.
 */
interface EdgeSettings {
  maintenance: { enabled: boolean; message: string; until: string }
  staff_require_mfa: boolean
}

const DEFAULTS: EdgeSettings = {
  maintenance: { enabled: false, message: '', until: '' },
  staff_require_mfa: false,
}

let cache: { at: number; value: EdgeSettings } | null = null
const TTL_MS = 5_000

export async function edgeSettings(): Promise<EdgeSettings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return DEFAULTS
  try {
    const res = await fetch(`${url}/rest/v1/system_settings?select=key,value&key=in.(maintenance,staff_require_mfa)`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(String(res.status))
    const rows = (await res.json()) as Array<{ key: string; value: unknown }>
    const get = (k: string) => rows.find((r) => r.key === k)?.value
    const m = get('maintenance') as Partial<EdgeSettings['maintenance']> | undefined
    const value: EdgeSettings = {
      maintenance: {
        enabled: m?.enabled === true,
        message: typeof m?.message === 'string' ? m.message : '',
        until: typeof m?.until === 'string' ? m.until : '',
      },
      staff_require_mfa: get('staff_require_mfa') === true,
    }
    cache = { at: Date.now(), value }
    return value
  } catch {
    // Unknown state: keep the last known value (or safe defaults).
    return cache?.value ?? DEFAULTS
  }
}
