export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase-server'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { safeErrorMessage } from '@/lib/api-error'

/**
 * GET  /api/v1/consents            → { ok, consents: { [kind]: boolean } }
 * PUT  /api/v1/consents { kind, granted } → { ok }
 *
 * User consent ledger (migration 047). Cookie session only; RLS scopes rows to
 * auth.uid(). Consent kinds gate psych personalization, digests, benchmark
 * contribution and mini-GRI contact — checked server-side before those run.
 */
const KINDS = [
  'psych_profile', 'weekly_digest_email', 'weekly_digest_telegram',
  'benchmarks_contribution', 'mini_gri_contact', 'personalization',
] as const

export async function GET(_req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await sb
    .from('user_consents')
    .select('kind, granted')
    .eq('user_id', user.id)
  if (error) return NextResponse.json({ ok: false, error: safeErrorMessage(error) }, { status: 500 })

  const consents = Object.fromEntries(KINDS.map((k) => [k, false])) as Record<string, boolean>
  for (const row of (data ?? []) as Array<{ kind: string; granted: boolean }>) {
    if (row.kind in consents) consents[row.kind] = !!row.granted
  }
  return NextResponse.json({ ok: true, consents })
}

const putSchema = z.object({
  kind: z.enum(KINDS),
  granted: z.boolean(),
  textVersion: z.string().max(40).optional(),
})

export async function PUT(req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  if (await isRateLimitedKey(user.id, 'consents-put', { max: 20, windowMs: 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Слишком часто. Попробуйте позже.' }, { status: 429 })
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 })
  }

  const parsed = putSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid consent' }, { status: 400 })
  }
  const { kind, granted, textVersion } = parsed.data
  const now = new Date().toISOString()

  const { error } = await sb.from('user_consents').upsert(
    {
      user_id: user.id,
      kind,
      granted,
      granted_at: granted ? now : null,
      revoked_at: granted ? null : now,
      text_version: textVersion ?? null,
      updated_at: now,
    },
    { onConflict: 'user_id,kind' },
  )
  if (error) return NextResponse.json({ ok: false, error: safeErrorMessage(error) }, { status: 500 })
  return NextResponse.json({ ok: true })
}
