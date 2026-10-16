/**
 * lib/comm/audience.ts — who a broadcast reaches.
 *
 *   audience      { kind: 'filters', filters }  the GIGA users-list filters
 *                 (search, segment incl. survey / GRI progress, status, role,
 *                 «Ответственный») — exactly the rows the list shows with them
 *                 (admin_list_users via lib/admin/list-users.ts);
 *                 { kind: 'users', userIds }    users picked by hand.
 *                 «Мои клиенты» is stored as the author's id, so the audience
 *                 does not change with who presses «Запустить».
 *   expansion     the staff member's client scope applies: an expert with
 *                 «только назначенные» reaches only his clients (picked ids of
 *                 others are dropped and counted as outOfScope).
 *   reachability  per user × channel, read in batches (no query per user):
 *                 email, linked Telegram chat, phone, WhatsApp opt-out (thread
 *                 flag or the client's switch in whatsapp_links), the
 *                 communication block (comm_threads.blocked_at).
 *   plan          one recipient row per user × channel: pending, or skipped with
 *                 the reason (the preview shows the same numbers). Users and
 *                 rows are deduplicated — nobody gets one broadcast twice on a
 *                 channel (also unique (campaign_id, user_id, channel) in 120).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { scopedClientIds, type ScopedActor } from '@/lib/admin/client-scope'
import { scanAdminListUsers, userListFilterArgs, type UserListFilters } from '@/lib/admin/list-users'
import { channelAvailability, type ChannelSkipReason } from './channels'
import { phoneKey } from './phone'
import { CommError } from './store'
import { COMM_CHANNELS, type CommChannel } from './types'

/** Largest audience of one broadcast (the list scan stops after it). */
export const MAX_AUDIENCE = 5000
/** Largest hand-picked list. */
export const MAX_PICKED = 1000
/** Ids per `in (…)` read. */
const BATCH = 200

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface AudienceFilters {
  q: string
  segment: string
  status: string
  role: string
  /** '' | 'none' | <uuid> («me» is resolved to the author on save). */
  assignee: string
}

export type Audience =
  | { kind: 'filters'; filters: AudienceFilters }
  | { kind: 'users'; userIds: string[] }

/** Raw audience from a request → the stored form; null — invalid. */
export function normalizeAudience(raw: unknown, actorId: string): Audience | null {
  if (!raw || typeof raw !== 'object') return null
  const a = raw as { kind?: unknown; filters?: unknown; userIds?: unknown }
  if (a.kind === 'users') {
    if (!Array.isArray(a.userIds)) return null
    const ids = uniqueIds(a.userIds)
    if (!ids.length || ids.length > MAX_PICKED) return null
    return { kind: 'users', userIds: ids }
  }
  if (a.kind === 'filters') {
    const f = (a.filters && typeof a.filters === 'object' ? a.filters : {}) as Record<string, unknown>
    const str = (v: unknown) => (typeof v === 'string' ? v : '')
    const filters: UserListFilters = { q: str(f.q).trim().slice(0, 100), segment: str(f.segment), status: str(f.status), role: str(f.role), assignee: str(f.assignee) }
    if (!userListFilterArgs(filters, actorId)) return null
    const assignee = filters.assignee === 'me' ? actorId : filters.assignee === 'none' ? 'none' : filters.assignee ?? ''
    return { kind: 'filters', filters: { q: filters.q ?? '', segment: filters.segment ?? '', status: filters.status ?? '', role: filters.role ?? '', assignee } }
  }
  return null
}

function uniqueIds(list: unknown[]): string[] {
  const out = new Set<string>()
  for (const v of list) if (typeof v === 'string' && UUID_RE.test(v)) out.add(v.toLowerCase())
  return Array.from(out)
}

export interface ExpandedAudience {
  userIds: string[]
  /** More people match than MAX_AUDIENCE. */
  truncated: boolean
  /** Picked users outside the staff member's client scope (dropped). */
  outOfScope: number
}

/** Audience → user ids (deduplicated, scoped to the actor's clients). */
export async function expandAudience(sb: SupabaseClient, actor: ScopedActor, audience: Audience): Promise<ExpandedAudience> {
  const allowed = await scopedClientIds(actor)
  if (audience.kind === 'users') {
    const ids = uniqueIds(audience.userIds).slice(0, MAX_PICKED)
    if (!allowed) return { userIds: ids, truncated: false, outOfScope: 0 }
    const set = new Set(allowed)
    const inScope = ids.filter((id) => set.has(id))
    return { userIds: inScope, truncated: false, outOfScope: ids.length - inScope.length }
  }
  // The stored assignee is already an id / 'none'; actor.id only matters for 'me' (never stored).
  const args = userListFilterArgs(audience.filters, actor.id)
  if (!args) throw new CommError('Неверные фильтры аудитории', 'invalid')
  const rows = await scanAdminListUsers(sb as never, { ...args, p_sort: 'created_at', p_dir: 'asc' }, { allowed, maxRows: MAX_AUDIENCE + 1 })
  if (!rows) throw new CommError('Не удалось выбрать пользователей по фильтрам', 'db')
  const ids = uniqueIds(rows.map((r) => r.id))
  return { userIds: ids.slice(0, MAX_AUDIENCE), truncated: ids.length > MAX_AUDIENCE, outOfScope: 0 }
}

