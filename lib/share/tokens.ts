import { randomBytes } from 'crypto'
import type { SharedReport, SharedReportType } from '@prisma/client'

/**
 * Pure-ish helpers for shareable read-only report links.
 *
 * A SharedReport is a token-addressed pointer to a report (survey/gri/point_a/
 * point_b) for a company. `audienceRoles` (empty = anyone-with-link) gates which
 * referenced roles may consume the link; access-control enforcement lives above
 * this layer — these helpers only handle token lifecycle + validity.
 *
 * PERSISTENCE: these go through the Supabase service-role REST API (PostgREST),
 * NOT Prisma. The public viewer (`/r/[token]`) is the critical path and must not
 * hard-fail on a transient Prisma/pgBouncer pooler cold-start — the REST API has
 * no such cold-start and mirrors how `lib/share/report-data.ts` loads the report
 * payload. The `shared_reports` columns are camelCase (Prisma default, no @map),
 * so PostgREST rows line up 1:1 with the Prisma `SharedReport` field names.
 */

function srBase() {
  return {
    url: (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, ''),
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
  }
}

/** Low-level service-role fetch against PostgREST. Throws on transport/HTTP error. */
async function sr(path: string, init: RequestInit & { prefer?: string } = {}): Promise<Response> {
  const { url, key } = srBase()
  if (!url || !key) throw new Error('[share/tokens] missing Supabase service-role env')
  const headers: Record<string, string> = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...(init.prefer ? { Prefer: init.prefer } : {}),
    ...((init.headers as Record<string, string>) ?? {}),
  }
  return fetch(`${url}/rest/v1/${path}`, { ...init, headers, cache: 'no-store' })
}

/** Normalise a raw PostgREST row (ISO date strings) into a Prisma-shaped SharedReport. */
function toShare(row: Record<string, unknown>): SharedReport {
  return {
    id: String(row.id),
    token: String(row.token),
    type: row.type as SharedReportType,
    companyId: String(row.companyId),
    createdById: (row.createdById as string | null) ?? null,
    audienceRoles: Array.isArray(row.audienceRoles) ? (row.audienceRoles as string[]) : [],
    expiresAt: row.expiresAt ? new Date(row.expiresAt as string) : null,
    revoked: Boolean(row.revoked),
    views: Number(row.views ?? 0),
    createdAt: row.createdAt ? new Date(row.createdAt as string) : new Date(),
  }
}

export interface CreateShareInput {
  type: SharedReportType
  companyId: string
  createdById?: string
  /** Empty/omitted = anyone-with-link. Allowed: "expert" | "admin" | "client_employee". */
  audienceRoles?: string[]
  /** If set, link expires this many days from creation. */
  expiresInDays?: number
}

/** Generate a URL-safe random share token. */
export function generateShareToken(): string {
  return randomBytes(16).toString('base64url')
}

/**
 * Create a new share link and return its token. THROWS on persistent failure —
 * the caller (/api/share) maps the throw to a 500, which is correct for an
 * authenticated staff action. Tolerates a transient error with ONE retry before
 * giving up so a pooler/network blip doesn't fail an otherwise-valid request.
 */
export async function createShare(
  input: CreateShareInput,
): Promise<{ token: string }> {
  const token = generateShareToken()
  const expiresAt =
    input.expiresInDays != null
      ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
      : null

  const body = JSON.stringify({
    // id has no DB default (Prisma normally supplies a cuid) — generate one here.
    id: 'shr_' + randomBytes(16).toString('base64url'),
    token,
    type: input.type,
    companyId: input.companyId,
    createdById: input.createdById ?? null,
    audienceRoles: input.audienceRoles ?? [],
    expiresAt,
  })

  let lastErr: unknown = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await sr('shared_reports', {
        method: 'POST',
        prefer: 'return=minimal',
        body,
      })
      if (res.ok) return { token }
      lastErr = new Error(
        `[share/tokens] create failed ${res.status}: ${await res.text().catch(() => '')}`,
      )
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error('[share/tokens] create failed')
}

/**
 * Look up a share by token. Returns null if the token is unknown, revoked, or
 * expired. Does not mutate (use `incrementShareViews` to record a view).
 *
 * CRITICAL: the public viewer (`/r/[token]`) calls this and MUST NOT hard-fail —
 * a transient transport/HTTP error must degrade to the InvalidLink card, never
 * the global 500 page. So on any non-ok response or fetch exception → return
 * null (treated as "unknown token") rather than throwing.
 */
export async function getShareByToken(
  token: string,
): Promise<SharedReport | null> {
  let res: Response
  try {
    res = await sr(`shared_reports?token=eq.${encodeURIComponent(token)}&limit=1`, {
      method: 'GET',
    })
  } catch (err) {
    console.warn('[share/tokens] lookup transport error (degrading to null)', err)
    return null
  }
  if (!res.ok) {
    console.warn(`[share/tokens] lookup failed ${res.status} (degrading to null)`)
    return null
  }
  const rows = (await res.json().catch(() => [])) as Record<string, unknown>[]
  const row = Array.isArray(rows) ? rows[0] : null
  if (!row) return null

  const share = toShare(row)
  if (share.revoked) return null
  if (share.expiresAt && share.expiresAt.getTime() <= Date.now()) return null
  return share
}

/**
 * Increment the view counter for a token (best-effort, non-atomic — a view
 * counter tolerates the occasional race). No-op if the token is unknown or
 * revoked. Returns the number of rows updated. Fully swallows transport/HTTP
 * errors (returns 0) so a view-count failure never bubbles into the viewer.
 */
export async function incrementShareViews(token: string): Promise<number> {
  try {
    const cur = await sr(
      `shared_reports?token=eq.${encodeURIComponent(token)}&revoked=eq.false&select=views`,
      { method: 'GET' },
    )
    if (!cur.ok) return 0
    const rows = (await cur.json().catch(() => [])) as { views?: number }[]
    if (!rows.length) return 0
    const next = Number(rows[0].views ?? 0) + 1

    const res = await sr(
      `shared_reports?token=eq.${encodeURIComponent(token)}&revoked=eq.false`,
      { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ views: next }) },
    )
    return res.ok ? 1 : 0
  } catch (err) {
    console.warn('[share/tokens] incrementShareViews failed (best-effort)', err)
    return 0
  }
}

/**
 * Revoke a share so it can no longer be resolved. Idempotent. Returns the number
 * of rows updated (0 if the token is unknown). Best-effort: swallows transport/
 * HTTP errors and returns 0 rather than throwing.
 */
export async function revokeShare(token: string): Promise<number> {
  try {
    const res = await sr(`shared_reports?token=eq.${encodeURIComponent(token)}`, {
      method: 'PATCH',
      prefer: 'return=representation',
      body: JSON.stringify({ revoked: true }),
    })
    if (!res.ok) return 0
    const rows = (await res.json().catch(() => [])) as unknown[]
    return Array.isArray(rows) ? rows.length : 0
  } catch (err) {
    console.warn('[share/tokens] revokeShare failed (best-effort)', err)
    return 0
  }
}
