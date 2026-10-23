export const dynamic = 'force-dynamic'

// GET  /api/v1/survey/chat — the client's active questionnaire chat: messages,
//      open cards, the current question, progress, the AI budget state.
// POST /api/v1/survey/chat { message?, action?, scope?, focusKey? } — one turn
//      (spec 2026-10-23 §8, §12; plan survey Ф4). The session user only (never
//      an id from the body); «от имени» is refused. Nothing here writes
//      survey_answers — the card is applied by POST /api/v1/ai/actions/[id].
// Limits: 12 turns / min, 150 / h per user. Budget (PO §18.3 item 2): free —
// $0.5 per client, PRO — unlimited until the full questionnaire is sent; when
// spent the chat answers 200 with a clear line and keeps the registry help.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { activeImpersonation } from '@/lib/impersonation/server'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { trackEvent } from '@/lib/events/track'
import { checkSurveyAssistantBudget } from '@/lib/survey/chat/budget'
import { openRouterSurveyLlm } from '@/lib/survey/chat/model'
import { chatPost, loadChatView } from '@/lib/survey/chat/session'
import { CHAT_SCOPES, type ChatBudgetDTO } from '@/lib/survey/chat/types'

const KEY_RE = /^[a-z][a-z0-9_]{1,79}$/
const Body = z.object({
  message: z.string().max(2000).optional().nullable(),
  action: z.enum(['explain', 'where', 'skip', 'unknown', 'approx', 'start', 'restart', 'next']).optional().nullable(),
  scope: z.enum(CHAT_SCOPES).optional().nullable(),
  focusKey: z.string().regex(KEY_RE).optional().nullable(),
}).strict()

const SURVEY_CHAT_OFF_MESSAGE = 'ИИ-помощник анкеты сейчас выключен. Объяснения вопросов и «где взять цифру» работают, ответы можно ввести в форме — всё сохранится.'

async function helperEnabled(): Promise<boolean> {
  try {
    const { getSetting } = await import('@/lib/settings/store')
    return (await getSetting('survey_chat_enabled')) !== false
  } catch {
    return true
  }
}

async function sessionUser(): Promise<{ id: string } | NextResponse> {
  const { data: { user } } = await createServerClient().auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Войдите, чтобы продолжить' }, { status: 401 })
  if (await activeImpersonation(user.id)) {
    return NextResponse.json({ ok: false, error: 'В режиме «от имени» беседа с помощником недоступна — ответы клиента можно править в GIGA.' }, { status: 403 })
  }
  return { id: user.id }
}

async function budgetFor(userId: string): Promise<ChatBudgetDTO> {
  if (!(await helperEnabled())) return { exhausted: true, reason: null, message: SURVEY_CHAT_OFF_MESSAGE }
  const b = await checkSurveyAssistantBudget(userId)
  return { exhausted: b.exhausted, reason: b.reason, message: b.message }
}

export async function GET() {
  const who = await sessionUser()
  if (who instanceof NextResponse) return who
  try {
    const view = await loadChatView(createServiceClient(), who.id, await budgetFor(who.id))
    return NextResponse.json({ ok: true, data: view })
  } catch (err) {
    console.error('[survey/chat] GET failed', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'Не удалось загрузить беседу' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const who = await sessionUser()
  if (who instanceof NextResponse) return who
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Неверный запрос' }, { status: 400 })
  if (await isRateLimitedKey(who.id, 'survey-chat-min', { max: 12, windowMs: 60_000 })
    || await isRateLimitedKey(who.id, 'survey-chat-hour', { max: 150, windowMs: 60 * 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Слишком много сообщений подряд — подождите минуту. Ответы можно ввести и в форме.' }, { status: 429 })
  }
  const budget = await budgetFor(who.id)
  try {
    const out = await chatPost({
      db: createServiceClient(),
      userId: who.id,
      llm: budget.exhausted ? null : openRouterSurveyLlm(who.id),
      budget,
      track: (name, metadata) => { void trackEvent({ userId: who.id, name, entityType: 'survey', entityId: who.id, metadata, source: 'server' }) },
    }, parsed.data)
    if (!out.ok) return NextResponse.json({ ok: false, error: out.error }, { status: out.status })
    const { ok: _ok, ...data } = out
    return NextResponse.json({ ok: true, data })
  } catch (err) {
    console.error('[survey/chat] POST failed', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'Помощник не ответил — попробуйте ещё раз или продолжите в форме.' }, { status: 500 })
  }
}
