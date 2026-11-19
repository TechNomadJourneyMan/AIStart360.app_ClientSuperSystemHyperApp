/**
 * lib/crm/today.ts — the «Кому звонить сегодня» queue of the owner CRM, one implementation for every
 * reader: GET /api/v1/crm/today (the screen), POST /api/pulse/briefing (the AI briefing over the same
 * queue) and the morning digest (app/api/cron/crm-digest, the same buckets counted per owner).
 *
 * Everything here is read from the owner's own rows (crm_clients, open crm_reminders). Nothing is
 * invented: an unknown average check stays null, a client never contacted has no «days since»,
 * and the money at risk is a number only when every high-risk client's check is known.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { scoreClientRisk, type ChurnLevel, type RiskAction } from './risk'

export const DAY_MS = 86_400_000

/**
 * The CRM's working day is the Almaty calendar day: Asia/Almaty is UTC+5 all year (no DST; one
 * Kazakhstan zone since 2024-03-01). A fixed offset, so «today» does not depend on the server's
 * time zone or its tz database.
 */
export const ALMATY_UTC_OFFSET_MS = 5 * 3_600_000

export interface CrmDay {
  /** Almaty midnight that starts the day, epoch ms. */
  startMs: number
  /** The next Almaty midnight, epoch ms (exclusive). */
  endMs: number
  /** YYYY-MM-DD of the Almaty day. */
  day: string
}

export function almatyDay(nowMs: number): CrmDay {
  const localMs = nowMs + ALMATY_UTC_OFFSET_MS
  const localStart = Math.floor(localMs / DAY_MS) * DAY_MS
  const startMs = localStart - ALMATY_UTC_OFFSET_MS
  return { startMs, endMs: startMs + DAY_MS, day: new Date(localStart).toISOString().slice(0, 10) }
}

export const ACTIVE_STATUSES: readonly string[] = ['new', 'in_progress', 'waiting']
/** A lost client is never in the queue and never overdue, whatever is still planned for it. */
export const LOST_STATUS = 'lost'
export const SLEEPING_STATUSES: readonly string[] = ['customer', 'sleeping']
/** A customer / sleeping client with no touch for MORE than this many days is «спящий». */
export const SLEEPING_DAYS = 30

/** Queue buckets, highest priority first; the number is the API's `queueBucket`. */
export const QUEUE_BUCKET = { overdue: 0, today: 1, noPlan: 2, sleeping: 3 } as const
export type QueueBucket = (typeof QUEUE_BUCKET)[keyof typeof QUEUE_BUCKET]

export const STATUS_LABELS: Record<string, string> = {
  new: 'Новый',
  in_progress: 'В работе',
  waiting: 'Ожидание',
  customer: 'Клиент',
  sleeping: 'Спящий',
  lost: 'Потерян',
}

/** The columns the queue needs (crm_clients). */
export interface QueueClientInput {
  status: string
  next_contact_at: string | null
  last_contact_at: string | null
  created_at: string | null
}

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? null : t
}

/** customer / sleeping and no touch for more than SLEEPING_DAYS (since creation when never touched). */
export function isSleepingClient(c: QueueClientInput, nowMs: number): boolean {
  if (!SLEEPING_STATUSES.includes(c.status)) return false
  const ref = ms(c.last_contact_at) ?? ms(c.created_at)
  return ref != null && nowMs - ref > SLEEPING_DAYS * DAY_MS
}

/**
 * The queue rule — which bucket of today's queue a client is in, or null when not in it.
 * `last_contact_at` is the last CONTACT (a call, message or meeting — a note is not a contact,
 * app/api/v1/crm/clients/[id]/interactions).
 *
 *  0. A LOST client is never in the queue — not «просрочено», not «на сегодня» — whatever is still
 *     planned for it (the plans stay stored; the risk list still shows it). Every reader of
 *     «overdue» goes through this rule: the screen, next-best-action and the digest.
 *
 *  1. Pending plan items: every open reminder and next_contact_at whose time is AFTER the last
 *     contact (or with no contact at all). A contact at or after the planned time answers it.
 *     Logging a contact also FULFILS every plan due before the end of today that exists at that
 *     moment (the interactions route closes those reminders and clears that next_contact_at), so a
 *     plan for later today that is still here was made AFTER the contact — a call-back.
 *       any pending item before today       → 0 «просрочено»
 *       any pending item today              → 1 «на сегодня» — also a call-back planned for later
 *                                              today after this morning's call
 *       pending items only after today      → not in the queue: the contact is planned.
 *  2. No pending plan:
 *       contacted today (at or after Almaty midnight)        → not in the queue: handled today
 *       an active status (new / in_progress / waiting)        → 2 «без плана»
 *       customer / sleeping with no contact for > 30 days     → 3 «спящий»
 *     Anything else (a recent customer) is not in the queue.
 */
