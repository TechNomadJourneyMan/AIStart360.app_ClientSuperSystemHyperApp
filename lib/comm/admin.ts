/**
 * lib/comm/admin.ts — server side of GIGA «Сообщения» (/api/giga-admin/comm/*).
 *
 *   read   inbox.view    — the thread list, a conversation, the assignees
 *   write  inbox.manage  — send, assign, close / reopen, auto mode, WhatsApp opt-out,
 *                          block / unblock in communication
 *
 * Staff see an inbound message with profanity masked («б***», badge
 * «нецензурное»); the original text is a separate request (inbox.view, audited).
 *
 * Every route that names a user goes through guardClientAccess: an expert in
 * «только назначенные» sees and writes only to his clients; lists are narrowed
 * by scopedClientIds. Contacts are masked for a role without users.sensitive.
 * Writes go through the service role; the identity is the GIGA actor.
 */
import { NextResponse, type NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireGiga, type GigaActor } from '@/lib/admin/giga-actor'
import { guardClientAccess, scopedClientIds, NO_ID } from '@/lib/admin/client-scope'
import { hasPermission, type Permission } from '@/lib/admin/rbac'
import { maskEmail, maskPhone } from '@/lib/admin/mask'
import { createServiceClient } from '@/lib/supabase-service'
import { channelAvailability, type ChannelAvailability } from './channels'
import { phoneKey } from './phone'
import { staffVisibleBody } from './moderation'
import { isOverdue } from './state'
import { findThreadByUser, listMessages, loadRecipient, whatsappLinkOptedOut } from './store'
import { defaultTransports, type CommTransports } from './transports'
import { THREAD_COLUMNS, type CommMessageRow, type CommThreadRow } from './types'

export type CommGuard =
  | { response: NextResponse; actor?: undefined; sb?: undefined }
  | { response?: undefined; actor: GigaActor; sb: SupabaseClient }

export function commError(error: string, status = 400): NextResponse {
  return NextResponse.json({ ok: false, error }, { status })
}

/** A GIGA actor with `permission`; with `userId` also inside the actor's client scope. */
export async function guardComm(req: NextRequest, permission: Permission, userId?: string): Promise<CommGuard> {
  const g = await requireGiga(req, permission)
  if (g.response) return { response: g.response }
  if (userId !== undefined) {
    const denied = await guardClientAccess(g.actor, userId)
    if (denied) return { response: denied }
  }
  return { actor: g.actor, sb: createServiceClient() }
}

/** The name staff are shown under: profile name, else email. */
export async function actorName(sb: SupabaseClient, actor: Pick<GigaActor, 'id' | 'email'>): Promise<string> {
  const { data } = await sb.from('profiles').select('full_name, email').eq('id', actor.id).maybeSingle()
  const p = data as { full_name?: string | null; email?: string | null } | null
  return p?.full_name?.trim() || p?.email?.trim() || actor.email || 'Эксперт AIStart360'
}

// ─── DTOs ───────────────────────────────────────────────────────────────────

export interface MessageDTO {
  id: string
  groupId: string
  direction: 'in' | 'out'
  channel: CommMessageRow['channel']
  authorKind: CommMessageRow['author_kind']
  authorName: string | null
  /** For staff: the masked text when the original has profanity. */
  body: string
  /** The original is hidden behind «Показать» (GET …/messages/:id/original). */
  masked: boolean
  profanity: boolean
  subject: string | null
  status: CommMessageRow['status']
  error: string | null
  createdAt: string
  sentAt: string | null
}

export function messageDTO(m: CommMessageRow): MessageDTO {
  return {
    id: m.id, groupId: m.group_id, direction: m.direction, channel: m.channel, authorKind: m.author_kind,
    authorName: m.author_name, body: staffVisibleBody(m), masked: !!m.body_masked && m.body_masked !== m.body,
    profanity: !!m.flags?.profanity, subject: m.subject, status: m.status, error: m.error,
    createdAt: m.created_at, sentAt: m.sent_at,
  }
}

export interface ThreadDTO {
  id: string
  status: CommThreadRow['status']
  mode: CommThreadRow['mode']
  assigneeId: string | null
  lastMessageAt: string | null
  lastInboundAt: string | null
  preview: string | null
  unreadStaff: number
  dueAt: string | null
  overdue: boolean
  escalatedAt: string | null
  whatsappOptOut: boolean
  profanityCount: number
  blockedAt: string | null
  blockReason: string | null
}

