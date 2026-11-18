/**
 * lib/crm/sync.ts — one sync of one CRM connection (Bitrix24 / amoCRM → crm_clients). The single
 * core of the «Синхронизировать» button (app/api/v1/crm/connections/[id]/sync) and of the automatic
 * sync (app/api/cron/crm-sync, lib/crm/sync-cron.ts).
 *
 *   1. read contacts and deals (lib/crm/provider-client.ts): every page up to CRM_SYNC_MAX_RECORDS
 *      each, within the first ~55 % of the time budget;
 *   2. load the clients already linked to these contacts and those with their phones, plan the
 *      writes (lib/crm/provider-sync.ts — no duplicates, link by phone, never overwrite);
 *   3. write in bulk, CRM_SYNC_CHUNK rows per request: new clients as an upsert on
 *      (user_id, external_source, external_id) that ignores a row another run already wrote,
 *      changed clients as an upsert on id. A chunk the database refuses is retried row by row;
 *   4. record the outcome on the connection: last_sync_status 'success' | 'partial' | 'error'
 *      (lib/crm/sync-status.ts) and, unless it is a success, why — in last_sync_error.
 *
 * Partial (M9): no chunk starts when less than MIN_CHUNK_MS + FINAL_RESERVE_MS remain; what is left
 * is counted and reported, and the next run (button or cron) writes it — every step is idempotent.
 * The status is always written, so a run never leaves the previous one's status behind.
 *
 * `sb` is either the user's client (RLS scopes everything to the owner) or the service client of the
 * cron: every query is scoped by conn.user_id explicitly as well. Nothing is ever deleted; linked
 * clients the CRM no longer has are counted (only when every contact was read).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchProviderSnapshot, type ProviderSnapshot } from '@/lib/crm/provider-client'
import {
  contactDraft,
  LOCAL_CLIENT_COLUMNS,
  planClientWrites,
  summariseDeals,
  type ClientRow,
  type DealSummary,
  type LocalClient,
} from '@/lib/crm/provider-sync'
import type { CrmSyncStatus } from '@/lib/crm/sync-status'
import type { ProviderList } from '@/lib/crm/sync-types'
import { openCrmToken } from '@/lib/crm/token-store'
import type { Resolver } from '@/lib/crm/endpoint-guard'
import type { CrmProvider } from '@/lib/crm/types'

/** Contacts and deals read per run, each (Bitrix24: 40 pages of 50; amoCRM: 8 pages of 250). */
export const CRM_SYNC_MAX_RECORDS = 2000
/** Rows per write request. */
export const CRM_SYNC_CHUNK = 200
/** Kept free at the end of the budget for the status write. */
const FINAL_RESERVE_MS = 2_000
/** A write request is not started with less time than this left (before the reserve). */
const MIN_CHUNK_MS = 1_500
/** Shares of the budget: no new CRM page after FETCH_SHARE, every CRM request aborted at ABORT_SHARE. */
const FETCH_SHARE = 0.55
const ABORT_SHARE = 0.7
const ERROR_MAX = 500

export interface SyncConnection {
  id: string
  user_id: string
  provider: CrmProvider
  base_url: string
  access_token: string
}

export interface ListReport {
  loaded: number
  /** What the CRM reports (Bitrix24); null when it does not say (amoCRM). */
  total: number | null
  complete: boolean
}

export interface CrmSyncReport {
  status: CrmSyncStatus
  /** Everything in one paragraph, for the toast and the API answer. */
  message: string
  /** Why the run is not a success (empty for a success) — stored in last_sync_error. */
  problems: string[]
  contacts: ListReport | null
  deals: ListReport | null
  inserted: number
  updated: number
  /** Existing clients linked to their CRM contact by phone in this run. */
  linked: number
  unchanged: number
  mergedByPhone: number
  phoneConflicts: number
  dealsWithoutContact: number
  dealsOtherCurrency: number
  dealsUnknownContact: number
  /** Linked clients the CRM no longer has (kept in the portal); null when not every contact was read. */
  missingInCrm: number | null
  /** Rows left for the next run because the time ran out. */
  notWritten: number
  /** Rows the database refused. */
  failed: number
}

