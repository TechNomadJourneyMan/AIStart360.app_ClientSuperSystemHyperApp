export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { buildAssistantContext } from '@/lib/assistant/context'
import { CHAT_SCRIPTS, hydrate } from '@/lib/assistant/chat-scripts'
import { localeFromRequestCookie } from '@/lib/i18n/locale'

/**
 * POST /api/v1/assistant/chat
 * Body: { scriptId: string }
 *
 * Resolves a ready-made CHAT_SCRIPTS entry (7.1–7.12) and hydrates its Russian
 * answer-script against the curated AssistantContext snapshot for the CURRENT
 * authenticated user (cookie session — never a user_id param, IDOR-safe per
 * point-b/route.ts). Anti-hallucination is enforced inside hydrate(): a missing
 * ctx field renders the honest "Недостаточно данных" branch and flips
 * `insufficient` to true rather than inventing a number.
 *
 * Returns { answer_ru, used_data, section, insufficient }.
 */
export async function POST(req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  let body: { scriptId?: string } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 })
  }

  const scriptId = typeof body.scriptId === 'string' ? body.scriptId.trim() : ''
  if (!scriptId) {
    return NextResponse.json({ ok: false, error: 'scriptId required' }, { status: 400 })
  }

  const script = CHAT_SCRIPTS.find((s) => s.id === scriptId)
  if (!script) {
    return NextResponse.json({ ok: false, error: 'Unknown scriptId' }, { status: 404 })
  }

  try {
    // Portal locale from the caller's cookie (no server-to-server fire here).
    const locale = localeFromRequestCookie(req)
    const ctx = await buildAssistantContext(user.id, sb)
    const result = hydrate(script, ctx, locale)

    return NextResponse.json({
      ok: true,
      answer_ru: result.answer_ru,
      used_data: result.used_data,
      section: script.section,
      insufficient: result.insufficient,
    })
  } catch (error) {
    console.error('[assistant/chat] error:', error)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
