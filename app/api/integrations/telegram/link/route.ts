export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import {
  buildTelegramPersonalLink,
  createTelegramPersonalLinkCode,
  hashTelegramLinkToken,
} from '@/lib/telegram/private-bot'
import { createTelegramAdminClient } from '@/lib/telegram/profiles'

const LINK_TTL_MINUTES = 15

async function requireUser() {
  const sb = createServerClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  return user
}

function personalUsername(): string | undefined {
  return process.env.TELEGRAM_PERSONAL_USERNAME
}

export async function GET(_req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const admin = createTelegramAdminClient()
    const { data, error } = await admin
      .from('profiles')
      .select('telegram_chat_id,telegram_username,telegram_linked_at')
      .eq('id', user.id)
      .maybeSingle()

    if (error) {
      console.error('[telegram/link] status failed:', error)
      return NextResponse.json({ ok: false, error: 'Failed to load Telegram status' }, { status: 500 })
    }

    const row = (data ?? {}) as {
      telegram_chat_id?: string | null
      telegram_username?: string | null
      telegram_linked_at?: string | null
    }

    return NextResponse.json({
      ok: true,
      linked: Boolean(row.telegram_chat_id),
      telegramUsername: row.telegram_username ?? null,
      linkedAt: row.telegram_linked_at ?? null,
      personalUsername: personalUsername() ?? null,
    })
  } catch (error) {
    console.error('[telegram/link] status exception:', error)
    return NextResponse.json({ ok: false, error: 'Telegram integration is not configured' }, { status: 500 })
  }
}

export async function POST(_req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const admin = createTelegramAdminClient()
    const token = createTelegramPersonalLinkCode()
    const expiresAt = new Date(Date.now() + LINK_TTL_MINUTES * 60_000).toISOString()

    const { error } = await admin
      .from('profiles')
      .update({
        telegram_link_token_hash: hashTelegramLinkToken(token),
        telegram_link_token_expires_at: expiresAt,
      })
      .eq('id', user.id)

    if (error) {
      console.error('[telegram/link] token update failed:', error)
      return NextResponse.json({ ok: false, error: 'Failed to create Telegram link' }, { status: 500 })
    }

    const username = personalUsername()
    return NextResponse.json({
      ok: true,
      code: token,
      expiresAt,
      personalUsername: username ?? null,
      personalLink: buildTelegramPersonalLink(username),
    })
  } catch (error) {
    console.error('[telegram/link] token exception:', error)
    return NextResponse.json({ ok: false, error: 'Telegram integration is not configured' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const admin = createTelegramAdminClient()
    const { error } = await admin
      .from('profiles')
      .update({
        telegram_chat_id: null,
        telegram_user_id: null,
        telegram_username: null,
        telegram_linked_at: null,
        telegram_link_token_hash: null,
        telegram_link_token_expires_at: null,
      })
      .eq('id', user.id)

    if (error) {
      console.error('[telegram/link] unlink failed:', error)
      return NextResponse.json({ ok: false, error: 'Failed to unlink Telegram' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[telegram/link] unlink exception:', error)
    return NextResponse.json({ ok: false, error: 'Telegram integration is not configured' }, { status: 500 })
  }
}
