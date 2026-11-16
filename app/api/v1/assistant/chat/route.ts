export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { buildAssistantContext } from '@/lib/assistant/context'
import { CHAT_SCRIPTS, hydrate } from '@/lib/assistant/chat-scripts'
import { localeFromRequestCookie } from '@/lib/i18n/locale'
import { accessOfContext, paidScriptOutcome } from '@/lib/assistant/paid-context'
import { withDeadline } from '@/lib/runtime/deadline'

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
/** «Недостаточно данных» → «Подробные цифры — в платном доступе» (only for an answer about a closed section). */
function withoutInsufficient(text: string, locale: 'ru' | 'en'): string {
  return locale === 'en'
    ? text.replace(/Not enough data/g, 'Detailed figures are in paid access')
    : text.replace(/Недостаточно данных/g, 'Подробные цифры — в платном доступе')
}

async function handlePost(req: NextRequest) {
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
    // R2-A (ревью H-2): a question about a closed paid section is answered with
    // the paywall (where to leave the access request), never with its numbers;
    // a mixed answer keeps the free part and says what is in paid access.
    const paid = paidScriptOutcome(script.id, accessOfContext(ctx), locale)
    if (paid.replace) {
      return NextResponse.json({
        ok: true,
        answer_ru: paid.replace,
        used_data: [],
        section: script.section,
        insufficient: false,
        paywall: paid.paywall,
      })
    }
    const result = hydrate(script, ctx, locale)
    // The numbers are not missing — they are closed: never «Недостаточно данных» for them.
    const answer = paid.note ? `${withoutInsufficient(result.answer_ru, locale)} ${paid.note}` : result.answer_ru

    return NextResponse.json({
      ok: true,
      answer_ru: answer,
      used_data: result.used_data,
      section: script.section,
      insufficient: paid.note ? false : result.insufficient,
      ...(paid.paywall ? { paywall: paid.paywall } : {}),
    })
  } catch (error) {
    console.error('[assistant/chat] error:', error)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * R-015: on Railway `next start` ignores maxDuration, so the request had no time limit. After 60 s the client
 * gets 504 (DEADLINE_EXCEEDED) and the work below sees its deadline spent. ROUTE_DEADLINE_MS_ASSISTANT_CHAT overrides it;
 * ROUTE_DEADLINE_DISABLED=1 turns it off.
 */
export const POST = withDeadline(handlePost, { label: 'assistant-chat', ms: 60_000 })
