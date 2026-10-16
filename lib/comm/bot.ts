/**
 * lib/comm/bot.ts — the client bot in «Авто» mode
 * (docs/superpowers/specs/2026-10-16-user-communications-design.md §6.5).
 *
 * The webhook / cabinet only records the message and emits
 * COMM_BOT_REPLY_EVENT (lib/comm/inbound.ts); the answer is produced by the
 * Inngest function comm-bot-reply (lib/functions/comm.ts), never inside the
 * webhook:
 *
 *   planBotReply()   may the bot answer this message (thread in auto mode, not
 *                    blocked, the message is the latest one, staff did not
 *                    answer, ≤ BOT_REPLIES_PER_HOUR replies this hour)? → the
 *                    human-like delay and the Telegram chat for «печатает…».
 *   runBotReply()    after the delay, the same checks again, then:
 *                      «позовите человека» / жалоба / «оформите заявку»
 *                        → handoff without the LLM;
 *                      otherwise callLlmJson (lib/ai/gateway, tier light) with
 *                        published knowledge-base articles (lib/comm/kb.ts) and
 *                        ONLY this user's own data (questionnaire progress,
 *                        latest Point A) — everything from the user is fenced
 *                        as untrusted. The model answers, or asks for handoff /
 *                        a request. No model / an error → handoff.
 *   handoff          «Позову эксперта — он ответит, как только освободится»
 *                    (or the request confirmation), an expert_cases request
 *                    linked to the user and the conversation (comm_thread_id,
 *                    122), the thread → waiting_staff with a new reply
 *                    deadline (the 30-minute rule takes over) and mode
 *                    'manual' (a person leads it now; staff may switch auto
 *                    back on), staff notified (notifyStaff, GIGA feed + bots).
 *
 * Every bot message: author_kind 'bot', masked with sanitizeBotReply (inside
 * sendToUser), on the channel the user wrote from, visible to staff in the
 * feed. The first bot message of a conversation and every answer to «вы
 * человек?» say it is the AIStart360 bot (lib/comm/bot-rules.ts).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase-service'
import { surveyProgressFromRows } from '@/lib/survey/steps'
import { computeSlaDueAt, getSlaHours } from '@/lib/admin/escalations'
import {
  asksIfHuman, BOT_NAME, BOT_REPLIES_PER_HOUR, BotDecisionSchema, botDelayMs, buildBotPrompt, CASE_TEXT, clipReply,
  ensureBotDisclosure, HANDOFF_REASON_LABELS, HANDOFF_TEXT, isComplaint, overHourlyCap, wantsCase, wantsHuman,
  type BotDecision, type BotJob, type HandoffReason, type KbHit,
} from './bot-rules'
import { loadReplyDeadline, replyDueAt, type ReplyDeadlineConfig } from './deadline'
import { GIGA_MESSAGES_PATH, notifyStaffOfInbound, type InboundNotice } from './inbound'
import { searchKnowledge, type Embedder } from './kb'
import { staffVisibleBody } from './moderation'
import { sendToUser, type SendToUserResult } from './send'
import { previewOf } from './state'
import { findThreadById, loadRecipient, updateThread } from './store'
import type { CommTransports } from './transports'
import { MESSAGE_COLUMNS, type CommChannel, type CommMessageRow, type CommThreadRow } from './types'

export type { BotJob } from './bot-rules'

export interface BotLlmResult {
  decision: BotDecision | null
}

export interface BotDeps {
  sb?: SupabaseClient
  now?: Date
  rng?: () => number
  /** The model call; default callLlmJson (tier light, 25 s, 600 tokens). */
  llm?: (prompt: { system: string; user: string }, meta: { userId: string }) => Promise<BotDecision | null>
  embed?: Embedder
  /** Delivery of the default send (tests pass fake transports). */
  transports?: CommTransports
  /** Sending to the user; default sendToUser (author bot). */
  send?: (input: { userId: string; channel: CommChannel; body: string; replyToId: string }) => Promise<SendToUserResult>
  /** Staff notification of a handoff / request; default notifyStaff. */
  notifyHandoff?: (n: HandoffNotice) => Promise<void>
  /** The bot will not answer an unanswered message: tell staff (default notifyStaffOfInbound). */
  notifyInbound?: (n: InboundNotice) => Promise<void>
  deadline?: () => Promise<ReplyDeadlineConfig>
  slaDueAt?: (now: Date) => Promise<string | null>
}

export interface HandoffNotice {
  thread: CommThreadRow
  message: CommMessageRow
  userName: string
  reason: HandoffReason
  caseId: string | null
  kind: 'handoff' | 'case'
}