// ─── Reachability ───────────────────────────────────────────────────────────

export interface Reach {
  id: string
  name: string
  hasEmail: boolean
  hasTelegram: boolean
  hasPhone: boolean
  whatsappOptOut: boolean
  blocked: boolean
}

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/** What each user can be reached by; users without a profile are dropped. Keeps the input order. */
export async function loadReachability(sb: SupabaseClient, userIds: string[]): Promise<Reach[]> {
  const out = new Map<string, Reach>()
  for (const ids of chunks(userIds, BATCH)) {
    const [profiles, threads, links] = await Promise.all([
      sb.from('profiles').select('id, full_name, email, phone, telegram_chat_id').in('id', ids),
      sb.from('comm_threads').select('user_id, whatsapp_opt_out_at, blocked_at').in('user_id', ids),
      sb.from('whatsapp_links').select('user_id, opt_in_at, opt_out_at').eq('recipient_kind', 'client').in('user_id', ids),
    ])
    if (profiles.error) throw new CommError(`read profiles: ${profiles.error.message?.slice(0, 200)}`, 'db')
    if (threads.error) throw new CommError(`read threads: ${threads.error.message?.slice(0, 200)}`, 'db')
    const thread = new Map(((threads.data ?? []) as Array<{ user_id: string; whatsapp_opt_out_at: string | null; blocked_at: string | null }>).map((t) => [t.user_id, t]))
    // whatsapp_links is optional (104): a read error counts as «not opted out», like lib/comm/store.ts.
    const linkOptOut = new Set<string>()
    for (const l of (links.error ? [] : links.data ?? []) as Array<{ user_id: string; opt_in_at: string | null; opt_out_at: string | null }>) {
      if (l.opt_out_at && (!l.opt_in_at || new Date(l.opt_out_at) > new Date(l.opt_in_at))) linkOptOut.add(l.user_id)
    }
    for (const p of (profiles.data ?? []) as Array<{ id: string; full_name: string | null; email: string | null; phone: string | null; telegram_chat_id: string | number | null }>) {
      const t = thread.get(p.id)
      out.set(p.id, {
        id: p.id,
        name: p.full_name?.trim() || p.email?.trim() || 'Пользователь',
        hasEmail: !!p.email?.trim(),
        hasTelegram: !!p.telegram_chat_id,
        hasPhone: !!phoneKey(p.phone),
        whatsappOptOut: !!t?.whatsapp_opt_out_at || linkOptOut.has(p.id),
        blocked: !!t?.blocked_at,
      })
    }
  }
  return userIds.map((id) => out.get(id)).filter((r): r is Reach => !!r)
}

// ─── Plan ───────────────────────────────────────────────────────────────────

export type RecipientSkipReason = ChannelSkipReason | 'blocked'

export interface PlannedRecipient {
  user_id: string
  channel: CommChannel
  status: 'pending' | 'skipped'
  error: RecipientSkipReason | null
}

export interface ChannelPlan {
  /** Will be sent (subject to a re-check at send time). */
  send: number
  /** Cannot be reached on this channel. */
  skipped: number
  reasons: Partial<Record<RecipientSkipReason, number>>
}

export interface AudiencePlan {
  rows: PlannedRecipient[]
  users: number
  perChannel: Partial<Record<CommChannel, ChannelPlan>>
}

/** Users × channels → recipient rows and the per-channel numbers of the preview. */
export function planRecipients(
  users: Reach[],
  channels: CommChannel[],
  transports: { telegramConfigured: boolean; whatsappConfigured: boolean },
): AudiencePlan {
  const wanted = COMM_CHANNELS.filter((c) => channels.includes(c))
  const perChannel: AudiencePlan['perChannel'] = {}
  for (const c of wanted) perChannel[c] = { send: 0, skipped: 0, reasons: {} }
  const rows: PlannedRecipient[] = []
  const seen = new Set<string>()
  for (const u of users) {
    if (seen.has(u.id)) continue
    seen.add(u.id)
    const availability = channelAvailability({
      hasEmail: u.hasEmail,
      hasTelegramChat: u.hasTelegram,
      telegramBotConfigured: transports.telegramConfigured,
      hasPhone: u.hasPhone,
      whatsappOptOut: u.whatsappOptOut,
      whatsappTransport: transports.whatsappConfigured,
    })
    for (const c of wanted) {
      const a = availability[c]
      const reason: RecipientSkipReason | null = u.blocked ? 'blocked' : a.ok ? null : a.reason
      const plan = perChannel[c]!
      if (reason) {
        plan.skipped++
        plan.reasons[reason] = (plan.reasons[reason] ?? 0) + 1
      } else {
        plan.send++
      }
      rows.push({ user_id: u.id, channel: c, status: reason ? 'skipped' : 'pending', error: reason })
    }
  }
  return { rows, users: seen.size, perChannel }
}
