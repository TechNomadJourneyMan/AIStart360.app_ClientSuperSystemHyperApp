export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { DEV_MODE_COOKIE, DEV_MODE_COOKIE_OPTIONS, devAccessEnabledForRequest, devNotFound } from '@/lib/dev/dev-access'

/**
 * POST /api/dev/mode { on } — the developer's own switch: sets or clears the
 * cookie that makes middleware skip the maintenance page and the 2FA pages on
 * this computer. Dev-only: 404 unless lib/dev/dev-access.ts allows the
 * request; in a production build that guard is the constant `false`, and
 * middleware ignores the cookie for the same reason.
 */
const bodySchema = z.object({ on: z.boolean() }).strict()

export async function POST(request: NextRequest) {
  if (!devAccessEnabledForRequest(request)) return devNotFound()

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_PAYLOAD' }, { status: 400 })

  const res = NextResponse.json({ ok: true, devMode: parsed.data.on })
  if (parsed.data.on) res.cookies.set(DEV_MODE_COOKIE, '1', DEV_MODE_COOKIE_OPTIONS)
  else res.cookies.set(DEV_MODE_COOKIE, '', { ...DEV_MODE_COOKIE_OPTIONS, maxAge: 0 })
  return res
}

// Any other method: there is no such route (Next.js would answer 405 / 204).
export { devNotFound as GET, devNotFound as PUT, devNotFound as PATCH, devNotFound as DELETE, devNotFound as OPTIONS }
