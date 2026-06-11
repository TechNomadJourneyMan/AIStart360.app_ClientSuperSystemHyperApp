import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Server-side proxy for the Market Intelligence backend ("Mark-analytics", a
 * separate FastAPI service). The portal never talks to that service directly:
 * the browser calls /api/market/<path> and this route forwards the request to
 * `MARKET_API_URL` with the user's Supabase JWT.
 *
 * DATA INTEGRITY: this proxy NEVER fabricates data. If the backend is not
 * configured or unreachable it returns a 503 with a machine-readable error code
 * so the client can render an honest "service unavailable" state instead of
 * inventing numbers.
 *
 * Auth: requires a Supabase session. The upstream FastAPI service validates the
 * same Supabase JWT, so we forward the access token as a Bearer header.
 */

// Forwardable upstream paths (prefix match). Anything else → 404.
const ALLOWLIST = [
  'news/recent',
  'companies',
  'competitors/options',
  'competitors/wizard',
  'tenders/recent',
  // Read-only aggregate KPIs (/analytics/overview, /industry-distribution, ...)
  'analytics',
  'trends',
  'search',
] as const

const UPSTREAM_TIMEOUT_MS = 8000

function isAllowed(path: string): boolean {
  return ALLOWLIST.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
}

function getBaseUrl(): string | null {
  const raw = process.env.MARKET_API_URL
  if (!raw) return null
  return raw.replace(/\/+$/, '')
}

async function handle(
  req: Request,
  ctx: { params: { path?: string[] } },
  method: 'GET' | 'POST',
): Promise<NextResponse> {
  const segments = ctx.params.path
  const path = (segments ?? []).join('/')

  if (!isAllowed(path)) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  }

  // Require an authenticated session — never proxy market data anonymously.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const baseUrl = getBaseUrl()
  if (!baseUrl) {
    return NextResponse.json(
      { ok: false, error: 'market_api_not_configured' },
      { status: 503 },
    )
  }

  // Forward the user's access token so the upstream can validate the same
  // Supabase JWT (same Supabase project as the portal).
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const accessToken = session?.access_token

  const search = new URL(req.url).search
  const target = `${baseUrl}/${path}${search}`

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`

  let body: string | undefined
  if (method === 'POST') {
    headers['Content-Type'] = 'application/json'
    try {
      const json = await req.json()
      body = JSON.stringify(json ?? {})
    } catch {
      body = '{}'
    }
  }

  try {
    const upstream = await fetch(target, {
      method,
      headers,
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })

    // Pass through the upstream JSON envelope ({ data, meta, errors }) + status.
    let payload: unknown = null
    try {
      payload = await upstream.json()
    } catch {
      payload = null
    }

    return NextResponse.json(payload, { status: upstream.status })
  } catch (err) {
    console.error('[api/market proxy]', method, path, err)
    return NextResponse.json(
      { ok: false, error: 'market_api_unavailable' },
      { status: 503 },
    )
  }
}

export async function GET(req: Request, ctx: { params: { path?: string[] } }) {
  return handle(req, ctx, 'GET')
}

export async function POST(req: Request, ctx: { params: { path?: string[] } }) {
  return handle(req, ctx, 'POST')
}
