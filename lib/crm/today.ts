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
 *
 *  1. Touched today (last_contact_at at or after Almaty midnight) → not in today's queue: the owner
 *     has dealt with the client today. (This is what lets the queue empty as the day's work is done.)
 *  2. Pending plan items: every OPEN reminder (an explicit to-do — it stays pending until it is
 *     marked done or dismissed, a touch does not close it) and next_contact_at unless a later touch
 *     already answered it (last_contact_at >= next_contact_at).
 *       any pending item before today       → 0 «просрочено»
 *       any pending item today              → 1 «на сегодня»
 *       pending items only after today      → not in the queue: the contact is planned.
 *  3. No pending plan:
 *       an active status (new / in_progress / waiting)        → 2 «без плана»
 *       customer / sleeping with no touch for > 30 days       → 3 «спящий»
 *     Anything else (a lost client, a recent customer) is not in the queue.
 */
export function queueBucket(
  c: QueueClientInput,
  openReminderDues: readonly number[],
  day: CrmDay,
  nowMs: number,
): QueueBucket | null {
  const last = ms(c.last_contact_at)
  if (last != null && last >= day.startMs) return null

  const pending: number[] = openReminderDues.filter((t) => Number.isFinite(t))
  const next = ms(c.next_contact_at)
  if (next != null && !(last != null && last >= next)) pending.push(next)

  if (pending.some((t) => t < day.startMs)) return QUEUE_BUCKET.overdue
  if (pending.some((t) => t < day.endMs)) return QUEUE_BUCKET.today
  if (pending.length > 0) return null

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
  note: string | null
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
  /** Today's queue, highest priority first. */
  todayClients: TodayClient[]
  /** The base's high/medium-risk clients, riskiest first (at most RISK_LIST_MAX). */
  riskClients: TodayClient[]
  riskClientsTotal: number
  /** The briefing is generated on demand (POST /api/pulse/briefing); never part of this read. */
  aiBriefing: null
}

export const RISK_LIST_MAX = 50

function toCheck(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

const byName = (a: TodayClient, b: TodayClient) => a.name.localeCompare(b.name, 'ru') || a.id.localeCompare(b.id)

/** The queue, the risk list and the KPI of one owner's base. Pure: same rows + time → same payload. */
export function buildCrmToday(
  clients: readonly CrmClientRow[],
  openReminders: ReadonlyArray<{ client_id: string; due_at: string }>,
  nowMs: number,
): CrmTodayPayload {
  const day = almatyDay(nowMs)
  const dues = openDuesByClient(openReminders)

  // The base's average check over the clients whose check is known and positive (as before; the
  // Gri mascot's «в зоне риска» uses the same average — lib/assistant/mascot/problem-signals.ts).
  const checks = clients.map((c) => toCheck(c.avg_check))
  const positive = checks.filter((v): v is number => v != null && v > 0)
  const portfolioAvg = positive.length > 0 ? positive.reduce((s, v) => s + v, 0) / positive.length : 0

  const rows: TodayClient[] = clients.map((c, i) => {
    const avgCheck = checks[i]
    const risk = scoreClientRisk(
      { lastContactAt: c.last_contact_at, avgCheck, status: c.status, now: nowMs },
      portfolioAvg,
    )
    return {
      id: c.id,
      name: c.name,
      status: c.status,
      statusLabel: STATUS_LABELS[c.status] ?? c.status,
      phone: c.phone,
      phoneRaw: c.phone_raw,
      email: c.email,
      note: c.note,
      nextContactAt: c.next_contact_at,
      lastContactAt: c.last_contact_at,
      daysSince: risk.daysSince,
      avgCheck,
      checkVsAvgPct: risk.checkVsAvgPct,
      riskScore: risk.riskScore,
      churnLevel: risk.churnLevel,
      action: risk.action,
      comment: risk.comment,
      queueBucket: queueBucket(c, dues.get(c.id) ?? [], day, nowMs),
    }
  })

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
    todayClients,
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
 * ordered by id ascending, limited to PAGE_SIZE, after `afterId` when given.
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
    rows.push(...got)
    if (got.length < PAGE_SIZE) return { ok: true, rows }
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
