/**
 * lib/point-b/invites/store.ts — personal invites of a client (pb_invites, migration 129; spec §12.1).
 *
 *   createInvites      candidates of the rules → rows, with the checks:
 *                        duplicate          an ACTIVE (new / seen / snoozed, not expired) invite with the same
 *                                           dedupe_key exists (also the unique index: 23505 → duplicate)
 *                        dismissed_recently the user closed this RULE less than 14 days ago (for a recommendation
 *                                           invite: this very recommendation)
 *                        cap                the user already has 3 active invites
 *                      An active invite past its expires_at is first marked expired (it frees its dedupe key).
 *   listActiveInvites  what the page / the pop-up layer shows: new / seen, a snooze that is over, not expired;
 *                      at most 3, by priority then newest
 *   patchInvite        seen / dismiss («закрыть» = the rule pauses 14 days) / snooze 3 · 7 · 30 days / acted;
 *                      only the owner's invite
 *
 * Service-role client; the callers authorise the user. The clock comes in as `now`.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { maskProfanity } from '@/lib/moderation/profanity'
import type { InsightCandidate } from '../insights/rules'
import { cleanRefs } from '../recs/store'
import type { InviteStatus, InviteView } from './types'

export const MAX_ACTIVE_INVITES = 3
export const DISMISS_PAUSE_DAYS = 14
export const INVITE_SNOOZE_DAYS = [3, 7, 30] as const
export type InviteAction = 'seen' | 'dismiss' | 'snooze' | 'acted'

const ACTIVE: InviteStatus[] = ['new', 'seen', 'snoozed']
const DAY_MS = 86_400_000
const LIMITS = { title: 200, body: 1000, why: 600, href: 300 }
const READ_LIMIT = 100

export interface InviteRow {
  id: string
  company_id: string
  user_id: string
  rule_key: string
  dedupe_key: string
  kind: 'insight' | 'recommendation'
  title: string
  body: string
  href: string | null
  why: string
  source_refs: unknown
  priority: number
  display: 'card' | 'modal'
  status: InviteStatus
  snoozed_until: string | null
  expires_at: string | null
  delivered: Record<string, unknown> | null
  source_rec_id: string | null
  created_at: string
  updated_at: string
}

function dbError(op: string, error: { code?: string } | null | undefined): Error {
  return new Error(`point-b invites: ${op} failed (${error?.code ?? 'unknown'})`)
}

const iso = (t: number): string => new Date(t).toISOString()
const after = (value: string | null | undefined, now: Date): boolean => !!value && Date.parse(value) > now.getTime()
const expired = (r: Pick<InviteRow, 'expires_at'>, now: Date): boolean => !!r.expires_at && Date.parse(r.expires_at) <= now.getTime()
const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)
const text = (v: string | null | undefined, n: number): string => cut(maskProfanity((v ?? '').trim()), n)
/** Only a same-site path is a link of an invite. */
const safeHref = (v: string | null | undefined): string | null =>
  typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') && v.length <= LIMITS.href ? v : null

export function toInviteView(r: InviteRow): InviteView {
  return {
    id: r.id, kind: r.kind, title: r.title, body: r.body ?? '', href: r.href ?? null, why: r.why ?? '',
    sourceRefs: cleanRefs(r.source_refs), display: r.display === 'modal' ? 'modal' : 'card', createdAt: r.created_at,
  }
}

async function readUserInvites(sb: SupabaseClient, userId: string, statuses: InviteStatus[]): Promise<InviteRow[]> {
  const { data, error } = await sb.from('pb_invites').select('*').eq('user_id', userId).in('status', statuses)
    .order('created_at', { ascending: false }).limit(READ_LIMIT)
  if (error) throw dbError('read', error)
  return (data ?? []) as InviteRow[]
}

/** Active invites past their date become `expired` (one indexed update). */
async function expireOld(sb: SupabaseClient, userId: string, now: Date): Promise<void> {
  const { error } = await sb.from('pb_invites').update({ status: 'expired' }).eq('user_id', userId).in('status', ACTIVE).lt('expires_at', now.toISOString())
  if (error) throw dbError('expire', error)
}

export type SkipReason = 'duplicate' | 'dismissed_recently' | 'cap'

