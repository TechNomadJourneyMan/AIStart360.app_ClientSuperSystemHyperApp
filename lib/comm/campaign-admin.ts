/**
 * lib/comm/campaign-admin.ts — server side of GIGA «Рассылки»
 * (/api/giga-admin/comm/campaigns/*).
 *
 *   read   inbox.view    — the list, a campaign card, its recipients
 *   write  inbox.manage  — preview, create, start, pause, resume, cancel
 *
 * A staff member with «только назначенные» sees and runs only his own
 * broadcasts, and their audience is limited to his clients (lib/comm/audience.ts).
 * Every write is audited by the route (recordAdminAction comm.campaign.*).
 */
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { hasPermission } from '@/lib/admin/rbac'
import type { GigaActor } from '@/lib/admin/giga-actor'
import { maskEmail } from '@/lib/admin/mask'
import { deliveryReasonLabel } from './labels'
import { describeWindow, isWithinWindow, nextWindowStart } from './schedule'
import { canSeeCampaign, loadCampaign, loadSendSchedule, type CampaignRow, type RecipientStatus } from './campaigns'
import { MAX_PICKED, type Audience } from './audience'
import { COMM_CHANNELS, MAX_BODY, type CommChannel } from './types'

export const CampaignTextSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(MAX_BODY + 200),
  subject: z.string().trim().max(200).nullable().optional(),
})

export const ChannelsSchema = z.array(z.enum(COMM_CHANNELS)).min(1).max(COMM_CHANNELS.length)

export const AudienceSchema = z.union([
  z.object({
    kind: z.literal('filters'),
    filters: z.object({
      q: z.string().max(200).optional(),
      segment: z.string().max(40).optional(),
      status: z.string().max(40).optional(),
      role: z.string().max(40).optional(),
      assignee: z.string().max(40).optional(),
    }).default({}),
  }),
  z.object({ kind: z.literal('users'), userIds: z.array(z.string().max(40)).min(1).max(MAX_PICKED) }),
])

/** Normalised broadcast text or an error message for the form. */
export function cleanCampaignText(body: string): { body: string } | { error: string } {
  const text = body.replace(/\r\n/g, '\n').trim()
  if (!text) return { error: 'Введите текст рассылки' }
  if (text.length > MAX_BODY) return { error: `Текст длиннее ${MAX_BODY} символов` }
  return { body: text }
}

/** The campaign of a route, or null when it does not exist or the actor may not see it (no IDOR). */
export async function campaignForActor(sb: SupabaseClient, actor: GigaActor, id: string): Promise<CampaignRow | null> {
  const c = await loadCampaign(sb, id)
  return c && canSeeCampaign(actor, c) ? c : null
}

// ─── DTOs ───────────────────────────────────────────────────────────────────

export interface AudienceSummary {
  kind: 'filters' | 'users' | 'none'
  filters?: { q: string; segment: string; status: string; role: string; assignee: string }
  users?: number
}

export function audienceSummary(a: CampaignRow['audience']): AudienceSummary {
  const aud = a as Partial<Audience>
  if (aud.kind === 'filters') return { kind: 'filters', filters: aud.filters }
  if (aud.kind === 'users') return { kind: 'users', users: aud.userIds?.length ?? 0 }
  return { kind: 'none' }
}

export interface CampaignDTO {
  id: string
  title: string
  subject: string | null
  body: string
  channels: CommChannel[]
  status: CampaignRow['status']
  audience: AudienceSummary
  author: { id: string; name: string } | null
  counts: { total: number; sent: number; failed: number; skipped: number }
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  updatedAt: string
}

export function campaignDTO(c: CampaignRow, names: Map<string, string> = new Map()): CampaignDTO {
  return {
    id: c.id, title: c.title, subject: c.subject, body: c.body, channels: c.channels, status: c.status,
    audience: audienceSummary(c.audience),
    author: c.created_by ? { id: c.created_by, name: names.get(c.created_by) ?? 'Сотрудник' } : null,
    counts: { total: c.total_count, sent: c.sent_count, failed: c.failed_count, skipped: c.skipped_count },
    createdAt: c.created_at, startedAt: c.started_at, finishedAt: c.finished_at, updatedAt: c.updated_at,
  }
}

