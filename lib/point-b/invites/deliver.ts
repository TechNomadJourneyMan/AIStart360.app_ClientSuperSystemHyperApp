/**
 * lib/point-b/invites/deliver.ts — where an invite goes besides the page (spec §12.1):
 *
 *   bell      the in-app notification through notifyClient (category «Напоминания»; a verified recommendation —
 *             «Эксперт»), with email and Telegram switched off for this send; idempotent per invite. ALWAYS at once.
 *   external  email / Telegram through lib/comm (sendToUser, author «system»: the message lands in the client's
 *             conversation «Сообщения» and goes out to the channels he chose), ONLY when
 *               - the client has Point B (PRO, or the access gates are off),
 *               - nobody is driving the cabinet «от имени»,
 *               - the client keeps email or Telegram ON for that category (settings → notifications),
 *               - it is the working hours of «Общение» (settings comm_work_days / comm_work_from / comm_work_to /
 *                 comm_timezone, default Mon–Fri 09:00–19:00 Asia/Almaty — the profiles keep no time zone of their
 *                 own); outside them the send is DEFERRED: the invite is marked `delivered.external = 'pending'`
 *                 and the Inngest sweeper (lib/functions/point-b-invites.ts) delivers it in the next window
 *                 (deliverPendingExternal, which re-checks everything above at that moment),
 *               - and no other invite went out this ISO week: one external invite per user per week, claimed in
 *                 automation_sends with the key `pb_invite_ext:<user>:<ISO week>` (a failed send gives it back;
 *                 without the journal nothing goes out — the weekly cap cannot be kept without it).
 *             WhatsApp — V2 (it has no switch in the notification settings).
 * Never throws: the invite exists either way.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendToUser } from '@/lib/comm/send'
import { DEFAULT_WINDOW, isWithinWindow, nextWindowStart, type WorkWindow } from '@/lib/comm/schedule'
import type { CommChannel } from '@/lib/comm/types'
import { notifyClient } from '@/lib/notifications/notify'
import { resolveChannels, type NotifyCategory } from '@/lib/notifications/preferences'
import { claimSend, getRecipient, releaseSend } from '@/lib/notifications/store'
import { getSetting } from '@/lib/settings/store'
import { getSiteUrl } from '@/lib/site-url'
import { hasPointB } from './access'
import { markDelivered } from './store'

export interface InviteToDeliver { id: string; title: string; body: string; href: string | null; kind?: 'insight' | 'recommendation' }

export interface DeliverInput {
  invite: InviteToDeliver
  userId: string
  now: Date
  pro: boolean
  impersonating: boolean
}

export type ExternalOutcome = 'sent' | 'capped' | 'off' | 'deferred'

export interface DeliverResult {
  bell: boolean
  external: ExternalOutcome
}

/** What the external channel needs from the outside world (injectable for tests). */
export interface ExternalSendInput {
  userId: string
  channels: CommChannel[]
  subject: string
  body: string
}
export type ExternalSender = (input: ExternalSendInput) => Promise<boolean>

export interface DeliverDeps {
  /** The working hours; default — the «Общение» settings. */
  window?: () => Promise<WorkWindow>
  send?: ExternalSender
}

const DEFAULT_HREF = '/client/point-b'

/** ISO-8601 week of a date in UTC: «2026-W43». */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1)
  const week = Math.ceil(((t.getTime() - yearStart) / 86_400_000 + 1) / 7)
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

export const externalKey = (userId: string, now: Date): string => `pb_invite_ext:${userId}:${isoWeek(now)}`

/** The working hours of «Общение» (cached 5 s by lib/settings/store); defaults when unreadable. */
export async function loadInviteWindow(): Promise<WorkWindow> {
  try {
    const [days, from, to, timeZone] = await Promise.all([
      getSetting('comm_work_days'), getSetting('comm_work_from'), getSetting('comm_work_to'), getSetting('comm_timezone'),
    ])
    return { days, from, to, timeZone }
  } catch {
    return DEFAULT_WINDOW
  }
}

/** Send now (inside the working hours) or at the start of the next window. Pure. */
export function externalTiming(now: Date, window: WorkWindow): { now: true } | { now: false; at: Date } {
  return isWithinWindow(now, window) ? { now: true } : { now: false, at: nextWindowStart(now, window) }
}

/** The text of the external invite: title, body and the link (the e-mail button leads to «Сообщения»). */
export function externalText(invite: InviteToDeliver): { subject: string; body: string } {
  const link = getSiteUrl(invite.href ?? DEFAULT_HREF)
  const body = [invite.title.trim(), invite.body.trim(), `Открыть: ${link}`].filter(Boolean).join('\n\n')
  return { subject: invite.title.trim().slice(0, 200), body }
}

/** Default sender: lib/comm, author «system» — the thread status and the reply deadline do not change. */
const commSender: ExternalSender = async (input) => {
  const r = await sendToUser({ userId: input.userId, channels: input.channels, subject: input.subject, body: input.body, authorKind: 'system' })
  return r.ok
}

const categoryOf = (invite: InviteToDeliver): NotifyCategory => (invite.kind === 'recommendation' ? 'expert' : 'reminders')