export interface SyncOptions {
  /** Absolute end of this run (ms since epoch); the status is written before it. */
  deadlineAt: number
  now?: () => number
  /** DNS for the SSRF guard (tests). */
  resolve?: Resolver
  maxRecords?: number
}

class SyncDbError extends Error {
  constructor(readonly step: string, readonly pg: { code?: string; message?: string } | null) {
    super(`db: ${step}`)
  }
}

const emptyReport = (status: CrmSyncStatus, message: string): CrmSyncReport => ({
  status,
  message,
  problems: status === 'success' ? [] : [message],
  contacts: null,
  deals: null,
  inserted: 0,
  updated: 0,
  linked: 0,
  unchanged: 0,
  mergedByPhone: 0,
  phoneConflicts: 0,
  dealsWithoutContact: 0,
  dealsOtherCurrency: 0,
  dealsUnknownContact: 0,
  missingInCrm: null,
  notWritten: 0,
  failed: 0,
})

/** A user-facing message for an error before any write. */
function failureMessage(e: unknown): string {
  if (e instanceof SyncDbError) {
    const sig = `${e.pg?.code ?? ''} ${e.pg?.message ?? ''}`
    if (/42703|external_source|external_id/.test(sig)) {
      return 'Синхронизация недоступна: в базе нет полей связи с CRM (миграция 155 не применена)'
    }
    return 'Ошибка базы данных при синхронизации — попробуйте позже'
  }
  const msg = e instanceof Error ? e.message : String(e)
  return (msg || 'Не удалось синхронизировать CRM').slice(0, 300)
}

function listReport<T>(list: ProviderList<T>): ListReport {
  return { loaded: list.items.length, total: list.total, complete: list.complete }
}

const ofTotal = (list: ProviderList<unknown>): string =>
  list.total !== null && list.total > list.items.length ? ` из ${list.total}` : ', есть ещё'

function stopReason(list: ProviderList<unknown>, cap: number): string {
  if (list.stoppedBy === 'cap') return `предел ${cap} за одну синхронизацию`
  if (list.stoppedBy === 'time') return 'не хватило времени, остальное загрузит следующая синхронизация'
  return `CRM прервала загрузку: ${list.error ?? 'ошибка'}`
}

async function selectChunks<T>(
  keys: string[],
  query: (chunk: string[]) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>,
  step: string,
): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < keys.length; i += CRM_SYNC_CHUNK) {
    const { data, error } = await query(keys.slice(i, i + CRM_SYNC_CHUNK))
    if (error) throw new SyncDbError(step, error)
    out.push(...((data ?? []) as T[]))
  }
  return out
}

interface WriteTally {
  written: number
  /** Inserts skipped because another run had already written the same contact. */
  alreadyThere: number
  notWritten: number
  failed: number
  okIds: Set<string>
}

/**
 * Writes `rows` in chunks; a refused chunk is retried row by row. Stops starting requests when the
 * time is up (the rest is `notWritten`).
 */
async function writeRows(
  rows: ClientRow[],
  send: (chunk: ClientRow[]) => PromiseLike<{ data: unknown; error: unknown }>,
  timeLeft: () => number,
): Promise<WriteTally> {
  const t: WriteTally = { written: 0, alreadyThere: 0, notWritten: 0, failed: 0, okIds: new Set() }
  const enough = () => timeLeft() >= MIN_CHUNK_MS
  const account = (chunk: ClientRow[], data: unknown) => {
    const back = Array.isArray(data) ? (data as Array<{ id?: string }>) : []
    t.written += back.length
    t.alreadyThere += Math.max(0, chunk.length - back.length)
    for (const r of back) if (r?.id) t.okIds.add(r.id)
  }
  for (let i = 0; i < rows.length; i += CRM_SYNC_CHUNK) {
    const chunk = rows.slice(i, i + CRM_SYNC_CHUNK)
    if (!enough()) { t.notWritten += rows.length - i; break }
    const { data, error } = await send(chunk)
    if (!error) { account(chunk, data); continue }
    console.warn(`[crm/sync] chunk of ${chunk.length} refused, retrying row by row: ${(error as { code?: string }).code ?? ''}`)
    for (let j = 0; j < chunk.length; j++) {
      if (!enough()) { t.notWritten += chunk.length - j + (rows.length - i - chunk.length); return t }
      const one = await send([chunk[j]])
      if (one.error) t.failed++
      else account([chunk[j]], one.data)
    }
  }
  return t
}