export async function createInvites(
  sb: SupabaseClient,
  input: { companyId: string; userId: string; candidates: InsightCandidate[]; now: Date; sourceRecId?: string | null },
): Promise<{ created: Array<{ id: string; ruleKey: string }>; skipped: Array<{ ruleKey: string; reason: SkipReason }> }> {
  const created: Array<{ id: string; ruleKey: string }> = []
  const skipped: Array<{ ruleKey: string; reason: SkipReason }> = []
  if (!input.candidates.length) return { created, skipped }
  const { now } = input

  await expireOld(sb, input.userId, now)
  const rows = await readUserInvites(sb, input.userId, [...ACTIVE, 'dismissed'])
  const active = rows.filter((r) => ACTIVE.includes(r.status) && !expired(r, now))
  const activeKeys = new Set(active.map((r) => r.dedupe_key))
  // «Закрыть» pauses: the rule (or, for a recommendation, the dedupe key) until snoozed_until.
  const paused = rows.filter((r) => r.status === 'dismissed' && after(r.snoozed_until, now))
  const pausedRules = new Set(paused.filter((r) => r.kind !== 'recommendation').map((r) => r.rule_key))
  const pausedKeys = new Set(paused.map((r) => r.dedupe_key))
  let activeCount = active.length

  for (const c of [...input.candidates].sort((a, b) => a.priority - b.priority)) {
    if (activeKeys.has(c.dedupeKey)) { skipped.push({ ruleKey: c.ruleKey, reason: 'duplicate' }); continue }
    if (pausedKeys.has(c.dedupeKey) || (c.kind !== 'recommendation' && pausedRules.has(c.ruleKey))) {
      skipped.push({ ruleKey: c.ruleKey, reason: 'dismissed_recently' })
      continue
    }
    if (activeCount >= MAX_ACTIVE_INVITES) { skipped.push({ ruleKey: c.ruleKey, reason: 'cap' }); continue }
    const title = text(c.title, LIMITS.title)
    if (!title) continue
    const { data, error } = await sb.from('pb_invites').insert({
      company_id: input.companyId,
      user_id: input.userId,
      rule_key: c.ruleKey.slice(0, 64),
      dedupe_key: c.dedupeKey.slice(0, 200),
      kind: c.kind === 'recommendation' ? 'recommendation' : 'insight',
      title,
      body: text(c.body, LIMITS.body),
      href: safeHref(c.href),
      why: text(c.why, LIMITS.why),
      source_refs: cleanRefs(c.sourceRefs),
      priority: Math.max(0, Math.min(32_000, Math.round(c.priority))),
      display: c.display === 'modal' ? 'modal' : 'card',
      status: 'new',
      expires_at: iso(now.getTime() + Math.max(1, c.expiresInDays) * DAY_MS),
      source_rec_id: input.sourceRecId ?? null,
    }).select('id').single()
    if (error) {
      // A concurrent run won the active dedupe key.
      if ((error as { code?: string }).code === '23505') { skipped.push({ ruleKey: c.ruleKey, reason: 'duplicate' }); continue }
      throw dbError('create', error)
    }
    created.push({ id: (data as { id: string }).id, ruleKey: c.ruleKey })
    activeKeys.add(c.dedupeKey)
    activeCount += 1
  }
  return { created, skipped }
}

/** The invites to show: new / seen and snoozes that are over, not expired, by priority then newest, at most 3. */
export async function listActiveInvites(sb: SupabaseClient, userId: string, now: Date): Promise<InviteView[]> {
  const rows = await readUserInvites(sb, userId, ACTIVE)
  return rows
    .filter((r) => !expired(r, now) && !(r.status === 'snoozed' && after(r.snoozed_until, now)))
    .sort((a, b) => a.priority - b.priority || b.created_at.localeCompare(a.created_at))
    .slice(0, MAX_ACTIVE_INVITES)
    .map(toInviteView)
}

/**
 * What the user did with an invite. Only the owner's invite in an active status changes; a repeated
 * dismiss / acted of an already closed invite is accepted without a write. false = not found (or not his).
 */
export async function patchInvite(
  sb: SupabaseClient,
  input: { id: string; userId: string; action: InviteAction; days?: number; now: Date },
): Promise<boolean> {
  const { now } = input
  if (input.action === 'snooze' && !(INVITE_SNOOZE_DAYS as readonly number[]).includes(input.days ?? -1)) return false
  const { data, error } = await sb.from('pb_invites').select('id, status, snoozed_until').eq('id', input.id).eq('user_id', input.userId).maybeSingle()
  if (error) throw dbError('read one', error)
  const row = data as Pick<InviteRow, 'id' | 'status' | 'snoozed_until'> | null
  if (!row) return false
  if (!ACTIVE.includes(row.status)) {
    return (input.action === 'dismiss' && row.status === 'dismissed') || (input.action === 'acted' && row.status === 'acted')
  }
  let patch: Record<string, unknown>
  switch (input.action) {
    case 'seen':
      if (row.status === 'seen') return true
      patch = { status: 'seen', snoozed_until: null }
      break
    case 'dismiss':
      patch = { status: 'dismissed', snoozed_until: iso(now.getTime() + DISMISS_PAUSE_DAYS * DAY_MS) }
      break
    case 'snooze':
      patch = { status: 'snoozed', snoozed_until: iso(now.getTime() + (input.days as number) * DAY_MS) }
      break
    case 'acted':
      patch = { status: 'acted', snoozed_until: null }
      break
    default:
      return false
  }
  const upd = await sb.from('pb_invites').update(patch).eq('id', row.id).eq('user_id', input.userId).in('status', ACTIVE).select('id')
  if (upd.error) throw dbError('update', upd.error)
  return ((upd.data ?? []) as unknown[]).length > 0
}

/** Records where an invite went (best effort; the delivery already happened). */
export async function markDelivered(sb: SupabaseClient, id: string, delivered: Record<string, unknown>): Promise<void> {
  try {
    const { error } = await sb.from('pb_invites').update({ delivered }).eq('id', id)
    if (error) console.error('[point-b/invites] delivery not recorded', error.code ?? 'unknown')
  } catch (err) {
    console.error('[point-b/invites] delivery not recorded', err instanceof Error ? err.message : err)
  }
}
