export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase-server'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { localeFromRequestCookie } from '@/lib/i18n/locale'
import { buildAssistantContext } from '@/lib/assistant/context'
import { serializeSnapshot } from '@/lib/assistant/answer'
import { mascotPersona } from '@/lib/assistant/mascot/system-prompt'
import { personaBlock, getPersona } from '@/lib/ai/personas/registry'
import { buildReportChatSystemPrompt } from '@/lib/ai/report-chat/prompt'
import { reportChatAnswerSchema, parseReportChatAnswer, sanitizeUsedSources } from '@/lib/ai/report-chat/answer'
import { runAnswerValidation } from '@/lib/ai/validation'
import { renderTemplate } from '@/lib/ai/validation/templates'
import { retrieveUserChunks } from '@/lib/ai/retrieval'
import { generateObjectViaOpenRouter } from '@/lib/ai/structured'
import { hasOpenRouterKey } from '@/lib/ai/openrouter'

/**
 * POST /api/v1/ai/chat  { message, personaId?, surface?, conversationId? }
 *   → { ok, conversationId, answer, used_sources, confidence, needs_expert, status }
 *
 * The "explain my report" chat (A1). Thin glue over the tested cores:
 * context → retrieval → persona+rules prompt → structured LLM answer →
 * parse + used_sources sanitize → validation pipeline → persist. Grounded
 * (facts only from the curated snapshot + the user's own document chunks) and
 * IDOR-safe (identity from the session, RLS scopes every row).
 */
const bodySchema = z.object({
  message: z.string().trim().min(1).max(2000),
  personaId: z.string().max(40).optional(),
  surface: z.enum(['report', 'dashboard', 'point_a', 'point_b']).optional(),
  conversationId: z.string().uuid().optional(),
})

const AVAILABLE_REFS = ['point_a', 'point_b', 'gri', 'gri_top5:0', 'action_plan', 'survey', 'metrics']

const OUTPUT_CONTRACT = `

--- ФОРМАТ ВЫВОДА ---
Верни ОДИН валидный минифицированный JSON-объект (без markdown, без комментариев):
{"can_answer":true,"answer":"строка ≤250 слов","confidence":"high","used_sources":[{"type":"gri_top5","ref":"gri_top5:0","label":"строка"}],"assumptions":[],"needs_expert":false,"suggested_next":["строка"]}`

/** GET /api/v1/ai/chat?surface=report → { ok, conversationId, messages } — last dialog. */
export async function GET(req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const surface = (req.nextUrl.searchParams.get('surface') ?? 'report').slice(0, 32)
  const { data: conv } = await sb
    .from('ai_conversations')
    .select('id')
    .eq('user_id', user.id)
    .eq('surface', surface)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!conv?.id) return NextResponse.json({ ok: true, conversationId: null, messages: [] })

  const { data: messages } = await sb
    .from('ai_messages')
    .select('role, content, grounding, created_at')
    .eq('conversation_id', conv.id)
    .order('created_at', { ascending: true })
    .limit(50)

  return NextResponse.json({ ok: true, conversationId: conv.id, messages: messages ?? [] })
}