/** One sync of `conn`. Never throws: a failure is a report with status 'error', also stored on the connection. */
export async function syncCrmConnection(sb: SupabaseClient, conn: SyncConnection, opts: SyncOptions): Promise<CrmSyncReport> {
  const now = opts.now ?? Date.now
  const start = now()
  const budget = Math.max(0, opts.deadlineAt - start)
  const cap = opts.maxRecords ?? CRM_SYNC_MAX_RECORDS
  const timeLeft = () => opts.deadlineAt - FINAL_RESERVE_MS - now()

  let report: CrmSyncReport
  let snapshot: ProviderSnapshot | null = null
  try {
    let token: string
    try {
      token = openCrmToken(conn.access_token)
    } catch {
      throw new Error('Не удалось расшифровать ключ CRM — подключите CRM заново')
    }
    snapshot = await fetchProviderSnapshot(conn.provider, conn.base_url, token, {
      maxRecords: cap,
      fetchUntil: start + budget * FETCH_SHARE,
      abortAt: start + budget * ABORT_SHARE,
      now,
      resolve: opts.resolve,
    })
    report = await writeSnapshot(sb, conn, snapshot, cap, now, timeLeft)
  } catch (e) {
    report = emptyReport('error', failureMessage(e))
    if (snapshot) {
      report.contacts = listReport(snapshot.contacts)
      report.deals = snapshot.deals ? listReport(snapshot.deals) : null
    }
    if (e instanceof SyncDbError) console.error(`[crm/sync] ${e.step}: ${e.pg?.code ?? ''} ${e.pg?.message ?? ''}`)
  }

  const patch: Record<string, unknown> = {
    last_sync_at: new Date(now()).toISOString(),
    last_sync_status: report.status,
    last_sync_error: report.status === 'success' ? null : report.problems.join(' ').slice(0, ERROR_MAX),
  }
  // The counts say what the last run that wrote anything read; an error keeps the previous ones.
  if (report.status !== 'error' && report.contacts) patch.synced_contacts = report.contacts.loaded
  if (report.status !== 'error' && report.deals) patch.synced_deals = report.deals.loaded
  const { error } = await sb.from('crm_provider_connections').update(patch).eq('id', conn.id).eq('user_id', conn.user_id)
  if (error) console.error(`[crm/sync] status of ${conn.id} not recorded: ${error.code ?? ''} ${error.message ?? ''}`)
  return report
}