export function threadDTO(t: CommThreadRow, now = new Date()): ThreadDTO {
  return {
    id: t.id, status: t.status, mode: t.mode, assigneeId: t.assignee_id, lastMessageAt: t.last_message_at,
    lastInboundAt: t.last_inbound_at, preview: t.last_message_preview, unreadStaff: t.unread_staff,
    dueAt: t.status === 'waiting_staff' ? t.staff_reply_due_at : null, overdue: isOverdue(t, now),
    escalatedAt: t.escalated_at, whatsappOptOut: !!t.whatsapp_opt_out_at,
    profanityCount: t.profanity_count ?? 0, blockedAt: t.blocked_at, blockReason: t.block_reason,
  }
}

async function namesOf(sb: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const uniq = Array.from(new Set(ids.filter(Boolean)))
  if (!uniq.length) return new Map()
  const { data } = await sb.from('profiles').select('id, full_name, email').in('id', uniq)
  return new Map(((data ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map((p) => [p.id, p.full_name?.trim() || p.email || p.id]))
}

// ─── Conversation of one user ───────────────────────────────────────────────

export async function conversationView(sb: SupabaseClient, actor: GigaActor, userId: string, transports: CommTransports = defaultTransports) {
  const recipient = await loadRecipient(sb, userId)
  if (!recipient) return null
  const [thread, companyRes] = await Promise.all([
    findThreadByUser(sb, userId),
    sb.from('companies').select('name').eq('user_id', userId).limit(1).maybeSingle(),
  ])
  const messages = thread ? await listMessages(sb, thread.id) : []
  const assigneeNames = thread?.assignee_id ? await namesOf(sb, [thread.assignee_id]) : new Map<string, string>()
  const optedOut = !!thread?.whatsapp_opt_out_at || (await whatsappLinkOptedOut(sb, userId))
  const channels: ChannelAvailability = channelAvailability({
    hasEmail: !!recipient.email,
    hasTelegramChat: !!recipient.telegramChatId,
    telegramBotConfigured: transports.telegramConfigured(),
    hasPhone: !!phoneKey(recipient.phone),
    whatsappOptOut: optedOut,
    whatsappTransport: transports.whatsappConfigured(),
  })
  const sensitive = hasPermission(actor.role, 'users.sensitive')
  return {
    user: {
      id: recipient.id,
      name: recipient.fullName || recipient.email || 'Пользователь',
      email: sensitive ? recipient.email : maskEmail(recipient.email),
      phone: sensitive ? recipient.phone : maskPhone(recipient.phone),
      company: ((companyRes.data as { name?: string | null } | null)?.name) ?? null,
      telegramLinked: !!recipient.telegramChatId,
    },
    thread: thread ? threadDTO(thread) : null,
    assignee: thread?.assignee_id ? { id: thread.assignee_id, name: assigneeNames.get(thread.assignee_id) ?? thread.assignee_id } : null,
    channels,
    messages: messages.map(messageDTO),
    can: { manage: hasPermission(actor.role, 'inbox.manage') },
  }
}

// ─── Thread list ────────────────────────────────────────────────────────────

export const THREAD_FILTERS = ['all', 'waiting', 'mine', 'unassigned', 'overdue', 'auto', 'violations', 'closed'] as const
export type ThreadFilter = (typeof THREAD_FILTERS)[number]

export function isThreadFilter(v: unknown): v is ThreadFilter {
  return typeof v === 'string' && (THREAD_FILTERS as readonly string[]).includes(v)
}

/** Search text safe for a PostgREST `or=(…ilike…)` filter: no commas, brackets or wildcards. */
export function searchPattern(raw: string | null | undefined): string | null {
  const clean = (raw ?? '').replace(/[^\p{L}\p{N}\s@._+-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
  return clean.length >= 2 ? `%${clean}%` : null
}

/** Users matching the search by name, email or company (null — no search). */
async function searchUserIds(sb: SupabaseClient, q: string | null): Promise<string[] | null> {
  const pattern = searchPattern(q)
  if (!pattern) return null
  const [people, companies] = await Promise.all([
    sb.from('profiles').select('id').or(`full_name.ilike.${pattern},email.ilike.${pattern}`).limit(200),
    sb.from('companies').select('user_id').ilike('name', pattern).limit(200),
  ])
  const ids = new Set<string>()
  for (const r of (people.data ?? []) as Array<{ id: string }>) ids.add(r.id)
  for (const r of (companies.data ?? []) as Array<{ user_id: string | null }>) if (r.user_id) ids.add(r.user_id)
  return Array.from(ids)
}

function intersect(a: string[] | null, b: string[] | null): string[] | null {
  if (!a) return b
  if (!b) return a
  const set = new Set(b)
  return a.filter((x) => set.has(x))
}

/** The PostgREST builder is chained conditionally; its generic type is not worth spelling out here. */
type Query = any

function applyFilter(q: Query, filter: ThreadFilter, actorId: string, nowIso: string): Query {
  switch (filter) {
    case 'waiting': return q.eq('status', 'waiting_staff')
    case 'overdue': return q.eq('status', 'waiting_staff').lt('staff_reply_due_at', nowIso)
    case 'mine': return q.eq('assignee_id', actorId)
    case 'unassigned': return q.is('assignee_id', null).neq('status', 'closed')
    case 'auto': return q.eq('mode', 'auto')
    case 'violations': return q.or('profanity_count.gt.0,blocked_at.not.is.null')
    case 'closed': return q.eq('status', 'closed')
    default: return q
  }
}

export async function listThreads(sb: SupabaseClient, actor: GigaActor, opts: { filter: ThreadFilter; q?: string | null; limit?: number; now?: Date }) {
  const now = opts.now ?? new Date()
  const nowIso = now.toISOString()
  const ids = intersect(await scopedClientIds(actor), await searchUserIds(sb, opts.q ?? null))
  const scope = (q: Query): Query => (ids ? q.in('user_id', ids.length ? ids : [NO_ID]) : q)

  let list: Query = scope(applyFilter(sb.from('comm_threads').select(THREAD_COLUMNS), opts.filter, actor.id, nowIso))
  list = opts.filter === 'waiting' || opts.filter === 'overdue'
    ? list.order('staff_reply_due_at', { ascending: true })
    : list.order('last_message_at', { ascending: false, nullsFirst: false })
  const count = (f: ThreadFilter) => scope(applyFilter(sb.from('comm_threads').select('id', { count: 'exact', head: true }), f, actor.id, nowIso))

  const [rowsRes, waiting, overdue, mine] = await Promise.all([
    list.limit(Math.min(200, Math.max(1, opts.limit ?? 100))),
    count('waiting'), count('overdue'), count('mine'),
  ])
  if (rowsRes.error) throw new Error(`list threads: ${rowsRes.error.message}`)
  const threads = (rowsRes.data ?? []) as CommThreadRow[]

  const userIds = threads.map((t) => t.user_id)
  const [people, companies, assignees] = await Promise.all([
    userIds.length ? sb.from('profiles').select('id, full_name, email').in('id', userIds) : Promise.resolve({ data: [] }),
    userIds.length ? sb.from('companies').select('user_id, name').in('user_id', userIds) : Promise.resolve({ data: [] }),
    namesOf(sb, threads.map((t) => t.assignee_id ?? '')),
  ])
  const sensitive = hasPermission(actor.role, 'users.sensitive')
  const personById = new Map(((people.data ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map((p) => [p.id, p]))
  const companyByUser = new Map(((companies.data ?? []) as Array<{ user_id: string; name: string | null }>).map((c) => [c.user_id, c.name]))

  return {
    data: threads.map((t) => {
      const p = personById.get(t.user_id)
      return {
        userId: t.user_id,
        name: p?.full_name?.trim() || p?.email || 'Пользователь',
        email: sensitive ? p?.email ?? null : maskEmail(p?.email ?? null),
        company: companyByUser.get(t.user_id) ?? null,
        assignee: t.assignee_id ? { id: t.assignee_id, name: assignees.get(t.assignee_id) ?? t.assignee_id } : null,
        thread: threadDTO(t, now),
      }
    }),
    counts: { waiting: waiting.count ?? 0, overdue: overdue.count ?? 0, mine: mine.count ?? 0 },
  }
}
