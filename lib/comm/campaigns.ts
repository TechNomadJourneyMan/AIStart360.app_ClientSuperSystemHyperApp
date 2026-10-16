/**
 * lib/comm/campaigns.ts — broadcasts («Рассылки», spec §6.2): the campaign
 * lifecycle and one step of the sending engine.
 *
 *   draft ──start──▶ scheduled (recipients being written) ──▶ running ⇄ paused
 *     │                                                        │   ╲
 *     └──────────────cancel────────────▶ cancelled ◀──cancel───┘    ╲──▶ done
 *
 *   start      expands the audience (lib/comm/audience.ts) with the starting
 *              staff member's client scope, writes one comm_campaign_recipients
 *              row per user × channel (pending / skipped with the reason;
 *              unique (campaign_id, user_id, channel) — never twice), then
 *              running + the Inngest event (lib/functions/comm-campaigns.ts).
 *   tick       ONE recipient (= one user, all his pending channels of the
 *              campaign — one bubble in his conversation) per call, in a few
 *              short queries, no transaction held:
 *                campaign not running → stop; outside the working hours →
 *                wait until the next window; next pending user by
 *                scheduled_for (the queue index of 120) → claim his rows
 *                (pending → sending, guarded by the status, so a duplicate
 *                run cannot send them again) → sendToUser (the message lands
 *                in his conversation with campaign_id, as `system`: the
 *                thread status / reply deadline do not change) → rows and
 *                counters → the pause before the next one.
 *   finish     no pending rows left: rows left in `sending` by a crashed step
 *              become failed «interrupted» (never resent — the message may have
 *              gone out), counters recounted, status done.
 *
 * Counters (total / sent / failed / skipped) live on comm_campaigns; the card
 * reads them plus per-channel counts (head counts on the queue index).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ScopedActor } from '@/lib/admin/client-scope'
import { createServiceClient } from '@/lib/supabase-service'
import { expandAudience, loadReachability, planRecipients, MAX_AUDIENCE, type Audience, type AudiencePlan } from './audience'
import { sendToUser } from './send'
import { DEFAULT_WINDOW, isWithinWindow, nextWindowStart, sendPauseMs, type WorkWindow } from './schedule'
import { CommError } from './store'
import { defaultTransports, type CommTransports } from './transports'
import type { CommChannel } from './types'
import type { CampaignStatus, RecipientStatus } from './campaign-labels'

export const COMM_CAMPAIGN_RUN_EVENT = 'comm/campaign.run'

export type { CampaignStatus, RecipientStatus } from './campaign-labels'

export interface CampaignRow {
  id: string
  title: string
  body: string
  subject: string | null
  channels: CommChannel[]
  audience: Audience | Record<string, never>
  status: CampaignStatus
  created_by: string | null
  starts_at: string | null
  started_at: string | null
  finished_at: string | null
  total_count: number
  sent_count: number
  failed_count: number
  skipped_count: number
  created_at: string
  updated_at: string
}

export const CAMPAIGN_COLUMNS =
  'id, title, body, subject, channels, audience, status, created_by, starts_at, started_at, finished_at, total_count, sent_count, failed_count, skipped_count, created_at, updated_at'

/** Recipient rows per insert. */
const INSERT_BATCH = 500
/** A row stuck in `sending` this long belongs to a crashed step. */
const STUCK_SENDING_MS = 5 * 60_000

function dbError(op: string, error: { message?: string; code?: string } | null): CommError {
  return new CommError(`${op}: ${error?.code ?? ''} ${error?.message?.slice(0, 200) ?? 'database error'}`.trim(), 'db')
}

/** Scoped staff («только назначенные») see and run only their own broadcasts. */
export function canSeeCampaign(actor: ScopedActor, c: Pick<CampaignRow, 'created_by'>): boolean {
  return actor.clientScope !== 'assigned' || c.created_by === actor.id
}

export async function loadCampaign(sb: SupabaseClient, id: string): Promise<CampaignRow | null> {
  const { data, error } = await sb.from('comm_campaigns').select(CAMPAIGN_COLUMNS).eq('id', id).maybeSingle()
  if (error) throw dbError('read campaign', error)
  return (data as CampaignRow | null) ?? null
}

