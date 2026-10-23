export const dynamic = 'force-dynamic'

// POST /api/v1/survey/chat/escalate { key?, text } — «Позвать эксперта» from the
// questionnaire chat (spec §8.9): the client's question goes to HIS
// conversation in «Сообщения» (the same path as POST /api/v1/comm/messages →
// recordInbound: staff notification, SLA, 30-minute escalation), prefixed with
// the question it is about; the chat notes «Передал». The expert's answer
// arrives in «Сообщения», not in the chat.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { activeImpersonation } from '@/lib/impersonation/server'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { recordInbound } from '@/lib/comm/inbound'
import { trackEvent } from '@/lib/events/track'
import { maskProfanity } from '@/lib/moderation/profanity'
import { questionLabel } from '@/lib/survey/chat/session'
import { insertMessages, loadActiveConversation } from '@/lib/survey/chat/store'

const Body = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,79}$/).optional().nullable(),
  text: z.string().max(1500).optional().nullable(),
}).strict()

export async function POST(req: NextRequest) {
  const { data: { user } } = await createServerClient().auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Войдите, чтобы продолжить' }, { status: 401 })
  if (await activeImpersonation(user.id)) {
    return NextResponse.json({ ok: false, error: 'В режиме «от имени» писать за пользователя нельзя — ответьте из GIGA «Сообщения».' }, { status: 403 })
  }
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Неверный запрос' }, { status: 400 })
  if (await isRateLimitedKey(user.id, 'survey-chat-escalate', { max: 5, windowMs: 10 * 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Вопрос уже передан — эксперт ответит в «Сообщениях».' }, { status: 429 })
  }
  const label = questionLabel(parsed.data.key)
  const text = (parsed.data.text ?? '').trim()
  const body = [`Вопрос по анкете${label ? `: ${label}` : ''}`, text || 'Нужна помощь с ответом.', '(Переписка с помощником — в карточке клиента: «Анкета» → «Беседа с ИИ».)'].join('\n')

  const sb = createServiceClient()
  try {
    await recordInbound({ userId: user.id, channel: 'app', body, metadata: { source: 'survey_chat', question_key: parsed.data.key ?? null } }, { sb })
  } catch (err) {
    console.error('[survey/chat/escalate]', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'Не удалось передать вопрос — напишите в «Сообщения».' }, { status: 500 })
  }
  void trackEvent({ userId: user.id, name: 'SURVEY_CHAT_ESCALATED', entityType: 'survey', entityId: user.id, metadata: { key: parsed.data.key ?? null }, source: 'server' })
  const conversation = await loadActiveConversation(sb, user.id).catch(() => null)
  const note = 'Передал вопрос эксперту. Ответ придёт в «Сообщения» — пока продолжим?'
  if (conversation) {
    await insertMessages(sb, conversation.id, [
      { role: 'assistant', content: note, grounding: { kind: 'escalated', key: parsed.data.key ?? null, escalate: { key: parsed.data.key ?? null, label, text: maskProfanity(text) } } },
    ]).catch(() => [])
  }
  return NextResponse.json({ ok: true, data: { message: note, link: '/client/messages' } })
}