export async function POST(req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  if (await isRateLimitedKey(user.id, 'ai-chat', { max: 10, windowMs: 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Слишком много сообщений. Подождите минуту.' }, { status: 429 })
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid message' }, { status: 400 })
  }
  const { message, surface = 'report' } = parsed.data
  const persona = getPersona(parsed.data.personaId)

  if (!hasOpenRouterKey()) {
    return NextResponse.json(
      { ok: true, answer: renderTemplate('T16'), status: 'blocked', needs_expert: true, used_sources: [] },
      { status: 200 },
    )
  }

  const locale = localeFromRequestCookie(req)

  try {
    // 1. Curated context (the only source of facts) + document retrieval.
    const ctx = await buildAssistantContext(user.id, sb)
    const snapshotText = serializeSnapshot(ctx, locale)
    const retrieved = await retrieveUserChunks(user.id, message)

    // 2. Compose the grounded system prompt + the list of citable sources.
    const { system, providedSources } = buildReportChatSystemPrompt({
      personaSafety: mascotPersona(locale),
      personaMode: personaBlock(persona.id),
      snapshotText,
      retrieved,
      availableRefs: AVAILABLE_REFS,
    })

    // 3. Structured answer from the model.
    const rawAnswer = await generateObjectViaOpenRouter({
      label: 'ai-chat',
      complexity: 'high',
      maxTokens: 900,
      temperature: 0.2,
      schema: reportChatAnswerSchema,
      system,
      user: `${message}${OUTPUT_CONTRACT}`,
    })

    // 4. Parse + drop citations to sources that were never in context.
    const parsedAnswer = rawAnswer ? parseReportChatAnswer(rawAnswer, providedSources) : null
    if (!parsedAnswer || !parsedAnswer.can_answer || parsedAnswer.answer.trim() === '') {
      const fallback = renderTemplate('T1', { missing: 'нужные данные по вашему вопросу' })
      await persist(sb, user.id, surface, persona.id, parsed.data.conversationId, message, {
        content: fallback, grounding: [], validation: { status: 'needs_revision', risk_level: 'low' },
      })
      return NextResponse.json({ ok: true, answer: fallback, status: 'needs_revision', needs_expert: true, used_sources: [] })
    }
    const sanitized = sanitizeUsedSources(parsedAnswer, providedSources)

    // 5. Validation pipeline (deterministic MVP; LLM validator can be injected later).
    const validation = await runAnswerValidation({
      answer: sanitized.answer,
      usedSources: sanitized.used_sources.map((s) => ({ ref: s.ref })),
      providedSources,
    })

    // 6. Persist and respond.
    const conversationId = await persist(sb, user.id, surface, persona.id, parsed.data.conversationId, message, {
      content: validation.finalAnswer,
      grounding: sanitized.used_sources,
      validation: { status: validation.status, risk_level: validation.riskLevel, template: validation.templateId },
    })

    return NextResponse.json({
      ok: true,
      conversationId,
      answer: validation.finalAnswer,
      used_sources: sanitized.used_sources,
      confidence: sanitized.confidence,
      needs_expert: sanitized.needs_expert,
      suggested_next: sanitized.suggested_next,
      status: validation.status,
    })
  } catch (error) {
    console.error('[ai/chat] error:', error)
    return NextResponse.json({ ok: false, error: 'Не получилось ответить. Попробуйте ещё раз.' }, { status: 500 })
  }
}

/** Create/reuse the conversation, write the user + assistant messages, bump updated_at. */
async function persist(
  sb: ReturnType<typeof createServerClient>,
  userId: string,
  surface: string,
  personaId: string,
  conversationId: string | undefined,
  userMessage: string,
  assistant: { content: string; grounding: unknown; validation: unknown },
): Promise<string | null> {
  try {
    let convId = conversationId
    if (convId) {
      const { data } = await sb.from('ai_conversations').select('id').eq('id', convId).eq('user_id', userId).maybeSingle()
      if (!data) convId = undefined
    }
    if (!convId) {
      const { data } = await sb
        .from('ai_conversations')
        .insert({ user_id: userId, surface, persona_id: personaId, title: userMessage.slice(0, 60) })
        .select('id')
        .single()
      convId = data?.id
    }
    if (!convId) return null

    await sb.from('ai_messages').insert([
      { conversation_id: convId, role: 'user', content: userMessage },
      { conversation_id: convId, role: 'assistant', content: assistant.content, grounding: assistant.grounding, validation: assistant.validation },
    ])
    await sb.from('ai_conversations').update({ updated_at: new Date().toISOString() }).eq('id', convId)
    return convId
  } catch {
    return null
  }
}