export function queueBucket(
  c: QueueClientInput,
  openReminderDues: readonly number[],
  day: CrmDay,
  nowMs: number,
): QueueBucket | null {
  if (c.status === LOST_STATUS) return null
  const last = ms(c.last_contact_at)
  const answered = (t: number) => last != null && last >= t

  const pending: number[] = openReminderDues.filter((t) => Number.isFinite(t) && !answered(t))
  const next = ms(c.next_contact_at)
  if (next != null && !answered(next)) pending.push(next)

  if (pending.some((t) => t < day.startMs)) return QUEUE_BUCKET.overdue
  if (pending.some((t) => t < day.endMs)) return QUEUE_BUCKET.today
  if (pending.length > 0) return null

  if (last != null && last >= day.startMs) return null
  if (ACTIVE_STATUSES.includes(c.status)) return QUEUE_BUCKET.noPlan
  if (isSleepingClient(c, nowMs)) return QUEUE_BUCKET.sleeping
  return null
}

/** Open reminders grouped by client: client_id → due times (epoch ms). */
export function openDuesByClient(reminders: ReadonlyArray<{ client_id: string; due_at: string }>): Map<string, number[]> {
  const out = new Map<string, number[]>()
  for (const r of reminders) {
    const t = ms(r.due_at)
    if (t == null || typeof r.client_id !== 'string') continue
    const list = out.get(r.client_id)
    if (list) list.push(t)
    else out.set(r.client_id, [t])
  }
  return out
}

// ─── The screen payload ─────────────────────────────────────────────────────

export interface CrmClientRow extends QueueClientInput {
  id: string
  name: string
  phone: string | null
  phone_raw: string | null
  email: string | null
  avg_check: number | string | null
  note: string | null
}

export interface TodayClient {
  id: string
  name: string
  status: string
  statusLabel: string
  phone: string | null
  phoneRaw: string | null
  email: string | null
  /** The owner's note, cut to NOTE_PREVIEW_MAX characters (the full note is in the base). */
  note: string | null
  /** `note` was cut — the drawer must not save it back (lib/crm/client-form.ts). */
  noteTruncated: boolean
  nextContactAt: string | null
  lastContactAt: string | null
  /** Whole days since the last touch; null = never touched («нет касаний»). */
  daysSince: number | null
  /** The client's average check as entered; null = not entered. */
  avgCheck: number | null
  /** % of this check against the base's average check; null when either is unknown. */
  checkVsAvgPct: number | null
  riskScore: number
  churnLevel: ChurnLevel
  action: RiskAction
  comment: string | null
  queueBucket: QueueBucket | null
}

export interface TodayStats {
  totalClients: number
  highRisk: number
  mediumRisk: number
  /**
   * Σ avg_check of the high-risk clients — a number only when every one of them has a check
   * (0 when there are none); null = «нет данных», never an unknown check counted as 0.
   */
  revenueAtRisk: number | null
  /** High-risk clients without an average check. */
  highRiskWithoutCheck: number
  /** Clients touched today (Almaty day). */
  processedToday: number
  queue: { overdue: number; today: number; noPlan: number; sleeping: number }
}

export interface CrmTodayPayload {
  /** The Almaty day the queue is for. */
  day: string
  stats: TodayStats
  /** Today's queue, highest priority first — at most TODAY_LIST_MAX of them. */
  todayClients: TodayClient[]
  /** How many clients the whole queue has («показаны N из M»); per bucket: stats.queue. */
  todayClientsTotal: number
  /** The base's high/medium-risk clients, riskiest first (at most RISK_LIST_MAX). */
  riskClients: TodayClient[]
  riskClientsTotal: number
  /** The briefing is generated on demand (POST /api/pulse/briefing); never part of this read. */
  aiBriefing: null
}