async function writeSnapshot(
  sb: SupabaseClient,
  conn: SyncConnection,
  snap: ProviderSnapshot,
  cap: number,
  now: () => number,
  timeLeft: () => number,
): Promise<CrmSyncReport> {
  const userId = conn.user_id
  const src = snap.externalSource
  const drafts = snap.contacts.items.map(contactDraft)
  const ids = drafts.map((d) => d.externalId)
  const contactIds = new Set(ids)
  const deals: DealSummary | null = snap.deals ? summariseDeals(snap.deals.items, contactIds) : null

  const linkedRows = await selectChunks<LocalClient>(
    ids,
    (chunk) => sb.from('crm_clients').select(LOCAL_CLIENT_COLUMNS).eq('user_id', userId).eq('external_source', src).in('external_id', chunk),
    'linked clients',
  )
  const linked = new Map(linkedRows.map((r) => [r.external_id as string, r]))
  const phones = Array.from(new Set(drafts.filter((d) => d.phone && !linked.has(d.externalId)).map((d) => d.phone as string)))
  const phoneRows = await selectChunks<LocalClient>(
    phones,
    (chunk) => sb.from('crm_clients').select(LOCAL_CLIENT_COLUMNS).eq('user_id', userId).in('phone', chunk),
    'clients by phone',
  )
  const byPhone = new Map(phoneRows.filter((r) => r.phone).map((r) => [r.phone as string, r]))

  const plan = planClientWrites({
    userId,
    provider: conn.provider,
    externalSource: src,
    drafts,
    amounts: deals ? deals.amounts : null,
    linked,
    byPhone,
    nowIso: new Date(now()).toISOString(),
  })

  const upd = await writeRows(
    plan.updates,
    (chunk) => sb.from('crm_clients').upsert(chunk, { onConflict: 'id' }).select('id'),
    timeLeft,
  )
  const ins = await writeRows(
    plan.inserts,
    (chunk) => sb.from('crm_clients').upsert(chunk, { onConflict: 'user_id,external_source,external_id', ignoreDuplicates: true }).select('id'),
    timeLeft,
  )
  const linkedOk = Array.from(plan.linkIds).filter((id) => upd.okIds.has(id)).length

  // Linked clients the CRM no longer has: only meaningful when every contact was read.
  let missingInCrm: number | null = null
  if (snap.contacts.complete) {
    const { count, error } = await sb
      .from('crm_clients')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('external_source', src)
    if (!error && typeof count === 'number') {
      const present = linked.size + linkedOk + ins.written + ins.alreadyThere
      missingInCrm = Math.max(0, count - present)
    }
  }

  const problems: string[] = []
  const c = snap.contacts
  if (!c.complete) problems.push(`Контакты загружены не все: ${c.items.length}${ofTotal(c)} — ${stopReason(c, cap)}.`)
  if (!snap.deals) problems.push(`Сделки не загружены (${snap.dealsError ?? 'ошибка CRM'}) — средний чек не обновлялся.`)
  else if (!snap.deals.complete) {
    problems.push(
      `Сделки загружены не все: ${snap.deals.items.length}${ofTotal(snap.deals)} — ${stopReason(snap.deals, cap)}; ` +
        `средний чек посчитан по последним ${snap.deals.items.length} сделкам.`,
    )
  }
  const notWritten = upd.notWritten + ins.notWritten
  const failed = upd.failed + ins.failed
  if (notWritten > 0) problems.push(`Не успели записать клиентов: ${notWritten} — запишет следующая синхронизация.`)
  if (failed > 0) problems.push(`База не приняла клиентов: ${failed}.`)

  const notes: string[] = []
  notes.push(
    `Контактов: ${c.items.length}, сделок: ${snap.deals ? snap.deals.items.length : '—'}. ` +
      `Новых клиентов: ${ins.written}, обновлено: ${upd.written - linkedOk}, связано по телефону: ${linkedOk}, без изменений: ${plan.unchanged}.`,
  )
  if (deals && deals.withoutContact > 0) notes.push(`Сделок без контакта: ${deals.withoutContact} — клиентами не стали.`)
  if (deals && deals.otherCurrency > 0) notes.push(`Сделок не в тенге: ${deals.otherCurrency} — в средний чек не вошли.`)
  if (deals && deals.unknownContact > 0) notes.push(`Сделок с незагруженным контактом: ${deals.unknownContact}.`)
  if (plan.mergedByPhone > 0) notes.push(`Контактов с одним телефоном объединено: ${plan.mergedByPhone}.`)
  if (plan.phoneConflicts > 0) notes.push(`Не добавлено контактов: ${plan.phoneConflicts} — их телефон уже у другого клиента.`)
  if (missingInCrm) notes.push(`Нет больше в CRM: ${missingInCrm} — в портале клиенты оставлены.`)

  return {
    status: problems.length > 0 ? 'partial' : 'success',
    message: [...problems, ...notes].join(' '),
    problems,
    contacts: listReport(c),
    deals: snap.deals ? listReport(snap.deals) : null,
    inserted: ins.written,
    updated: upd.written - linkedOk,
    linked: linkedOk,
    unchanged: plan.unchanged + ins.alreadyThere,
    mergedByPhone: plan.mergedByPhone,
    phoneConflicts: plan.phoneConflicts,
    dealsWithoutContact: deals?.withoutContact ?? 0,
    dealsOtherCurrency: deals?.otherCurrency ?? 0,
    dealsUnknownContact: deals?.unknownContact ?? 0,
    missingInCrm,
    notWritten,
    failed,
  }
}
