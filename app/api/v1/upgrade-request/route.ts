export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { activeImpersonation } from '@/lib/impersonation/server'
import { findOpenAccessRequest, submitAccessRequest } from '@/lib/access/upgrade-requests'

/** R-225: featureKey is a feature id ('point_a') or a nav href ('/point-b') — short text, never an arbitrary blob. */
const bodySchema = z.object({ featureKey: z.string().trim().min(1).max(100) })

/**
 * POST /api/v1/upgrade-request — «Оставить заявку на доступ» (пейволл, меню).
 * Body: { featureKey }. The user comes from the session, never from the body.
 * One OPEN request per user (lib/access/upgrade-requests.ts): a repeat adds the
 * section to the existing request and answers { ok, requested: true, duplicate: true }.
 * Staff see the request in GIGA → «Заявки» → «Доступы». Payment is an intentional
 * stub: the request changes no tariff.
 *
 * GET — { ok, requested, features }: does the user already have an open request
 * (the paywall shows «Заявка отправлена» after a reload).
 */
export async function POST(req: NextRequest) {
  try {
    const sb = createServerClient()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    const userId = user.id

    // R-225: one admin request row per call — throttle per session user.
    const rl = await checkRateLimit(userId, 'upgrade-request', { max: 5, windowMs: 10 * 60_000 })
    if (rl.limited) return rateLimitResponse(rl)

    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: 'featureKey required' }, { status: 400 })
    }

    // «От имени» the request is the client's own decision — staff do not leave it for them.
    if (await activeImpersonation(userId)) {
      return NextResponse.json(
        { ok: false, error: 'impersonation', message: 'В режиме «от имени» заявку на доступ оставляет сам клиент.' },
        { status: 403 },
      )
    }

    const result = await submitAccessRequest(createServiceClient(), { userId, featureKey: parsed.data.featureKey })
    return NextResponse.json({ ok: true, requested: true, duplicate: !result.created, features: result.features })
  } catch (error) {
    console.error('[upgrade-request] POST error:', error instanceof Error ? error.message : error)
    return NextResponse.json({ ok: false, error: 'Не удалось отправить заявку' }, { status: 500 })
  }
}

export async function GET() {
  try {
    const sb = createServerClient()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    const open = await findOpenAccessRequest(createServiceClient(), user.id)
    return NextResponse.json({ ok: true, requested: !!open, features: open?.features ?? [] })
  } catch (error) {
    console.error('[upgrade-request] GET error:', error instanceof Error ? error.message : error)
    return NextResponse.json({ ok: false, error: 'Не удалось прочитать заявку' }, { status: 500 })
  }
}
