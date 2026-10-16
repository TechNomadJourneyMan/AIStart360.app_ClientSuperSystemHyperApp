export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { activeImpersonation } from '@/lib/impersonation/server'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { clientFeed } from '@/lib/comm/client'
import { recordInbound } from '@/lib/comm/inbound'
import { cleanBody } from '@/lib/comm/send'
import { CommError } from '@/lib/comm/store'

/**
 * POST /api/v1/comm/messages { body } — the signed-in user writes to the
 * platform from the cabinet: an inbound 'app' message in HIS conversation
 * (the user comes from the session; any id in the body is ignored). Staff
 * are notified as for Telegram / WhatsApp (lib/comm/inbound.ts).
 *
 * An admin driving the cabinet «от имени» cannot write as the user — the
 * answer belongs in GIGA «Сообщения». 20 messages per 10 minutes per user.
 */
export async function POST(req: NextRequest) {
  const { data: { user } } = await createServerClient().auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  if (await activeImpersonation(user.id)) {
    return NextResponse.json({ ok: false, error: 'В режиме «от имени» писать за пользователя нельзя — ответьте из GIGA «Сообщения».' }, { status: 403 })
  }

  const raw = (await req.json().catch(() => null)) as { body?: unknown } | null
  let body: string
  try {
    body = cleanBody(raw?.body)
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof CommError ? err.message : 'Неверный запрос' }, { status: 400 })
  }
  if (await isRateLimitedKey(user.id, 'comm-client-send', { max: 20, windowMs: 10 * 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Слишком много сообщений подряд — подождите несколько минут' }, { status: 429 })
  }

  try {
    const res = await recordInbound({ userId: user.id, channel: 'app', body }, { sb: createServiceClient() })
    const message = res.message ? clientFeed([res.message])[0] ?? null : null
    return NextResponse.json({ ok: true, data: { message } })
  } catch (err) {
    console.error('[v1/comm/messages]', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'Не удалось отправить сообщение' }, { status: 500 })
  }
}
