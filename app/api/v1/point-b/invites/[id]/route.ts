export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { gateFeature } from '@/lib/access/gate'
import { activeImpersonation } from '@/lib/impersonation/server'
import { patchInvite } from '@/lib/point-b/invites/store'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'

/**
 * PATCH /api/v1/point-b/invites/:id { action: 'seen' | 'dismiss' | 'snooze' | 'acted', days?: 3 | 7 | 30 }
 * — what the signed-in client did with an invite card of the Point B page (spec §12.1):
 *   dismiss = «Закрыть» (the rule pauses 14 days), snooze = «Позже» (3 / 7 / 30 days), acted = «Открыть».
 * Only the session user's own invite (a foreign or unknown id → 404, nothing written). Refused «от имени» (403):
 * an admin must not close the client's invites. Point B is a PRO feature (402 for a free client while the access
 * gates are on). → { ok: true }
 */
const Body = z.object({
  action: z.enum(['seen', 'dismiss', 'snooze', 'acted']),
  days: z.union([z.literal(3), z.literal(7), z.literal(30)]).optional(),
}).refine((b) => b.action !== 'snooze' || b.days !== undefined, { message: 'days' })

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  if (await activeImpersonation(user.id)) {
    return NextResponse.json({ ok: false, error: 'В режиме «от имени» подсказки пользователя не меняются.' }, { status: 403 })
  }
  const upgrade = await gateFeature(sb, user.id, 'point_b', { exemptStaff: true })
  if (upgrade) return upgrade

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Неверный запрос' }, { status: 400 })
  if (!UUID.test(params.id ?? '')) return NextResponse.json({ ok: false, error: 'Не найдено' }, { status: 404 })
  if (await isRateLimitedKey(user.id, 'pb-invites-mark', { max: 60, windowMs: 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Слишком часто' }, { status: 429 })
  }

  try {
    const done = await patchInvite(createServiceClient(), { id: params.id, userId: user.id, action: parsed.data.action, days: parsed.data.days, now: new Date() })
    if (!done) return NextResponse.json({ ok: false, error: 'Не найдено' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // migration 129 not applied: there is no invite to change
    if (/\((42P01|PGRST205)\)/.test(message)) return NextResponse.json({ ok: false, error: 'Не найдено' }, { status: 404 })
    console.error('[v1/point-b/invites/:id]', message)
    return NextResponse.json({ ok: false, error: 'Не удалось сохранить' }, { status: 500 })
  }
}
