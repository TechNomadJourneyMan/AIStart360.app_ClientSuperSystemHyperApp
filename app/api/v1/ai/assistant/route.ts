// ============================================================
// /api/v1/ai/assistant — the unified AI chat («один мозг», spec 2026-10-12 §6)
//
// POST { message, surface, focus?, conversationId? }  → text/event-stream:
//   data: {"type":"status","text":"Смотрю метрики…"}
//   data: {"type":"proposal","action":{id,kind,preview}}   a change to confirm
//   data: {"type":"answer","text":"…"}
//   data: {"type":"done","conversationId":"…"}
// GET ?surface=  → the last conversation of this surface + its pending actions.
//
// Company and user from the session (lib/tenancy, read access); every data
// read goes through the caller's session (RLS). Proposals are written with
// the service role (ai_pending_actions) and applied only by
// POST /api/v1/ai/actions/[id] (re-authorised). Rate-limited, AI-budgeted,
// tariff-gated like the other chats.
// ============================================================
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase-service'
import { resolveTenantWith, tenantErrorMessage } from '@/lib/tenancy'
import { apiError } from '@/lib/api-error'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { guardAiBudget } from '@/lib/ai/budget'
import { gateFeature } from '@/lib/access/gate'
import { chatWithTools } from '@/lib/ai/tools-chat'
import { retrieveCompanyChunks } from '@/lib/ai/retrieval'
import { runChatTurn, type ChatSurface } from '@/lib/chat/engine'
import { toolsFor, type ActionPreview, type PendingKind } from '@/lib/chat/tools'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const SURFACES = ['point_a', 'gri', 'point_b', 'dashboard', 'global'] as const
const Body = z.object({
  message: z.string().trim().min(1).max(2000),
  surface: z.enum(SURFACES).default('global'),
  focus: z.object({ block: z.string().max(40).nullable().optional(), metric: z.string().max(120).nullable().optional() }).optional(),
  conversationId: z.string().uuid().nullable().optional(),
})

async function conversationFor(sb: Awaited<ReturnType<typeof createClient>>, userId: string, companyId: string, surface: ChatSurface, wanted?: string | null): Promise<string | null> {
  if (wanted) {
    // Only a conversation of this company and this screen — never another thread.
    const { data } = await sb.from('ai_conversations').select('id').eq('id', wanted).eq('user_id', userId).eq('company_key', companyId).eq('surface', surface).maybeSingle()
    if (data) return (data as { id: string }).id
  }
  const { data: last } = await sb.from('ai_conversations').select('id').eq('user_id', userId).eq('company_key', companyId).eq('surface', surface).order('updated_at', { ascending: false }).limit(1)
  const found = ((last ?? [])[0] as { id: string } | undefined)?.id
  if (found) return found
  const { data: created, error } = await sb.from('ai_conversations').insert({ user_id: userId, company_key: companyId, surface, persona_id: 'unified', title: 'AI-чат' }).select('id').single()
  if (error) console.error('[ai/assistant] conversation not created', error.code ?? '')
  return (created as { id: string } | null)?.id ?? null
}

export async function GET(req: Request): Promise<NextResponse> {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return apiError(tenantErrorMessage('unauthenticated'), 401)
  const url = new URL(req.url)
  const tenant = await resolveTenantWith(sb, user.id, { companyId: url.searchParams.get('companyId'), access: 'read' })
  if (!tenant.ok) return apiError(tenantErrorMessage(tenant.error), tenant.status)
  const surface = (SURFACES as readonly string[]).includes(url.searchParams.get('surface') ?? '') ? (url.searchParams.get('surface') as ChatSurface) : 'global'
  const { data: conv } = await sb.from('ai_conversations').select('id').eq('user_id', user.id).eq('company_key', tenant.tenant.companyId).eq('surface', surface).order('updated_at', { ascending: false }).limit(1)
  const conversationId = ((conv ?? [])[0] as { id: string } | undefined)?.id ?? null
  if (!conversationId) return NextResponse.json({ ok: true, data: { conversationId: null, messages: [], actions: [] } })
  // Lazily expire the caller's overdue proposals (no cron needed for that).
  await createServiceClient().from('ai_pending_actions').update({ status: 'expired', decided_at: new Date().toISOString() })
    .eq('user_id', user.id).eq('status', 'pending').lt('expires_at', new Date().toISOString())
    .then(({ error }) => { if (error && error.code !== 'PGRST205') console.error('[ai/assistant] expire failed', error.code ?? '') })
  // The newest messages / actions, shown oldest first.
  const [msgs, acts] = await Promise.all([
    sb.from('ai_messages').select('id, role, content, created_at').eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(60),
    sb.from('ai_pending_actions').select('id, kind, preview, status, expires_at, created_at').eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(30),
  ])
  return NextResponse.json({ ok: true, data: { conversationId, messages: [...(msgs.data ?? [])].reverse(), actions: [...(acts.data ?? [])].reverse() } })
}