/**
 * Rows returned per list. A 2000-row import puts everyone in «Без плана»; the screen shows the
 * first ones in priority order and says how many there are, the base tab has every client.
 */
export const TODAY_LIST_MAX = 50
export const RISK_LIST_MAX = 50
/** A note longer than this is cut in the queue rows (notes may hold up to 10 000 characters). */
export const NOTE_PREVIEW_MAX = 300
/** Comparing a check with «the base's average» needs at least this many known checks (not itself). */
export const MIN_CHECKS_FOR_AVERAGE = 2

function notePreview(note: string | null): { note: string | null; noteTruncated: boolean } {
  if (note == null || note.length <= NOTE_PREVIEW_MAX) return { note, noteTruncated: false }
  return { note: `${note.slice(0, NOTE_PREVIEW_MAX).trimEnd()}…`, noteTruncated: true }
}

function toCheck(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

const byName = (a: TodayClient, b: TodayClient) => a.name.localeCompare(b.name, 'ru') || a.id.localeCompare(b.id)

/**
 * The base's average check over the clients whose check is known and positive. With a single
 * known check there is no average to compare with (the client would be compared with itself:
 * «0 %»), so it counts as unknown (0): no check-vs-average, no check modifier in the risk score.
 */
export function portfolioAverageCheck(clients: ReadonlyArray<{ avg_check: number | string | null }>): number {
  const positive = clients.map((c) => toCheck(c.avg_check)).filter((v): v is number => v != null && v > 0)
  return positive.length >= MIN_CHECKS_FOR_AVERAGE ? positive.reduce((s, v) => s + v, 0) / positive.length : 0
}

/** One client as a row of the screen (risk by lib/crm/risk.ts against the base's average check). */
export function toTodayClient(c: CrmClientRow, portfolioAvg: number, bucket: QueueBucket | null, nowMs: number): TodayClient {
  const avgCheck = toCheck(c.avg_check)
  const risk = scoreClientRisk({ lastContactAt: c.last_contact_at, avgCheck, status: c.status, now: nowMs }, portfolioAvg)
  return {
    id: c.id,
    name: c.name,
    status: c.status,
    statusLabel: STATUS_LABELS[c.status] ?? c.status,
    phone: c.phone,
    phoneRaw: c.phone_raw,
    email: c.email,
    ...notePreview(c.note),
    nextContactAt: c.next_contact_at,
    lastContactAt: c.last_contact_at,
    daysSince: risk.daysSince,
    avgCheck,
    checkVsAvgPct: risk.checkVsAvgPct,
    riskScore: risk.riskScore,
    churnLevel: risk.churnLevel,
    action: risk.action,
    comment: risk.comment,
    queueBucket: bucket,
  }
}

/** The queue, the risk list and the KPI of one owner's base. Pure: same rows + time → same payload. */
export function buildCrmToday(
  clients: readonly CrmClientRow[],
  openReminders: ReadonlyArray<{ client_id: string; due_at: string }>,
  nowMs: number,
): CrmTodayPayload {
  const day = almatyDay(nowMs)
  const dues = openDuesByClient(openReminders)
  const portfolioAvg = portfolioAverageCheck(clients)
  const rows: TodayClient[] = clients.map((c) =>
    toTodayClient(c, portfolioAvg, queueBucket(c, dues.get(c.id) ?? [], day, nowMs), nowMs))

  const high = rows.filter((r) => r.churnLevel === 'high')
  const medium = rows.filter((r) => r.churnLevel === 'medium')
  const highWithoutCheck = high.filter((r) => r.avgCheck == null).length
  const revenueAtRisk = highWithoutCheck > 0 ? null : high.reduce((s, r) => s + (r.avgCheck as number), 0)
  const processedToday = clients.filter((c) => {
    const t = ms(c.last_contact_at)
    return t != null && t >= day.startMs && t < day.endMs
  }).length

  const queued = rows.filter((r) => r.queueBucket != null)
  const count = (b: QueueBucket) => queued.filter((r) => r.queueBucket === b).length
  const todayClients = [...queued].sort(
    (a, b) => (a.queueBucket as number) - (b.queueBucket as number) || b.riskScore - a.riskScore || byName(a, b),
  )
  const atRisk = [...high, ...medium].sort((a, b) => b.riskScore - a.riskScore || byName(a, b))

  return {
    day: day.day,
    stats: {
      totalClients: clients.length,
      highRisk: high.length,
      mediumRisk: medium.length,
      revenueAtRisk,
      highRiskWithoutCheck: highWithoutCheck,
      processedToday,
      queue: {
        overdue: count(QUEUE_BUCKET.overdue),
        today: count(QUEUE_BUCKET.today),
        noPlan: count(QUEUE_BUCKET.noPlan),
        sleeping: count(QUEUE_BUCKET.sleeping),
      },
    },
    todayClients: todayClients.slice(0, TODAY_LIST_MAX),
    todayClientsTotal: todayClients.length,
    riskClients: atRisk.slice(0, RISK_LIST_MAX),
    riskClientsTotal: atRisk.length,
    aiBriefing: null,
  }
}

// ─── Reading every row (no silent 500-row cut) ──────────────────────────────

/** PostgREST's max-rows on Supabase is 1000: never ask for more in one page. */
export const PAGE_SIZE = 1000

type PageResult<T> = { data: T[] | null; error: unknown }

/**
 * Every row of a query, page by page in a stable order (keyset on `id`: rows added or changed
 * while paging are neither skipped nor read twice). `page(afterId)` builds the query of one page,
 * ordered by id ascending, limited to PAGE_SIZE, after `afterId` when given. It reads until an
 * EMPTY page: a short page is not the end when the server's max-rows is below PAGE_SIZE.
 */
export async function readAllById<T extends { id: string }>(
  page: (afterId: string | null) => PromiseLike<PageResult<T>>,
): Promise<{ ok: true; rows: T[] } | { ok: false; error: unknown }> {
  const rows: T[] = []
  let after: string | null = null
  for (;;) {
    const { data, error } = await page(after)
    if (error) return { ok: false, error }
    const got = data ?? []
    if (got.length === 0) return { ok: true, rows }
    rows.push(...got)
    after = got[got.length - 1].id
  }
}

const CLIENT_COLUMNS =
  'id, name, phone, phone_raw, email, status, avg_check, note, next_contact_at, last_contact_at, created_at'

/** Every client of `userId` (own rows only, also for staff who could read more under RLS). */
export function readOwnClients(sb: SupabaseClient, userId: string) {
  return readAllById<CrmClientRow>((after) => {
    let q = sb.from('crm_clients').select(CLIENT_COLUMNS).eq('user_id', userId)
    if (after) q = q.gt('id', after)
    return q.order('id', { ascending: true }).limit(PAGE_SIZE) as unknown as PromiseLike<PageResult<CrmClientRow>>
  })
}

/** Every open reminder of `userId`. */
export function readOwnOpenReminders(sb: SupabaseClient, userId: string) {
  return readAllById<{ id: string; client_id: string; due_at: string }>((after) => {
    let q = sb.from('crm_reminders').select('id, client_id, due_at').eq('user_id', userId).eq('status', 'open')
    if (after) q = q.gt('id', after)
    return q.order('id', { ascending: true }).limit(PAGE_SIZE) as unknown as PromiseLike<
      PageResult<{ id: string; client_id: string; due_at: string }>
    >
  })
}

/**
 * The shared server loader: the owner's whole base + open reminders → the queue payload.
 * A failed read is an error, never an empty or partial queue.
 */
export async function loadCrmToday(
  sb: SupabaseClient,
  userId: string,
  nowMs: number = Date.now(),
): Promise<{ ok: true; data: CrmTodayPayload } | { ok: false; error: 'db_error' }> {
  const clients = await readOwnClients(sb, userId)
  if (!clients.ok) return { ok: false, error: 'db_error' }
  const reminders = await readOwnOpenReminders(sb, userId)
  if (!reminders.ok) return { ok: false, error: 'db_error' }
  return { ok: true, data: buildCrmToday(clients.rows, reminders.rows, nowMs) }
}

/**
 * The clients of `userId` that are OVERDUE in today's queue (bucket 0) — next-best-action's
 * «Связаться с N клиентами». Only the candidates are read (open reminders due before today's Almaty
 * midnight, clients whose next contact is before it); the rule is queueBucket, so the count is the
 * queue's «Просрочено». Overdue first by the earliest missed time, then by name.
 */
export async function readOverdueClients(
  sb: SupabaseClient,
  userId: string,
  nowMs: number = Date.now(),
): Promise<{ ok: true; clients: Array<{ id: string; name: string }> } | { ok: false; error: unknown }> {
  const day = almatyDay(nowMs)
  const startIso = new Date(day.startMs).toISOString()
  const cols = 'id, name, status, next_contact_at, last_contact_at, created_at'
  type Row = QueueClientInput & { id: string; name: string }

  const reminders = await readAllById<{ id: string; client_id: string; due_at: string }>((after) => {
    let q = sb.from('crm_reminders').select('id, client_id, due_at').eq('user_id', userId).eq('status', 'open').lt('due_at', startIso)
    if (after) q = q.gt('id', after)
    return q.order('id', { ascending: true }).limit(PAGE_SIZE) as unknown as PromiseLike<PageResult<{ id: string; client_id: string; due_at: string }>>
  })
  if (!reminders.ok) return reminders
  const planned = await readAllById<Row>((after) => {
    let q = sb.from('crm_clients').select(cols).eq('user_id', userId).lt('next_contact_at', startIso)
    if (after) q = q.gt('id', after)
    return q.order('id', { ascending: true }).limit(PAGE_SIZE) as unknown as PromiseLike<PageResult<Row>>
  })
  if (!planned.ok) return planned

  const byId = new Map(planned.rows.map((c) => [c.id, c]))
  const missing = Array.from(new Set(reminders.rows.map((r) => r.client_id))).filter((id) => !byId.has(id))
  for (let i = 0; i < missing.length; i += 200) {
    const { data, error } = await sb.from('crm_clients').select(cols).eq('user_id', userId).in('id', missing.slice(i, i + 200))
    if (error) return { ok: false, error }
    for (const c of (data ?? []) as Row[]) byId.set(c.id, c)
  }

  const dues = openDuesByClient(reminders.rows)
  const earliest = (c: Row) => {
    const times = [...(dues.get(c.id) ?? [])]
    const next = ms(c.next_contact_at)
    if (next != null) times.push(next)
    return Math.min(...times)
  }
  const overdue = Array.from(byId.values()).filter((c) => queueBucket(c, dues.get(c.id) ?? [], day, nowMs) === QUEUE_BUCKET.overdue)
  overdue.sort((a, b) => earliest(a) - earliest(b) || a.name.localeCompare(b.name, 'ru') || a.id.localeCompare(b.id))
  return { ok: true, clients: overdue.map((c) => ({ id: c.id, name: c.name })) }
}

/**
 * The digest's numbers, per owner: how many of the owner's clients are in the overdue / today /
 * sleeping buckets of the queue — the same rule as the screen (queueBucket), so the morning
 * message and «Кому звонить сегодня» never disagree.
 */
export function queueCountsByUser(
  clients: ReadonlyArray<QueueClientInput & { id: string; user_id: string }>,
  openReminders: ReadonlyArray<{ client_id: string; due_at: string }>,
  nowMs: number,
): Map<string, { overdue: number; dueToday: number; sleeping: number }> {
  const day = almatyDay(nowMs)
  const dues = openDuesByClient(openReminders)
  const out = new Map<string, { overdue: number; dueToday: number; sleeping: number }>()
  for (const c of clients) {
    const b = queueBucket(c, dues.get(c.id) ?? [], day, nowMs)
    if (b == null || b === QUEUE_BUCKET.noPlan) continue
    const row = out.get(c.user_id) ?? { overdue: 0, dueToday: 0, sleeping: 0 }
    if (b === QUEUE_BUCKET.overdue) row.overdue += 1
    else if (b === QUEUE_BUCKET.today) row.dueToday += 1
    else row.sleeping += 1
    out.set(c.user_id, row)
  }
  return out
}