export async function staffNames(sb: SupabaseClient, ids: Array<string | null>): Promise<Map<string, string>> {
  const uniq = Array.from(new Set(ids.filter((x): x is string => !!x)))
  if (!uniq.length) return new Map()
  const { data } = await sb.from('profiles').select('id, full_name, email').in('id', uniq)
  return new Map(((data ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map((p) => [p.id, p.full_name?.trim() || p.email || p.id]))
}

/** Working hours and pacing for the page («Рассылка идёт пн–пт 09:00–19:00…»). */
export async function scheduleInfo(now = new Date()) {
  const s = await loadSendSchedule()
  const open = isWithinWindow(now, s.window)
  return {
    window: describeWindow(s.window),
    open,
    nextAt: open ? null : nextWindowStart(now, s.window).toISOString(),
    intervalSeconds: s.intervalSeconds,
    jitterSeconds: s.jitterSeconds,
  }
}

export async function listCampaigns(sb: SupabaseClient, actor: GigaActor, opts: { status?: string | null; limit?: number } = {}) {
  let q = sb.from('comm_campaigns').select('id, title, body, subject, channels, audience, status, created_by, starts_at, started_at, finished_at, total_count, sent_count, failed_count, skipped_count, created_at, updated_at')
  if (actor.clientScope === 'assigned') q = q.eq('created_by', actor.id)
  if (opts.status) q = q.eq('status', opts.status)
  const { data, error } = await q.order('created_at', { ascending: false }).limit(Math.min(200, Math.max(1, opts.limit ?? 100)))
  if (error) throw new Error(`list campaigns: ${error.message}`)
  const rows = (data ?? []) as CampaignRow[]
  const names = await staffNames(sb, rows.map((r) => r.created_by))
  return rows.map((r) => campaignDTO(r, names))
}

// ─── Recipients of the card ─────────────────────────────────────────────────

export const RECIPIENT_STATUSES: RecipientStatus[] = ['pending', 'sending', 'sent', 'failed', 'skipped', 'cancelled']

/** Reasons of the broadcast itself, on top of the delivery reasons of lib/comm/labels.ts. */
const CAMPAIGN_REASONS: Record<string, string> = {
  blocked: 'пользователь заблокирован в сообщениях',
  user_not_found: 'пользователь удалён',
  interrupted: 'отправка прервалась — повторно не отправляли, чтобы не задвоить',
  no_message: 'канал не обработан',
}

export function recipientReasonLabel(code: string | null | undefined): string | null {
  if (!code) return null
  if (CAMPAIGN_REASONS[code]) return CAMPAIGN_REASONS[code]
  if (code.startsWith('error: ')) return `ошибка: ${code.slice(7)}`
  return deliveryReasonLabel(code)
}

export async function listRecipients(
  sb: SupabaseClient,
  actor: GigaActor,
  campaignId: string,
  opts: { status?: RecipientStatus | null; channel?: CommChannel | null; offset?: number; limit?: number },
) {
  const limit = Math.min(100, Math.max(1, opts.limit ?? 50))
  const offset = Math.max(0, opts.offset ?? 0)
  let q = sb
    .from('comm_campaign_recipients')
    .select('id, user_id, channel, status, error, message_id, updated_at', { count: 'exact' })
    .eq('campaign_id', campaignId)
  if (opts.status) q = q.eq('status', opts.status)
  if (opts.channel) q = q.eq('channel', opts.channel)
  const { data, error, count } = await q.order('updated_at', { ascending: false }).range(offset, offset + limit - 1)
  if (error) throw new Error(`list recipients: ${error.message}`)
  const rows = (data ?? []) as Array<{ id: string; user_id: string; channel: CommChannel; status: RecipientStatus; error: string | null; message_id: string | null; updated_at: string }>
  const ids = Array.from(new Set(rows.map((r) => r.user_id)))
  const { data: people } = ids.length ? await sb.from('profiles').select('id, full_name, email').in('id', ids) : { data: [] }
  const sensitive = hasPermission(actor.role, 'users.sensitive')
  const byId = new Map(((people ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map((p) => [p.id, p]))
  return {
    total: count ?? rows.length,
    data: rows.map((r) => {
      const p = byId.get(r.user_id)
      return {
        id: r.id,
        userId: r.user_id,
        name: p?.full_name?.trim() || p?.email || 'Пользователь',
        email: sensitive ? p?.email ?? null : maskEmail(p?.email ?? null),
        channel: r.channel,
        status: r.status,
        error: r.error,
        reason: recipientReasonLabel(r.error),
        updatedAt: r.updated_at,
      }
    }),
  }
}