export type BotSkipReason = 'not_found' | 'blocked' | 'manual' | 'superseded' | 'answered' | 'already_replied' | 'rate_limited'

/** Skips where the user is left without an answer and staff were not told yet. */
const NOTIFY_ON: ReadonlySet<BotSkipReason> = new Set(['manual', 'rate_limited'])

export type BotPlan =
  | { ok: true; channel: CommChannel; chatId: string | null; delayMs: number }
  | { ok: false; reason: BotSkipReason; notifyStaff: boolean }

export type BotOutcome =
  | { outcome: 'answered'; messageIds: string[] }
  | { outcome: 'handoff' | 'case'; reason: HandoffReason; caseId: string | null }
  | { outcome: 'skipped'; reason: BotSkipReason }

// ─── Checks ─────────────────────────────────────────────────────────────────

interface Loaded {
  thread: CommThreadRow
  message: CommMessageRow
  recent: CommMessageRow[]
}

async function load(sb: SupabaseClient, job: BotJob): Promise<Loaded | null> {
  const thread = await findThreadById(sb, job.threadId)
  if (!thread) return null
  const { data } = await sb.from('comm_messages').select(MESSAGE_COLUMNS).eq('id', job.messageId).maybeSingle()
  const message = data as CommMessageRow | null
  if (!message || message.thread_id !== thread.id || message.direction !== 'in') return null
  const { data: rows } = await sb
    .from('comm_messages')
    .select(MESSAGE_COLUMNS)
    .eq('thread_id', thread.id)
    .order('created_at', { ascending: false })
    .limit(20)
  return { thread, message, recent: ((rows ?? []) as CommMessageRow[]).reverse() }
}

async function botReplyTimes(sb: SupabaseClient, threadId: string): Promise<string[]> {
  const { data } = await sb
    .from('comm_messages')
    .select('created_at')
    .eq('thread_id', threadId)
    .eq('author_kind', 'bot')
    .order('created_at', { ascending: false })
    .limit(BOT_REPLIES_PER_HOUR)
  return ((data ?? []) as Array<{ created_at: string }>).map((r) => r.created_at)
}

async function check(sb: SupabaseClient, l: Loaded, now: Date): Promise<BotSkipReason | null> {
  if (l.thread.blocked_at) return 'blocked'
  if (l.thread.mode !== 'auto') return 'manual'
  if (l.recent.some((m) => m.author_kind === 'bot' && m.reply_to_id === l.message.id)) return 'already_replied'
  const after = l.recent.filter((m) => m.created_at > l.message.created_at)
  if (after.some((m) => m.direction === 'in')) return 'superseded'
  if (after.some((m) => m.author_kind === 'staff')) return 'answered'
  if (overHourlyCap(await botReplyTimes(sb, l.thread.id), now)) return 'rate_limited'
  return null
}

/** Before the delay: may the bot answer, and how long to «type». */
export async function planBotReply(job: BotJob, deps: BotDeps = {}): Promise<BotPlan> {
  const sb = deps.sb ?? createServiceClient()
  const now = deps.now ?? new Date()
  const l = await load(sb, job)
  if (!l) return { ok: false, reason: 'not_found', notifyStaff: false }
  const skip = await check(sb, l, now)
  if (skip) return { ok: false, reason: skip, notifyStaff: NOTIFY_ON.has(skip) }
  const metaChat = typeof l.message.metadata?.chatId === 'string' ? l.message.metadata.chatId : null
  return {
    ok: true,
    channel: l.message.channel,
    chatId: l.message.channel === 'telegram' ? metaChat : null,
    delayMs: botDelayMs(l.message.body, deps.rng),
  }
}

// ─── The user's own data ────────────────────────────────────────────────────

