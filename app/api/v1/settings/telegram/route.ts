export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { newLinkCode, botDeepLink, telegramConfigured, botUsername } from '@/lib/telegram'

/**
 * GET — статус привязки Telegram текущего пользователя.
 * POST /api/v1/settings/telegram — сгенерировать deep-link привязки.
 * DELETE — отвязать Telegram у текущего пользователя.
 *
 * Личность берётся из cookie-сессии (IDOR-safe). Запись в profiles идёт через
 * service-client с явным .eq('id', user.id): у profiles.UPDATE под сессией
 * бывает RLS silent no-op (см. admin-audit) — не рискуем молчаливой потерей.
 */
export async function GET() {
  const sb = createServerClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  let linked = false
  try {
    const svc = createServiceClient()
    const { data } = await svc
      .from('profiles')
      .select('telegram_chat_id')
      .eq('id', user.id)
      .maybeSingle()
    linked = Boolean((data as { telegram_chat_id?: string | null } | null)?.telegram_chat_id)
  } catch {
    linked = false // колонка ещё не создана (миграция 045) → не привязан
  }

  return NextResponse.json({
    ok: true,
    linked,
    configured: telegramConfigured() && Boolean(botUsername()),
  })
}

export async function POST() {
  const sb = createServerClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  if (!telegramConfigured() || !botUsername()) {
    return NextResponse.json({ ok: false, error: 'telegram_not_configured' }, { status: 503 })
  }

  const code = newLinkCode()
  const svc = createServiceClient()
  const { data, error } = await svc
    .from('profiles')
    .update({ telegram_link_code: code })
    .eq('id', user.id)
    .select('id')
  if (error || !data || data.length === 0) {
    console.error('[settings/telegram] set code failed', error)
    return NextResponse.json({ ok: false, error: 'db_error' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, url: botDeepLink(code) })
}

export async function DELETE() {
  const sb = createServerClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const svc = createServiceClient()
  const { error } = await svc
    .from('profiles')
    .update({ telegram_chat_id: null, telegram_link_code: null })
    .eq('id', user.id)
  if (error) {
    console.error('[settings/telegram] unlink failed', error)
    return NextResponse.json({ ok: false, error: 'db_error' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