export async function POST(req: Request): Promise<Response> {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return apiError(tenantErrorMessage('unauthenticated'), 401)
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return apiError('Неверный запрос', 400)
  const tenant = await resolveTenantWith(sb, user.id, { companyId: new URL(req.url).searchParams.get('companyId'), access: 'read' })
  if (!tenant.ok) return apiError(tenantErrorMessage(tenant.error), tenant.status)
  // Spec §6.3: 30 questions an hour, and no bursts.
  if (await isRateLimitedKey(user.id, 'ai-assistant-min', { max: 6, windowMs: 60_000 })) return apiError('Слишком много вопросов подряд — подождите минуту', 429)
  if (await isRateLimitedKey(user.id, 'ai-assistant-hour', { max: 30, windowMs: 3_600_000 })) return apiError('Лимит — 30 вопросов в час. Попробуйте позже', 429)
  const gated = await gateFeature(sb, user.id, 'ai_chat')
  if (gated) return gated
  const budget = await guardAiBudget(user.id, 'unified_chat')
  if (budget) return budget

  const { companyId, canManage } = tenant.tenant
  const { message, surface, focus } = parsed.data
  const service = createServiceClient()
  const { data: company } = await sb.from('companies').select('user_id').eq('id', companyId).maybeSingle()
  const ownerId = (company as { user_id?: string | null } | null)?.user_id ?? null
  const conversationId = await conversationFor(sb, user.id, companyId, surface, parsed.data.conversationId)
  const { data: past } = conversationId
    ? await sb.from('ai_messages').select('role, content').eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(12)
    : { data: [] }
  const history = ((past ?? []) as Array<{ role: 'user' | 'assistant'; content: string }>).reverse()

  const previews = new Map<string, { id: string; kind: PendingKind; preview: ActionPreview }>()
  const encoder = new TextEncoder()
  const askedAt = new Date()
  // Answer before the platform cuts the function (maxDuration): ~8 s reserve.
  const deadlineAt = Date.now() + (maxDuration - 8) * 1000
  let closed = false
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // The client may go away mid-turn: sending then must not break the turn
      // (its history is still saved).
      const send = (obj: unknown) => {
        if (closed) return
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)) } catch { closed = true }
      }
      try {
        const result = await runChatTurn({
          llm: (o) => chatWithTools({ ...o, feature: 'unified_chat', label: 'AI-чат', userId: user.id, companyId }),
          tools: toolsFor(canManage),
          surface,
          focus: focus ?? {},
          history,
          message,
          deadlineAt,
          signal: req.signal,
          ctx: {
            companyId, userId: user.id, ownerId, sb, canManage, now: new Date(),
            propose: async (kind, payload, preview) => {
              const { data, error } = await service.from('ai_pending_actions').insert({ user_id: user.id, company_id: companyId, conversation_id: conversationId, kind, payload, preview }).select('id').single()
              if (error || !data) throw new Error(`pending action not stored (${error?.code ?? 'no id'})`)
              const id = (data as { id: string }).id
              previews.set(id, { id, kind, preview })
              return id
            },
            searchDocuments: (q) => retrieveCompanyChunks(companyId, q, { billUserId: user.id, limit: 6 }),
          },
          onEvent: (e) => {
            if (e.type === 'proposal') send({ type: 'proposal', action: previews.get(e.actionId) ?? { id: e.actionId } })
            else send(e)
          },
        })
        // An AI outage / abandoned turn is not a reply worth feeding back to the model.
        if (conversationId && result.outcome !== 'ai_error' && result.outcome !== 'aborted') {
          await sb.from('ai_messages').insert([
            { conversation_id: conversationId, role: 'user', content: result.question, created_at: askedAt.toISOString() },
            { conversation_id: conversationId, role: 'assistant', content: result.answer, created_at: new Date(Math.max(Date.now(), askedAt.getTime() + 1)).toISOString(), grounding: { tools: result.toolsUsed, proposals: result.proposals, surface, focus: focus ?? null } },
          ])
          await sb.from('ai_conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId)
        }
        send({ type: 'done', conversationId })
      } catch (err) {
        console.error('[ai/assistant] turn failed', err instanceof Error ? err.message : err)
        send({ type: 'error', text: 'Не удалось ответить — попробуйте ещё раз.' })
      } finally {
        if (!closed) {
          closed = true
          try { controller.close() } catch { /* already closed by the client */ }
        }
      }
    },
    cancel() { closed = true },
  })
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' } })
}