/** Facts the bot may use: ONLY this user's questionnaire progress and latest Point A. */
export async function loadUserFacts(sb: SupabaseClient, userId: string): Promise<string[]> {
  const facts: string[] = []
  try {
    const [{ data: profile }, { data: company }, { data: answers }] = await Promise.all([
      sb.from('profiles').select('full_name').eq('id', userId).maybeSingle(),
      sb.from('companies').select('id, name').eq('user_id', userId).limit(1).maybeSingle(),
      sb.from('survey_answers').select('question_key, step, answer').eq('user_id', userId).limit(2000),
    ])
    const name = (profile as { full_name?: string | null } | null)?.full_name?.trim()
    if (name) facts.push(`Имя: ${name}`)
    const c = company as { id?: string; name?: string | null } | null
    if (c?.name) facts.push(`Компания: ${c.name}`)
    const progress = surveyProgressFromRows((answers ?? []) as Array<{ question_key: string; step?: number | null; answer?: unknown }>)
    facts.push(progress.is_complete
      ? 'Анкета: заполнена полностью'
      : progress.completed > 0
        ? `Анкета: заполнено ${progress.completed} из ${progress.total_steps} шагов (${progress.percent}%)`
        : 'Анкета: ещё не начата')
    if (c?.id) {
      const { data: snap } = await sb
        .from('point_a_snapshots')
        .select('overall, stage, created_at, blocks')
        .eq('company_id', c.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const s = snap as { overall?: number | string | null; stage?: string | null; created_at?: string; blocks?: Array<{ title?: string; score?: number | null }> } | null
      if (s && s.overall !== null && s.overall !== undefined) {
        const weak = (Array.isArray(s.blocks) ? s.blocks : [])
          .filter((b) => typeof b?.score === 'number' && typeof b?.title === 'string')
          .sort((a, b) => (a.score as number) - (b.score as number))
          .slice(0, 3)
          .map((b) => `${b.title} — ${Math.round(b.score as number)}`)
        facts.push(`Точка А: ${Math.round(Number(s.overall))}/100${s.stage ? `, стадия «${s.stage}»` : ''}${s.created_at ? `, рассчитана ${s.created_at.slice(0, 10)}` : ''}`)
        if (weak.length) facts.push(`Слабые разделы Точки А: ${weak.join('; ')}`)
      } else {
        facts.push('Точка А: ещё не рассчитана (нужна заполненная анкета)')
      }
    }
  } catch (err) {
    console.error('[comm/bot] user facts', err instanceof Error ? err.message.slice(0, 120) : err)
  }
  return facts
}

// ─── Requests (expert_cases) ────────────────────────────────────────────────

/**
 * An expert_cases request from the conversation (trigger user_requested_help),
 * assigned like the thread (or the client's responsible staff member). An
 * open request of the same conversation is reused. Without migration 122
 * (no comm_thread_id) the row is written without the link.
 */
export async function createCommCase(
  sb: SupabaseClient,
  input: { thread: CommThreadRow; title: string; summary: string; userMessage: string; slaDueAt: string | null },
): Promise<string | null> {
  const { thread } = input
  const existing = await sb
    .from('expert_cases')
    .select('id')
    .eq('comm_thread_id', thread.id)
    .in('status', ['new', 'in_progress'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!existing.error && (existing.data as { id?: string } | null)?.id) return (existing.data as { id: string }).id

  let assignee = thread.assignee_id
  if (!assignee) {
    const { data } = await sb.from('user_assignments').select('assignee_id').eq('user_id', thread.user_id).maybeSingle()
    assignee = (data as { assignee_id?: string | null } | null)?.assignee_id ?? null
  }
  const row: Record<string, unknown> = {
    user_id: thread.user_id,
    company_id: thread.company_id,
    status: 'new',
    priority: 'medium',
    trigger_type: 'user_requested_help',
    title: input.title.slice(0, 200),
    summary: input.summary.slice(0, 2000),
    user_message: input.userMessage.slice(0, 4000),
    assistant_recommendation: 'Ответить пользователю в GIGA «Сообщения» — диалог ждёт эксперта.',
    detected_issues: [],
    sla_due_at: input.slaDueAt,
    ...(assignee ? { assignee_id: assignee, assigned_to: assignee } : {}),
    comm_thread_id: thread.id,
  }
  let res = await sb.from('expert_cases').insert(row).select('id').maybeSingle()
  if (res.error && /comm_thread_id/.test(res.error.message ?? '')) {
    const { comm_thread_id: _link, ...legacy } = row
    res = await sb.from('expert_cases').insert(legacy).select('id').maybeSingle()
  }
  if (res.error) {
    console.error('[comm/bot] case insert failed', res.error.code ?? '', res.error.message?.slice(0, 160))
    return null
  }
  return (res.data as { id?: string } | null)?.id ?? null
}

// ─── Defaults (network) ─────────────────────────────────────────────────────

async function defaultLlm(prompt: { system: string; user: string }, meta: { userId: string }): Promise<BotDecision | null> {
  const { callLlmJson } = await import('@/lib/ai/gateway')
  const { recordAiUsage } = await import('@/lib/ai/usage')
  const started = Date.now()
  const res = await callLlmJson({
    tier: 'light', system: prompt.system, user: prompt.user, maxTokens: 600, temperature: 0.4,
    timeoutMs: 25_000, label: 'comm:bot', schema: BotDecisionSchema,
  })
  await recordAiUsage({
    feature: 'comm_bot', model: res.usage?.model ?? 'unknown', promptTokens: res.usage?.tokensIn ?? null,
    completionTokens: res.usage?.tokensOut ?? null, providerCostUsd: res.usage?.costUsd ?? null,
    latencyMs: res.usage?.latencyMs ?? Date.now() - started, ok: res.ok, userId: meta.userId,
  })
  if (!res.ok) console.warn('[comm/bot] llm', res.error)
  return res.ok ? res.data : null
}

async function defaultNotifyHandoff(n: HandoffNotice): Promise<void> {
  const { notifyStaff } = await import('@/lib/notifications/staff')
  await notifyStaff({
    level: 'WARNING',
    type: n.kind === 'case' ? 'comm.case' : 'comm.handoff',
    title: (n.kind === 'case' ? `Заявка из диалога: ${n.userName}` : `Бот зовёт эксперта: ${n.userName}`).slice(0, 200),
    lines: [
      HANDOFF_REASON_LABELS[n.reason],
      `«${previewOf(staffVisibleBody(n.message))}»`,
      ...(n.caseId ? ['Заявка создана (Эскалации)'] : []),
    ],
    companyId: n.thread.company_id,
    entityType: 'comm_thread',
    entityId: n.thread.id,
    link: `${GIGA_MESSAGES_PATH}?user=${n.thread.user_id}`,
    dedupeKey: `comm.handoff:${n.message.id}`,
    audienceUserIds: n.thread.assignee_id ? [n.thread.assignee_id] : null,
    audiencePermission: n.thread.assignee_id ? 'inbox.view' : 'inbox.manage',
    skipCooldown: true,
  })
}

async function defaultSlaDueAt(now: Date): Promise<string | null> {
  try {
    return computeSlaDueAt(now, 'medium', await getSlaHours())
  } catch {
    return null
  }
}

// ─── Reply ──────────────────────────────────────────────────────────────────

function historyOf(recent: CommMessageRow[], upTo: CommMessageRow): Array<{ who: 'user' | 'staff' | 'bot'; text: string }> {
  return recent
    .filter((m) => m.created_at < upTo.created_at && m.author_kind !== 'system' && m.status !== 'skipped' && m.status !== 'failed')
    // One bubble per send (several channel rows share group_id).
    .filter((m, i, all) => all.findIndex((x) => x.group_id === m.group_id) === i)
    .slice(-12)
    .map((m) => ({ who: m.direction === 'in' ? 'user' as const : m.author_kind === 'bot' ? 'bot' as const : 'staff' as const, text: staffVisibleBody(m) }))
}

async function userNameOf(sb: SupabaseClient, userId: string): Promise<string> {
  const r = await loadRecipient(sb, userId).catch(() => null)
  return r?.fullName || r?.email || 'пользователь'
}

/** After the delay: re-check, then answer or hand off to an expert. */
export async function runBotReply(job: BotJob, deps: BotDeps = {}): Promise<BotOutcome> {
  const sb = deps.sb ?? createServiceClient()
  const now = deps.now ?? new Date()
  const l = await load(sb, job)
  if (!l) return { outcome: 'skipped', reason: 'not_found' }
  const skip = await check(sb, l, now)
  if (skip) {
    if (NOTIFY_ON.has(skip) && job.notifyOnSkip) await notifyUnanswered(sb, l, deps)
    return { outcome: 'skipped', reason: skip }
  }

  const { thread, message } = l
  const text = message.body
  const firstReply = !l.recent.some((m) => m.author_kind === 'bot')
  const askedIfHuman = asksIfHuman(text)
  const send = deps.send ?? ((i) => sendToUser({
    userId: i.userId, channels: [i.channel], body: i.body, authorKind: 'bot', authorName: BOT_NAME, replyToId: i.replyToId,
  }, { sb, now, transports: deps.transports }))

  // Deterministic intents first: they must not depend on the model.
  if (wantsHuman(text)) return handoff(sb, l, deps, send, { kind: 'handoff', reason: 'human_requested', firstReply })
  if (isComplaint(text)) return handoff(sb, l, deps, send, { kind: 'handoff', reason: 'complaint', firstReply })
  if (wantsCase(text)) return handoff(sb, l, deps, send, { kind: 'case', reason: 'case_requested', firstReply, summary: text })

  const [kb, userFacts] = await Promise.all([
    searchKnowledge(sb, text, { embed: deps.embed }).then((r) => r.hits).catch((): KbHit[] => []),
    loadUserFacts(sb, thread.user_id),
  ])
  const prompt = buildBotPrompt({ firstReply, askedIfHuman, kb, userFacts, history: historyOf(l.recent, message), message: text })
  let decision: BotDecision | null = null
  try {
    decision = await (deps.llm ?? defaultLlm)(prompt, { userId: thread.user_id })
  } catch (err) {
    console.error('[comm/bot] llm failed', err instanceof Error ? err.message.slice(0, 120) : err)
  }
  if (!decision) return handoff(sb, l, deps, send, { kind: 'handoff', reason: 'llm_unavailable', firstReply })
  if (decision.action === 'case') {
    return handoff(sb, l, deps, send, { kind: 'case', reason: 'case_requested', firstReply, summary: decision.case_summary || text, reply: decision.reply })
  }
  const reply = decision.reply?.trim() ?? ''
  if (decision.action === 'handoff' || !reply) return handoff(sb, l, deps, send, { kind: 'handoff', reason: 'unknown', firstReply })

  const body = ensureBotDisclosure(clipReply(reply), firstReply || askedIfHuman)
  const res = await send({ userId: thread.user_id, channel: message.channel, body, replyToId: message.id }).catch((err: unknown) => {
    console.error('[comm/bot] reply failed', err instanceof Error ? err.message.slice(0, 120) : err)
    return null
  })
  if (!res?.ok) return handoff(sb, l, deps, null, { kind: 'handoff', reason: 'send_failed', firstReply })
  return { outcome: 'answered', messageIds: res.messages.map((m) => m.id) }
}

async function notifyUnanswered(sb: SupabaseClient, l: Loaded, deps: BotDeps): Promise<void> {
  try {
    await (deps.notifyInbound ?? notifyStaffOfInbound)({ thread: l.thread, message: l.message, userName: await userNameOf(sb, l.thread.user_id) })
  } catch (err) {
    console.error('[comm/bot] staff notification failed', err instanceof Error ? err.message.slice(0, 120) : err)
  }
}

async function handoff(
  sb: SupabaseClient,
  l: Loaded,
  deps: BotDeps,
  send: NonNullable<BotDeps['send']> | null,
  h: { kind: 'handoff' | 'case'; reason: HandoffReason; firstReply: boolean; summary?: string; reply?: string },
): Promise<BotOutcome> {
  const { thread, message } = l
  const now = deps.now ?? new Date()

  // 1. Tell the user (unless the channel just failed).
  if (send) {
    const base = h.kind === 'case' ? (h.reply?.trim() ? clipReply(h.reply) : CASE_TEXT) : HANDOFF_TEXT
    const body = ensureBotDisclosure(base, h.firstReply)
    await send({ userId: thread.user_id, channel: message.channel, body, replyToId: message.id }).catch((err: unknown) => {
      console.error('[comm/bot] handoff reply failed', err instanceof Error ? err.message.slice(0, 120) : err)
    })
  }

  // 2. The request.
  const userName = await userNameOf(sb, thread.user_id)
  const caseId = await createCommCase(sb, {
    thread,
    title: h.kind === 'case' ? `Заявка из диалога: ${userName}` : `Нужен эксперт в диалоге: ${userName}`,
    summary: `${HANDOFF_REASON_LABELS[h.reason]}. ${h.summary ? previewOf(h.summary) : ''}`.trim(),
    userMessage: staffVisibleBody(message),
    slaDueAt: await (deps.slaDueAt ?? defaultSlaDueAt)(now),
  }).catch((err: unknown) => {
    console.error('[comm/bot] case failed', err instanceof Error ? err.message.slice(0, 120) : err)
    return null
  })

  // 3. The conversation waits for a person (the 30-minute rule takes over).
  const cfg = await (deps.deadline ?? loadReplyDeadline)().catch(() => ({ minutes: 30, window: null }))
  const patch = {
    status: 'waiting_staff' as const,
    staff_reply_due_at: replyDueAt(now, cfg.minutes, cfg.window).toISOString(),
    escalated_at: null,
    mode: 'manual' as const,
  }
  await updateThread(sb, thread.id, patch)

  // 4. Staff.
  try {
    await (deps.notifyHandoff ?? defaultNotifyHandoff)({ thread: { ...thread, ...patch }, message, userName, reason: h.reason, caseId, kind: h.kind })
  } catch (err) {
    console.error('[comm/bot] handoff notification failed', err instanceof Error ? err.message.slice(0, 120) : err)
  }
  return { outcome: h.kind, reason: h.reason, caseId }
}
