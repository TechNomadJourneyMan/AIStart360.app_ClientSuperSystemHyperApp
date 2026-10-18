export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { activeImpersonation } from '@/lib/impersonation/server'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { markPopup } from '@/lib/popups/store'

/**
 * PATCH /api/v1/popups/:id { action: 'seen'|'dismiss'|'snooze'|'acted', days?: 3|7|30 }
 * — what the signed-in user did with a pop-up. The id is checked against HIS
 * conversation (a foreign or non-staff message → 404, nothing written); the
 * state lands in comm_messages.metadata.popup. Refused «от имени»: an admin
 * must not mark the user's windows as seen or closed.
 */
const Body = z.object({
  action: z.enum(['seen', 'dismiss', 'snooze', 'acted']),
  days: z.union([z.literal(3), z.literal(7), z.literal(30)]).optional(),
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
    const done = await markPopup(createServiceClient(), user.id, params.id, parsed.data.action, { days: parsed.data.days })
    if (!done) return NextResponse.json({ ok: false, error: 'Не найдено' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[v1/popups/:id]', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'Не удалось сохранить' }, { status: 500 })
  }
}
