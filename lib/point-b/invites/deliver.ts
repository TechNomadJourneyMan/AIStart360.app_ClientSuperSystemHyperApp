/**
 * lib/point-b/invites/deliver.ts — where an invite goes besides the page (spec §12.1):
 *
 *   bell      the in-app notification through notifyClient (category «Напоминания»; a verified recommendation —
 *             «Эксперт»), with email and Telegram switched off for this send; idempotent per invite.
 *   external  email / Telegram through notifyClient, ONLY when
 *               - the client has Point B (PRO, or the access gates are off),
 *               - nobody is driving the cabinet «от имени»,
 *               - the client keeps email or Telegram ON for that category (settings → notifications),
 *               - and no other invite went out this ISO week: one external invite per user per week, claimed in
 *                 automation_sends with the key `pb_invite_ext:<user>:<ISO week>` (a failed send gives it back;
 *                 without the journal nothing goes out — the weekly cap cannot be kept without it).
 *             WhatsApp — V2.
 * Never throws: the invite exists either way.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { notifyClient } from '@/lib/notifications/notify'
import { resolveChannels, type NotifyCategory } from '@/lib/notifications/preferences'
import { claimSend, getRecipient, releaseSend } from '@/lib/notifications/store'
import { markDelivered } from './store'

export interface DeliverInput {
  invite: { id: string; title: string; body: string; href: string | null; kind?: 'insight' | 'recommendation' }
  userId: string
  now: Date
  pro: boolean
  impersonating: boolean
}

export interface DeliverResult {
  bell: boolean
  external: 'sent' | 'capped' | 'off'
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

export async function deliverInvite(sb: SupabaseClient, input: DeliverInput): Promise<DeliverResult> {
  const { invite, userId, now } = input
  const category: NotifyCategory = invite.kind === 'recommendation' ? 'expert' : 'reminders'
  const base = {
    userId, category, event: 'pb_invite', title: invite.title, body: invite.body,
    ctaUrl: invite.href ?? DEFAULT_HREF, ctaLabel: 'Открыть', metadata: { inviteId: invite.id },
  }
  const out: DeliverResult = { bell: false, external: 'off' }

  try {
    const bell = await notifyClient({ ...base, dedupeKey: `pb_invite:${invite.id}:app`, channels: { email: false, telegram: false } }, now)
    out.bell = bell.delivered.inApp || bell.skipped === 'duplicate'
  } catch (err) {
    console.error('[point-b/invites] bell failed', err instanceof Error ? err.message : err)
  }

  try {
    out.external = await external(input, base, category)
  } catch (err) {
    console.error('[point-b/invites] external delivery failed', err instanceof Error ? err.message : err)
    out.external = 'off'
  }

  await markDelivered(sb, invite.id, { bell: out.bell ? now.toISOString() : null, external: out.external, at: now.toISOString() })
  return out
}

async function external(input: DeliverInput, base: Parameters<typeof notifyClient>[0], category: NotifyCategory): Promise<DeliverResult['external']> {
  if (!input.pro || input.impersonating) return 'off'
  const profile = await getRecipient(input.userId)
  if (!profile) return 'off'
  const ch = resolveChannels(profile.preferences, category, { hasEmail: !!profile.email, hasTelegram: !!profile.telegramChatId })
  if (!ch.email && !ch.telegram) return 'off'

  const claim = await claimSend({
    userId: input.userId, kind: 'pb_invite_external', dedupeKey: externalKey(input.userId, input.now), countsTowardCap: false,
    channels: [ch.email && 'email', ch.telegram && 'telegram'].filter(Boolean) as string[], metadata: { inviteId: input.invite.id },
  })
  if (claim.result !== 'claimed') return 'capped'

  const res = await notifyClient({ ...base, dedupeKey: `pb_invite:${input.invite.id}:ext`, channels: { inApp: false, email: ch.email, telegram: ch.telegram } }, input.now)
  if (res.delivered.email || res.delivered.telegram) return 'sent'
  if (claim.id) await releaseSend(claim.id)
  return 'off'
}
