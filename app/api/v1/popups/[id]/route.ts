export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { activeImpersonation } from '@/lib/impersonation/server'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { patchInvite } from '@/lib/point-b/invites/store'
import { markPopup } from '@/lib/popups/store'

/**
 * PATCH /api/v1/popups/:id { action: 'seen'|'dismiss'|'snooze'|'acted', days?: 3|7|30, kind? }
 * — what the signed-in user did with a pop-up.
 *   - no kind / kind 'expert_message': the id is checked against HIS conversation (a foreign or non-staff
 *     message → 404, nothing written); the state lands in comm_messages.metadata.popup;
 *   - kind 'insight' | 'recommendation': a Point B invite of HIS (pb_invites; a foreign id → 404) —
 *     dismiss pauses the rule 14 days, snooze 3 / 7 / 30 days (lib/point-b/invites/store.ts).
 * Refused «от имени»: an admin must not mark the user's windows as seen or closed.
 */
const Body = z.object({
  action: z.enum(['seen', 'dismiss', 'snooze', 'acted']),
  days: z.union([z.literal(3), z.literal(7), z.literal(30)]).optional(),
  kind: z.enum(['expert_message', 'insight', 'recommendation']).optional(),
}).refine((b) => b.action !== 'snooze' || b.days !== undefined, { message: 'days' })

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { data: { user } } = await createServerClient().auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  if (await activeImpersonation(user.id)) {
    return NextResponse.json({ ok: false, error: 'В режиме «от имени» окна пользователя не меняются.' }, { status: 403 })
  }

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success || !params.id || params.id.length > 64) {
    return NextResponse.json({ ok: false, error: 'Неверный запрос' }, { status: 400 })
  }
  if (await isRateLimitedKey(user.id, 'popups-mark', { max: 60, windowMs: 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Слишком часто' }, { status: 429 })
  }

  try {
    const { action, days, kind } = parsed.data
    const done = kind === 'insight' || kind === 'recommendation'
      ? await patchInvite(createServiceClient(), { id: params.id, userId: user.id, action, days, now: new Date() })
      : await markPopup(createServiceClient(), user.id, params.id, action, { days })
    if (!done) return NextResponse.json({ ok: false, error: 'Не найдено' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    // migration 129 not applied: there is no invite to change
    if (/\((42P01|PGRST205)\)/.test(err instanceof Error ? err.message : '')) return NextResponse.json({ ok: false, error: 'Не найдено' }, { status: 404 })
    console.error('[v1/popups/:id]', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'Не удалось сохранить' }, { status: 500 })
  }
}