export async function deliverInvite(sb: SupabaseClient, input: DeliverInput, deps: DeliverDeps = {}): Promise<DeliverResult> {
  const { invite, userId, now } = input
  const category = categoryOf(invite)
  const out: DeliverResult = { bell: false, external: 'off' }

  try {
    const bell = await notifyClient({
      userId, category, event: 'pb_invite', title: invite.title, body: invite.body,
      ctaUrl: invite.href ?? DEFAULT_HREF, ctaLabel: 'Открыть', metadata: { inviteId: invite.id },
      dedupeKey: `pb_invite:${invite.id}:app`, channels: { email: false, telegram: false },
    }, now)
    out.bell = bell.delivered.inApp || bell.skipped === 'duplicate'
  } catch (err) {
    console.error('[point-b/invites] bell failed', err instanceof Error ? err.message : err)
  }

  let due: Date | null = null
  try {
    const channels = input.pro && !input.impersonating ? await externalChannels(userId, category) : null
    if (channels) {
      const timing = externalTiming(now, await (deps.window ?? loadInviteWindow)())
      if (timing.now) out.external = await sendExternal(invite, userId, now, deps.send, channels)
      else { out.external = 'deferred'; due = timing.at }
    }
  } catch (err) {
    console.error('[point-b/invites] external delivery failed', err instanceof Error ? err.message : err)
    out.external = 'off'
  }

  await markDelivered(sb, invite.id, {
    bell: out.bell ? now.toISOString() : null,
    external: out.external === 'deferred' ? 'pending' : out.external,
    ...(due ? { external_due: due.toISOString() } : {}),
    at: now.toISOString(),
  })
  return out
}

/** The channels the client keeps on for the category (email / Telegram), or null — none. */
async function externalChannels(userId: string, category: NotifyCategory): Promise<CommChannel[] | null> {
  const profile = await getRecipient(userId)
  if (!profile) return null
  const ch = resolveChannels(profile.preferences, category, { hasEmail: !!profile.email, hasTelegram: !!profile.telegramChatId })
  const list = [ch.email && 'email', ch.telegram && 'telegram'].filter(Boolean) as CommChannel[]
  return list.length ? list : null
}

/** Weekly claim → lib/comm. A deferred send reads the preferences again: the client may have changed them meanwhile. */
async function sendExternal(
  invite: InviteToDeliver, userId: string, now: Date, send: ExternalSender = commSender, known?: CommChannel[],
): Promise<'sent' | 'capped' | 'off'> {
  const channels = known ?? (await externalChannels(userId, categoryOf(invite)))
  if (!channels) return 'off'
  const claim = await claimSend({
    userId, kind: 'pb_invite_external', dedupeKey: externalKey(userId, now), countsTowardCap: false,
    channels, metadata: { inviteId: invite.id },
  })
  if (claim.result !== 'claimed') return 'capped'
  let ok = false
  try {
    ok = await send({ userId, channels, ...externalText(invite) })
  } catch (err) {
    console.error('[point-b/invites] external send failed', err instanceof Error ? err.message : err)
  }
  if (ok) return 'sent'
  if (claim.id) await releaseSend(claim.id)
  return 'off'
}

// ─── The deferred sends ─────────────────────────────────────────────────────

/** Invites waiting for the working hours, read per sweep step. */
export const PENDING_BATCH = 10
const ACTIVE = ['new', 'seen', 'snoozed']

interface PendingRow {
  id: string
  user_id: string
  kind: 'insight' | 'recommendation'
  title: string
  body: string | null
  href: string | null
  status: string
  expires_at: string | null
  delivered: Record<string, unknown> | null
}

export interface PendingSweepResult {
  processed: number
  sent: number
  capped: number
  off: number
  dropped: number
  /** A full batch was read: there may be more. */
  more: boolean
  skipped?: 'outside_window'
}

export interface PendingDeps {
  window?: () => Promise<WorkWindow>
  send?: ExternalSender
  hasPointB?: (sb: SupabaseClient, userId: string) => Promise<boolean>
  limit?: number
}

/**
 * One sweep step: at most PENDING_BATCH deferred invites, oldest first. Only inside the working hours (outside
 * them the invites table is not read). An invite that is no longer active (closed, acted, expired) is `dropped`;
 * otherwise the access, the preferences and the weekly cap are checked again at this moment. Throws only when
 * the read fails (the step is retried; the weekly claim keeps a repeated send out).
 */
export async function deliverPendingExternal(sb: SupabaseClient, now: Date, deps: PendingDeps = {}): Promise<PendingSweepResult> {
  const res: PendingSweepResult = { processed: 0, sent: 0, capped: 0, off: 0, dropped: 0, more: false }
  if (!isWithinWindow(now, await (deps.window ?? loadInviteWindow)())) return { ...res, skipped: 'outside_window' }
  const limit = Math.max(1, Math.min(PENDING_BATCH, deps.limit ?? PENDING_BATCH))
  const { data, error } = await sb.from('pb_invites')
    .select('id, user_id, kind, title, body, href, status, expires_at, delivered')
    .eq('delivered->>external', 'pending')
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(`point-b invites: pending read failed (${(error as { code?: string }).code ?? 'unknown'})`)
  const rows = (data ?? []) as PendingRow[]
  res.more = rows.length === limit
  const open = deps.hasPointB ?? hasPointB

  for (const r of rows) {
    res.processed++
    let outcome: 'sent' | 'capped' | 'off' | 'dropped'
    try {
      const alive = ACTIVE.includes(r.status) && !(r.expires_at && Date.parse(r.expires_at) <= now.getTime())
      if (!alive) outcome = 'dropped'
      else if (!(await open(sb, r.user_id))) outcome = 'off'
      else outcome = await sendExternal({ id: r.id, title: r.title, body: r.body ?? '', href: r.href, kind: r.kind }, r.user_id, now, deps.send)
    } catch (err) {
      console.error('[point-b/invites] deferred send failed', err instanceof Error ? err.message : err)
      outcome = 'off'
    }
    res[outcome]++
    await markDelivered(sb, r.id, { ...(r.delivered ?? {}), external: outcome, external_at: now.toISOString() })
  }
  return res
}