// ─── Settings ───────────────────────────────────────────────────────────────

export interface SendSchedule {
  window: WorkWindow
  intervalSeconds: number
  jitterSeconds: number
}

export const DEFAULT_SCHEDULE: SendSchedule = { window: DEFAULT_WINDOW, intervalSeconds: 10, jitterSeconds: 5 }

/** The «Общение» settings (cached 5 s by lib/settings/store); defaults when unreadable. */
export async function loadSendSchedule(): Promise<SendSchedule> {
  try {
    const { getSetting } = await import('@/lib/settings/store')
    const [days, from, to, timeZone, intervalSeconds, jitterSeconds] = await Promise.all([
      getSetting('comm_work_days'), getSetting('comm_work_from'), getSetting('comm_work_to'),
      getSetting('comm_timezone'), getSetting('comm_send_interval_seconds'), getSetting('comm_send_jitter_seconds'),
    ])
    return { window: { days, from, to, timeZone }, intervalSeconds, jitterSeconds }
  } catch {
    return DEFAULT_SCHEDULE
  }
}

// ─── Inngest ────────────────────────────────────────────────────────────────

function inngestConfigured(): boolean {
  return Boolean(process.env.INNGEST_EVENT_KEY) || process.env.INNGEST_DEV === '1'
}

/** Wake the sending engine for a campaign. Never throws; false when Inngest is not configured or the send failed. */
export async function emitCampaignRun(campaignId: string): Promise<boolean> {
  if (!inngestConfigured()) {
    console.warn('[comm/campaigns] Inngest is not configured — the broadcast waits for the engine', campaignId)
    return false
  }
  try {
    const { inngest } = await import('@/lib/inngest')
    await inngest.send({ name: COMM_CAMPAIGN_RUN_EVENT, data: { campaignId } })
    return true
  } catch (err) {
    console.error('[comm/campaigns] inngest send failed', err instanceof Error ? err.message : err)
    return false
  }
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────

export interface NewCampaign {
  title: string
  body: string
  subject: string | null
  channels: CommChannel[]
  audience: Audience
}

export async function createCampaign(sb: SupabaseClient, actorId: string, input: NewCampaign): Promise<CampaignRow> {
  const { data, error } = await sb
    .from('comm_campaigns')
    .insert({ title: input.title, body: input.body, subject: input.subject, channels: input.channels, audience: input.audience, status: 'draft', created_by: actorId })
    .select(CAMPAIGN_COLUMNS)
    .maybeSingle()
  if (error) throw dbError('create campaign', error)
  if (!data) throw new CommError('create campaign: no row returned', 'db')
  return data as CampaignRow
}

export interface AudiencePreview extends Omit<AudiencePlan, 'rows'> {
  truncated: boolean
  outOfScope: number
  max: number
}

/** The numbers of «Предпросмотр» (and what start will write). */
export async function previewAudience(
  sb: SupabaseClient,
  actor: ScopedActor,
  audience: Audience,
  channels: CommChannel[],
  transports: CommTransports = defaultTransports,
): Promise<{ preview: AudiencePreview; plan: AudiencePlan }> {
  const expanded = await expandAudience(sb, actor, audience)
  const reach = await loadReachability(sb, expanded.userIds)
  const plan = planRecipients(reach, channels, {
    telegramConfigured: transports.telegramConfigured(),
    whatsappConfigured: transports.whatsappConfigured(),
  })
  const { rows: _rows, ...numbers } = plan
  return { preview: { ...numbers, truncated: expanded.truncated, outOfScope: expanded.outOfScope, max: MAX_AUDIENCE }, plan }
}

/** Conditional status change; null when the campaign was not in one of `from` (someone was faster). */
async function moveStatus(sb: SupabaseClient, id: string, from: CampaignStatus[], patch: Record<string, unknown>): Promise<CampaignRow | null> {
  const { data, error } = await sb.from('comm_campaigns').update(patch).eq('id', id).in('status', from).select(CAMPAIGN_COLUMNS)
  if (error) throw dbError('update campaign', error)
  return ((data ?? []) as CampaignRow[])[0] ?? null
}

/**
 * draft → running: recipients written, the engine woken. The audience is
 * expanded with `actor`'s client scope. Throws CommError('invalid') for an
 * empty / too large audience and ('conflict' as invalid) when not a draft.
 */
export async function startCampaign(
  sb: SupabaseClient,
  actor: ScopedActor,
  campaign: CampaignRow,
  deps: { transports?: CommTransports; now?: Date; emit?: (id: string) => Promise<boolean> } = {},
): Promise<{ campaign: CampaignRow; engine: boolean }> {
  if (campaign.status !== 'draft') throw new CommError('Запустить можно только черновик', 'invalid')
  if (!('kind' in campaign.audience)) throw new CommError('У рассылки не задана аудитория', 'invalid')
  const now = deps.now ?? new Date()
  const { preview, plan } = await previewAudience(sb, actor, campaign.audience as Audience, campaign.channels, deps.transports)
  if (preview.truncated) throw new CommError(`Получателей больше ${MAX_AUDIENCE} — сузьте фильтры`, 'invalid')
  if (!plan.rows.length) throw new CommError('Нет получателей: никто не подходит под условия', 'invalid')

  // The lock: only one «Запустить» writes the recipients.
  const locked = await moveStatus(sb, campaign.id, ['draft'], { status: 'scheduled' })
  if (!locked) throw new CommError('Рассылку уже запускают', 'invalid')

  try {
    // scheduled_for orders the queue (index of 120): users in audience order, one user's channels together.
    const order = new Map<string, number>()
    for (const r of plan.rows) if (!order.has(r.user_id)) order.set(r.user_id, order.size)
    const rows = plan.rows.map((r) => ({
      campaign_id: campaign.id,
      user_id: r.user_id,
      channel: r.channel,
      status: r.status,
      error: r.error,
      scheduled_for: new Date(now.getTime() + order.get(r.user_id)! * 1000).toISOString(),
    }))
    for (let i = 0; i < rows.length; i += INSERT_BATCH) {
      const { error } = await sb
        .from('comm_campaign_recipients')
        .upsert(rows.slice(i, i + INSERT_BATCH), { onConflict: 'campaign_id,user_id,channel', ignoreDuplicates: true })
      if (error) throw dbError('write recipients', error)
    }
  } catch (err) {
    await moveStatus(sb, campaign.id, ['scheduled'], { status: 'draft' }).catch(() => null)
    throw err
  }

  const skipped = plan.rows.filter((r) => r.status === 'skipped').length
  const running = await moveStatus(sb, campaign.id, ['scheduled'], {
    status: 'running',
    started_at: now.toISOString(),
    total_count: plan.rows.length,
    skipped_count: skipped,
    sent_count: 0,
    failed_count: 0,
  })
  if (!running) throw new CommError('Статус рассылки изменился во время запуска', 'invalid')
  const engine = await (deps.emit ?? emitCampaignRun)(campaign.id)
  return { campaign: running, engine }
}

export type CampaignAction = 'pause' | 'resume' | 'cancel'

const TRANSITIONS: Record<CampaignAction, { from: CampaignStatus[]; to: CampaignStatus }> = {
  pause: { from: ['running'], to: 'paused' },
  resume: { from: ['paused'], to: 'running' },
  cancel: { from: ['draft', 'running', 'paused'], to: 'cancelled' },
}

/** Pause / continue / cancel. Null — not allowed from the current status. */
export async function changeCampaignStatus(
  sb: SupabaseClient,
  campaign: CampaignRow,
  action: CampaignAction,
  deps: { now?: Date; emit?: (id: string) => Promise<boolean> } = {},
): Promise<CampaignRow | null> {
  const t = TRANSITIONS[action]
  if (!t.from.includes(campaign.status)) return null
  const now = deps.now ?? new Date()
  const patch: Record<string, unknown> = { status: t.to }
  if (t.to === 'cancelled') patch.finished_at = now.toISOString()
  const row = await moveStatus(sb, campaign.id, t.from, patch)
  if (!row) return null
  if (action === 'cancel') {
    // Nothing more will be sent; the rows say so. One statement over the queue index.
    const { error } = await sb.from('comm_campaign_recipients').update({ status: 'cancelled' }).eq('campaign_id', campaign.id).eq('status', 'pending')
    if (error) console.error('[comm/campaigns] cancel recipients failed', error.message?.slice(0, 120))
  }
  if (action === 'resume') await (deps.emit ?? emitCampaignRun)(campaign.id)
  return row
}

// ─── Engine step ────────────────────────────────────────────────────────────

export type TickResult =
  | { action: 'stop'; reason: 'not_found' | 'not_running' }
  | { action: 'wait'; until: string }
  | { action: 'sent'; userId: string; pauseMs: number; sent: number; failed: number; skipped: number }
  | { action: 'idle' }
  | { action: 'done' }

export interface TickDeps {
  sb?: SupabaseClient
  transports?: CommTransports
  now?: Date
  schedule?: SendSchedule
  rng?: () => number
}

type Outcome = { status: 'sent' | 'failed' | 'skipped'; error: string | null; messageId: string | null }

/** One recipient of a running campaign (see the header). Short queries only. */
export async function campaignTick(campaignId: string, deps: TickDeps = {}): Promise<TickResult> {
  const sb = deps.sb ?? createServiceClient()
  const now = deps.now ?? new Date()
  const campaign = await loadCampaign(sb, campaignId)
  if (!campaign) return { action: 'stop', reason: 'not_found' }
  if (campaign.status !== 'running') return { action: 'stop', reason: 'not_running' }

  const schedule = deps.schedule ?? (await loadSendSchedule())
  if (!isWithinWindow(now, schedule.window)) return { action: 'wait', until: nextWindowStart(now, schedule.window).toISOString() }

  const { data: next, error: nextErr } = await sb
    .from('comm_campaign_recipients')
    .select('user_id')
    .eq('campaign_id', campaignId)
    .eq('status', 'pending')
    .order('scheduled_for', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (nextErr) throw dbError('next recipient', nextErr)
  if (!next) {
    if (await finishCampaign(sb, campaignId, now)) return { action: 'done' }
    // Rows of a crashed step are still fresh: look again when they count as interrupted.
    return { action: 'wait', until: new Date(now.getTime() + STUCK_SENDING_MS + 5_000).toISOString() }
  }
  const userId = (next as { user_id: string }).user_id

  const { data: claimed, error: claimErr } = await sb
    .from('comm_campaign_recipients')
    .update({ status: 'sending', attempts: 1 })
    .eq('campaign_id', campaignId)
    .eq('user_id', userId)
    .eq('status', 'pending')
    .select('id, channel')
  if (claimErr) throw dbError('claim recipient', claimErr)
  const rows = (claimed ?? []) as Array<{ id: string; channel: CommChannel }>
  if (!rows.length) return { action: 'idle' }

  const outcomes = new Map<string, Outcome>()
  try {
    const result = await sendToUser({
      userId,
      channels: rows.map((r) => r.channel),
      body: campaign.body,
      subject: campaign.subject || campaign.title,
      authorKind: 'system',
      campaignId,
      appTitle: campaign.title,
    }, { sb, transports: deps.transports, now })
    for (const r of rows) {
      const m = result.messages.find((x) => x.channel === r.channel)
      const status: Outcome['status'] = !m ? 'failed'
        : m.status === 'skipped' ? 'skipped'
          : m.status === 'failed' ? 'failed' : 'sent'
      outcomes.set(r.id, { status, error: m ? m.error : 'no_message', messageId: m?.id ?? null })
    }
  } catch (err) {
    const blocked = err instanceof CommError && err.code === 'blocked'
    const missing = err instanceof CommError && err.code === 'not_found'
    const error = blocked ? 'blocked' : missing ? 'user_not_found' : `error: ${err instanceof Error ? err.message.slice(0, 200) : 'unknown'}`
    for (const r of rows) outcomes.set(r.id, { status: blocked || missing ? 'skipped' : 'failed', error, messageId: null })
  }

  await Promise.all(rows.map(async (r) => {
    const o = outcomes.get(r.id)!
    const { error } = await sb
      .from('comm_campaign_recipients')
      .update({ status: o.status, error: o.status === 'sent' ? null : o.error?.slice(0, 500) ?? null, message_id: o.messageId })
      .eq('id', r.id)
    if (error) console.error('[comm/campaigns] recipient update failed', error.message?.slice(0, 120))
  }))

  const count = (s: Outcome['status']) => Array.from(outcomes.values()).filter((o) => o.status === s).length
  const sent = count('sent')
  const failed = count('failed')
  const skipped = count('skipped')
  // One runner per campaign (Inngest concurrency key), so read-then-add is safe; finish recounts anyway.
  const { error: cntErr } = await sb.from('comm_campaigns').update({
    sent_count: campaign.sent_count + sent,
    failed_count: campaign.failed_count + failed,
    skipped_count: campaign.skipped_count + skipped,
  }).eq('id', campaignId)
  if (cntErr) console.error('[comm/campaigns] counters update failed', cntErr.message?.slice(0, 120))

  return { action: 'sent', userId, sent, failed, skipped, pauseMs: sendPauseMs(schedule.intervalSeconds, schedule.jitterSeconds, deps.rng) }
}

async function countRecipients(sb: SupabaseClient, campaignId: string, status: RecipientStatus | null, channel?: CommChannel): Promise<number> {
  let q = sb.from('comm_campaign_recipients').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId)
  if (status) q = q.eq('status', status)
  if (channel) q = q.eq('channel', channel)
  const { count, error } = await q
  if (error) throw dbError('count recipients', error)
  return count ?? 0
}

/**
 * No pending rows left: orphans of a crashed step → failed «interrupted»,
 * exact counters, done. False while a recently claimed row is still `sending`.
 */
export async function finishCampaign(sb: SupabaseClient, campaignId: string, now: Date): Promise<boolean> {
  const { error } = await sb
    .from('comm_campaign_recipients')
    .update({ status: 'failed', error: 'interrupted' })
    .eq('campaign_id', campaignId)
    .eq('status', 'sending')
    .lt('updated_at', new Date(now.getTime() - STUCK_SENDING_MS).toISOString())
  if (error) console.error('[comm/campaigns] interrupted rows update failed', error.message?.slice(0, 120))
  // A row claimed less than STUCK_SENDING_MS ago is still being sent by a live step: not done yet.
  if ((await countRecipients(sb, campaignId, 'sending')) > 0) return false
  const [total, sent, failed, skipped] = await Promise.all([
    countRecipients(sb, campaignId, null),
    countRecipients(sb, campaignId, 'sent'),
    countRecipients(sb, campaignId, 'failed'),
    countRecipients(sb, campaignId, 'skipped'),
  ])
  await moveStatus(sb, campaignId, ['running'], {
    status: 'done', finished_at: now.toISOString(),
    total_count: total, sent_count: sent, failed_count: failed, skipped_count: skipped,
  })
  return true
}

// ─── Card ───────────────────────────────────────────────────────────────────

export interface ChannelProgress {
  channel: CommChannel
  total: number
  sent: number
  failed: number
  skipped: number
  /** pending + sending (or cancelled after «Отменить»). */
  left: number
}

/** Per-channel numbers of the card: ≤ 4 head counts per channel on the queue index. */
export async function channelProgress(sb: SupabaseClient, campaign: Pick<CampaignRow, 'id' | 'channels' | 'status'>): Promise<ChannelProgress[]> {
  if (campaign.status === 'draft') return []
  return Promise.all(campaign.channels.map(async (channel) => {
    const [total, sent, failed, skipped] = await Promise.all([
      countRecipients(sb, campaign.id, null, channel),
      countRecipients(sb, campaign.id, 'sent', channel),
      countRecipients(sb, campaign.id, 'failed', channel),
      countRecipients(sb, campaign.id, 'skipped', channel),
    ])
    return { channel, total, sent, failed, skipped, left: Math.max(0, total - sent - failed - skipped) }
  }))
}

/**
 * Running campaigns the engine has not touched for `staleMinutes` (a lost
 * event or a dead run) — the watchdog re-emits them. Small, on the status index.
 */
export async function staleRunningCampaigns(sb: SupabaseClient, now: Date, staleMinutes = 10, limit = 20): Promise<string[]> {
  const { data, error } = await sb
    .from('comm_campaigns')
    .select('id')
    .eq('status', 'running')
    .lt('updated_at', new Date(now.getTime() - staleMinutes * 60_000).toISOString())
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw dbError('stale campaigns', error)
  return ((data ?? []) as Array<{ id: string }>).map((r) => r.id)
}
