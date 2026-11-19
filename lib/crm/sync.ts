/**
 * lib/crm/sync.ts — one sync run of one CRM connection (Bitrix24 / amoCRM → crm_clients). The single
 * core of the «Синхронизировать» button (app/api/v1/crm/connections/[id]/sync) and of the automatic
 * sync (app/api/cron/crm-sync, lib/crm/sync-cron.ts).
 *
 *   0. take the connection's lease (crm_sync_acquire_lease): one run per connection at a time; a
 *      second one answers «уже идёт» (status 'busy', nothing written);
 *   1. read contacts and deals from where the previous run stopped (lib/crm/sync-cursor.ts), in
 *      ascending id order, up to CRM_SYNC_MAX_RECORDS each, within the first ~55 % of the budget;
 *   2. load the clients linked to these contacts and those holding any of their phones, plan the
 *      writes (lib/crm/provider-sync.ts — no duplicates, link by phone, never overwrite);
 *   3. write set-based, CRM_SYNC_CHUNK rows per call (migration 157): crm_sync_update_clients fills
 *      only fields empty at write time and marks the contacts seen; crm_sync_insert_clients adds new
 *      contacts and skips any row a unique index refuses; the qualifying deals go to crm_sync_deals.
 *      A refused or timed-out call stops the writes: the cursor of that list does not move, so the
 *      next run reads and writes the same part again (every write is idempotent) — no row-by-row retry;
 *   4. a pass that reached the end of the contacts: re-link clients whose contact is gone to the
 *      contact that now has their phone (M5), count the linked clients not seen in the pass (kept,
 *      never deleted); a pass that reached the end of the deals: apply avg_check
 *      (crm_sync_apply_deal_totals: never a figure the owner typed);
 *   5. record the outcome and the new cursor, and release the lease, in one conditional write:
 *      last_sync_status 'success' | 'partial' | 'error' (lib/crm/sync-status.ts) and, unless it is a
 *      success, why — in last_sync_error. A run that could not read or write everything is
 *      'partial' and says where the next one continues; it never leaves the previous status behind.
 *
 * Time: every CRM request, DNS lookup and database call is bounded by the run's deadline; no write
 * starts with less than MIN_CHUNK_MS + FINAL_RESERVE_MS left; the final write has its own short limit.
 * `sb` is either the user's client (RLS scopes everything to the owner) or the service client of the
 * cron: every query and function call is scoped by conn.user_id explicitly as well.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolverWithTimeout, type Resolver } from '@/lib/crm/endpoint-guard'
import { fetchProviderSnapshot, identifyProvider, type ProviderSnapshot } from '@/lib/crm/provider-client'
import {
  classifyDeals,
  contactDraft,
  LOCAL_CLIENT_COLUMNS,
  planClientWrites,
  type ClientWritePlan,
  type LocalClient,
} from '@/lib/crm/provider-sync'
import { addConflicts, readCursor, type SyncCursor } from '@/lib/crm/sync-cursor'
import type { CrmSyncStatus } from '@/lib/crm/sync-status'
import type { ProviderList } from '@/lib/crm/sync-types'
import { openCrmToken } from '@/lib/crm/token-store'
import type { CrmProvider } from '@/lib/crm/types'

/** Contacts and deals read per run, each (Bitrix24: 40 calls of 50; amoCRM: 8 pages of 250). */
export const CRM_SYNC_MAX_RECORDS = 2000
/** Rows per write call. */
export const CRM_SYNC_CHUNK = 200
/** Kept free at the end of the budget for the final write. */
const FINAL_RESERVE_MS = 2_000
/** A write call is not started with less time than this left (before the reserve). */
const MIN_CHUNK_MS = 1_500
/** Shares of the budget: no new CRM page after FETCH_SHARE, every CRM request aborted at ABORT_SHARE. */
const FETCH_SHARE = 0.55
const ABORT_SHARE = 0.7
/** The final write's own limit (it may run after the budget). */
const FINAL_WRITE_MS = 5_000
/** The lease outlives the budget by this much: a crashed run frees its connection after it. */
const LEASE_MARGIN_S = 30
const ERROR_MAX = 500

export interface SyncConnection {
  id: string
  user_id: string
  provider: CrmProvider
  base_url: string
  access_token: string
}

/** 'busy': another run of this connection holds the lease; nothing was read or written. */
export type CrmSyncRunStatus = CrmSyncStatus | 'busy'

export interface PassReport {
  /** Records read in this run. */
  read: number
  /** Records read in the running (or just completed) pass, this run included. */
  passRead: number
  /** The pass total when the CRM reports one (Bitrix24); null otherwise. */
  passTotal: number | null
  /** The pass reached the end of the list in this run. */
  passComplete: boolean
}

export interface CrmSyncReport {
  status: CrmSyncRunStatus
  /** Everything in one paragraph, for the toast and the API answer. */
  message: string
  /** Why the run is not a success (empty for a success) — stored in last_sync_error. */
  problems: string[]
  contacts: PassReport | null
  deals: PassReport | null
  inserted: number
  /** Linked clients that got an empty field filled. */
  updated: number
  /** Existing clients linked to their CRM contact by phone in this run. */
  linked: number
  unchanged: number
  /** Contacts not added because their phone or contact was taken during the run. */
  skippedAtWrite: number
  mergedByPhone: number
  /** Contacts of this run not added: their phone belongs to a client linked to another CRM record. */
  phoneConflicts: number
  /** Clients re-linked to the contact that now has their phone (end of a contacts pass). */
  relinked: number | null
  /** Linked clients the CRM no longer has (kept); null unless a contacts pass completed. */
  missingInCrm: number | null
  /** Of the completed deals pass (null while one runs). */
  dealsWithoutContact: number | null
  dealsOtherCurrency: number | null
  /** avg_check applied at the end of a deals pass: set / cleared (null while one runs). */
  avgUpdated: number | null
  avgCleared: number | null
  /** Rows not written in this run (written by the next one). */
  notWritten: number
}

export interface SyncOptions {
  /** Absolute end of this run (ms since epoch); the final write is made before it. */
  deadlineAt: number
  now?: () => number
  /** DNS for the SSRF guard (tests). */
  resolve?: Resolver
  maxRecords?: number
}

type PgErr = { code?: string; message?: string } | null

class SyncDbError extends Error {
  constructor(readonly step: string, readonly pg: PgErr) {
    super(`db: ${step}`)
  }
}

function emptyReport(status: CrmSyncRunStatus, message: string): CrmSyncReport {
  return {
    status,
    message,
    problems: status === 'success' || status === 'busy' ? [] : [message],
    contacts: null,
    deals: null,
    inserted: 0,
    updated: 0,
    linked: 0,
    unchanged: 0,
    skippedAtWrite: 0,
    mergedByPhone: 0,
    phoneConflicts: 0,
    relinked: null,
    missingInCrm: null,
    dealsWithoutContact: null,
    dealsOtherCurrency: null,
    avgUpdated: null,
    avgCleared: null,
    notWritten: 0,
  }
}

export const BUSY_MESSAGE = 'Синхронизация этого подключения уже идёт — дождитесь её окончания (обычно меньше минуты).'

const LEGACY_STEP = 'legacy source'

const missingObject = (sig: string) => /42703|42883|PGRST202|external_source|external_id|crm_sync_|sync_cursor|sync_lease/.test(sig)

/** A user-facing message for an error before any write. */
function failureMessage(e: unknown): string {
  if (e instanceof SyncDbError) {
    const sig = `${e.pg?.code ?? ''} ${e.pg?.message ?? ''}`
    if (e.step === LEGACY_STEP && e.pg?.code === '23505') {
      return 'Клиенты amoCRM со старым ключом (по адресу аккаунта) не перенесены на номер аккаунта: у части этих контактов уже есть второй клиент. Синхронизация остановлена, чтобы не добавить дубли, — обратитесь в поддержку.'
    }
    if (missingObject(sig)) return 'Синхронизация недоступна: в базе нет полей и функций синхронизации CRM (миграции 155 / 157 не применены)'
    return 'Ошибка базы данных при синхронизации — попробуйте позже'
  }
  const msg = e instanceof Error ? e.message : String(e)
  return (msg || 'Не удалось синхронизировать CRM').slice(0, 300)
}

/** Ties a supabase-js query to an AbortSignal (no-op for a client without abortSignal). */
function bounded<Q>(q: Q, signal: AbortSignal): Q {
  const f = (q as { abortSignal?: (s: AbortSignal) => Q }).abortSignal
  return typeof f === 'function' ? f.call(q, signal) : q
}

const ofTotal = (passRead: number, passTotal: number | null): string =>
  passTotal !== null && passTotal > passRead ? `${passRead} из ${passTotal}` : `${passRead}, есть ещё`

function why(list: ProviderList<unknown>, cap: number): string {
  if (list.stoppedBy === 'cap') return `за один раз читается до ${cap}`
  if (list.stoppedBy === 'time') return 'не хватило времени'
  return `CRM прервала загрузку: ${list.error ?? 'ошибка'}`
}

interface WriteResult<R> {
  rows: R[]
  /** Calls that went through (rows sent). */
  sent: number
  /** Rows not written: the time ran out or a call failed. */
  notWritten: number
  stopped: 'time' | 'error' | null
  error: PgErr
}

/** `rows` in chunks; stops (never retries row by row) when the time is up or a call fails. */
async function writeChunks<T, R>(
  rows: T[],
  send: (chunk: T[]) => PromiseLike<{ data: unknown; error: PgErr }>,
  timeLeft: () => number,
): Promise<WriteResult<R>> {
  const out: WriteResult<R> = { rows: [], sent: 0, notWritten: 0, stopped: null, error: null }
  for (let i = 0; i < rows.length; i += CRM_SYNC_CHUNK) {
    if (timeLeft() < MIN_CHUNK_MS) {
      out.notWritten = rows.length - i
      out.stopped = 'time'
      return out
    }
    const chunk = rows.slice(i, i + CRM_SYNC_CHUNK)
    const { data, error } = await send(chunk)
    if (error) {
      console.warn(`[crm/sync] write of ${chunk.length} rows refused: ${error.code ?? ''} ${(error.message ?? '').slice(0, 120)}`)
      out.notWritten = rows.length - i
      out.stopped = /abort/i.test(`${error.message ?? ''}`) ? 'time' : 'error'
      out.error = error
      return out
    }
    out.sent += chunk.length
    if (Array.isArray(data)) out.rows.push(...(data as R[]))
  }
  return out
}

/** One run of `conn`. Never throws: a failure is a report with status 'error', stored on the connection. */
export async function syncCrmConnection(sb: SupabaseClient, conn: SyncConnection, opts: SyncOptions): Promise<CrmSyncReport> {
  const now = opts.now ?? Date.now
  const start = now()
  const budget = Math.max(0, opts.deadlineAt - start)
  const timeLeft = () => opts.deadlineAt - FINAL_RESERVE_MS - now()

  const lease = await sb.rpc('crm_sync_acquire_lease', { p_connection: conn.id, p_seconds: Math.ceil(budget / 1000) + LEASE_MARGIN_S })
  if (lease.error) {
    const message = failureMessage(new SyncDbError('lease', lease.error))
    console.error(`[crm/sync] lease of ${conn.id}: ${lease.error.code ?? ''} ${lease.error.message ?? ''}`)
    return emptyReport('error', message)
  }
  if (!lease.data) return emptyReport('busy', BUSY_MESSAGE)
  const leaseToken = String(lease.data)

  // Aborts the database calls of the run once its budget (minus the final write's reserve) is spent.
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), Math.max(0, timeLeft()))
  let report: CrmSyncReport
  let nextCursor: SyncCursor | null = null
  try {
    const out = await runSync(sb, conn, opts, { start, budget, timeLeft, signal: ctl.signal })
    report = out.report
    nextCursor = out.cursor
  } catch (e) {
    report = emptyReport('error', failureMessage(e))
    if (e instanceof SyncDbError) console.error(`[crm/sync] ${e.step}: ${e.pg?.code ?? ''} ${e.pg?.message ?? ''}`)
  } finally {
    clearTimeout(timer)
  }

  const patch: Record<string, unknown> = {
    last_sync_at: new Date(now()).toISOString(),
    last_sync_status: report.status,
    last_sync_error: report.status === 'success' ? null : report.problems.join(' ').slice(0, ERROR_MAX),
    sync_lease_until: null,
    sync_lease_token: null,
  }
  if (nextCursor) patch.sync_cursor = nextCursor
  // The counts say what the running (or last) pass has read; an error keeps the previous ones.
  if (report.status !== 'error' && report.contacts) patch.synced_contacts = report.contacts.passRead
  if (report.status !== 'error' && report.deals) patch.synced_deals = report.deals.passRead
  const { error } = await bounded(
    sb.from('crm_provider_connections').update(patch).eq('id', conn.id).eq('user_id', conn.user_id).eq('sync_lease_token', leaseToken),
    AbortSignal.timeout(FINAL_WRITE_MS),
  )
  if (error) console.error(`[crm/sync] status of ${conn.id} not recorded: ${error.code ?? ''} ${error.message ?? ''}`)
  return report
}

interface RunCtx {
  start: number
  budget: number
  timeLeft: () => number
  signal: AbortSignal
}

async function runSync(
  sb: SupabaseClient,
  conn: SyncConnection,
  opts: SyncOptions,
  ctx: RunCtx,
): Promise<{ report: CrmSyncReport; cursor: SyncCursor }> {
  const now = opts.now ?? Date.now
  const cap = opts.maxRecords ?? CRM_SYNC_MAX_RECORDS
  const userId = conn.user_id
  const fetchUntil = ctx.start + ctx.budget * FETCH_SHARE
  const abortAt = ctx.start + ctx.budget * ABORT_SHARE
  const resolve = opts.resolve ?? resolverWithTimeout(Math.max(1_000, Math.min(5_000, abortAt - now())))
  const db = <Q>(q: Q): Q => bounded(q, ctx.signal)

  const { data: stored, error: cursorErr } = await db(
    sb.from('crm_provider_connections').select('sync_cursor').eq('id', conn.id).eq('user_id', userId).maybeSingle(),
  )
  if (cursorErr) throw new SyncDbError('cursor', cursorErr)

  let token: string
  try {
    token = openCrmToken(conn.access_token)
  } catch {
    throw new Error('Не удалось расшифровать ключ CRM — подключите CRM заново')
  }
  const account = await identifyProvider(conn.provider, conn.base_url, token, { abortAt, now, resolve })
  const src = account.externalSource
  const raw = (stored as { sync_cursor?: unknown } | null)?.sync_cursor
  const cursor = readCursor(raw, src)
  // Clients keyed by an earlier identity of the same account (amoCRM before wave 2: the host) move over.
  // L1 (wave 3): a move that fails stops the run before anything is read or written — writing under
  // the new key next to unmoved clients would add duplicates — and the cursor keeps its old source,
  // so the next run tries the move again.
  if ((raw as { source?: unknown } | null)?.source !== src) {
    for (const legacy of account.legacySources) {
      const { error } = await db(sb.from('crm_clients').update({ external_source: src }).eq('user_id', userId).eq('external_source', legacy))
      if (error) throw new SyncDbError(LEGACY_STEP, error)
    }
  }

  const runIso = new Date(ctx.start).toISOString()
  const contactsPass = cursor.contacts.started_at ?? runIso
  const dealsPass = cursor.deals.started_at ?? runIso
  const snapshot: ProviderSnapshot = await fetchProviderSnapshot(account, token, {
    maxRecords: cap,
    fetchUntil,
    abortAt,
    now,
    resolve,
    contactsFrom: cursor.contacts.position,
    dealsFrom: cursor.deals.position,
  })

  // ── clients ──
  const drafts = snapshot.contacts.items.map(contactDraft)
  const ids = Array.from(new Set(drafts.map((d) => d.externalId)))
  // M1: the holders of EVERY phone of the contacts read, linked or not.
  const phones = Array.from(new Set(drafts.filter((d) => d.phone).map((d) => d.phone as string)))
  const linkedRows: LocalClient[] = []
  for (let i = 0; i < ids.length; i += CRM_SYNC_CHUNK) {
    const { data, error } = await db(
      sb.from('crm_clients').select(LOCAL_CLIENT_COLUMNS).eq('user_id', userId).eq('external_source', src).in('external_id', ids.slice(i, i + CRM_SYNC_CHUNK)),
    )
    if (error) throw new SyncDbError('linked clients', error)
    linkedRows.push(...((data ?? []) as unknown as LocalClient[]))
  }
  const phoneRows: LocalClient[] = []
  for (let i = 0; i < phones.length; i += CRM_SYNC_CHUNK) {
    const { data, error } = await db(
      sb.from('crm_clients').select(LOCAL_CLIENT_COLUMNS).eq('user_id', userId).in('phone', phones.slice(i, i + CRM_SYNC_CHUNK)),
    )
    if (error) throw new SyncDbError('clients by phone', error)
    phoneRows.push(...((data ?? []) as unknown as LocalClient[]))
  }
  const plan: ClientWritePlan = planClientWrites({
    externalSource: src,
    drafts,
    linked: new Map(linkedRows.map((r) => [r.external_id as string, r])),
    byPhone: new Map(phoneRows.filter((r) => r.phone).map((r) => [r.phone as string, r])),
  })

  const upd = await writeChunks<(typeof plan.updates)[number], { id: string; changed: boolean }>(
    plan.updates,
    (chunk) => db(sb.rpc('crm_sync_update_clients', { p_user: userId, p_source: src, p_seen_at: runIso, p_rows: chunk })),
    ctx.timeLeft,
  )
  const ins = upd.stopped
    ? { rows: [], sent: 0, notWritten: plan.inserts.length, stopped: upd.stopped, error: null } as WriteResult<{ id: string }>
    : await writeChunks<(typeof plan.inserts)[number], { id: string }>(
        plan.inserts,
        (chunk) => db(sb.rpc('crm_sync_insert_clients', { p_user: userId, p_source: src, p_seen_at: runIso, p_rows: chunk })),
        ctx.timeLeft,
      )
  const linkIds = new Set(plan.updates.filter((u) => u.link).map((u) => u.id))
  const changed = upd.rows.filter((r) => r.changed)
  const linkedNow = changed.filter((r) => linkIds.has(r.id)).length
  const clientsWritten = !upd.stopped && !ins.stopped

  // ── deals ──
  const classes = snapshot.deals ? classifyDeals(snapshot.deals.items) : null
  const dealsW = classes && clientsWritten
    ? await writeChunks(
        classes.qualifying.map((q) => ({ connection_id: conn.id, user_id: userId, pass_started_at: dealsPass, ...q })),
        (chunk) => db(sb.from('crm_sync_deals').upsert(chunk, { onConflict: 'connection_id,deal_id' })),
        ctx.timeLeft,
      )
    : null

  // ── passes ──
  const problems: string[] = []
  const notes: string[] = []
  const c = snapshot.contacts
  let next: SyncCursor = { ...cursor, contacts: { ...cursor.contacts }, deals: { ...cursor.deals } }
  let contacts: PassReport
  let relinked: number | null = null
  let missingInCrm: number | null = null
  if (clientsWritten) {
    const passRead = cursor.contacts.read + c.items.length
    const passTotal = c.total !== null ? cursor.contacts.read + c.total : null
    const conflicts = addConflicts(cursor.contacts.conflicts, plan.conflicts)
    contacts = { read: c.items.length, passRead, passTotal, passComplete: c.complete }
    if (c.complete) {
      if (conflicts.length > 0) {
        const r = await db(sb.rpc('crm_sync_relink', {
          p_user: userId, p_source: src, p_pass_started_at: contactsPass,
          p_rows: conflicts.map((x) => ({ phone: x.phone, external_id: x.contact })),
        }))
        if (r.error) console.warn(`[crm/sync] relink of ${conn.id} failed: ${r.error.code ?? ''}`)
        else relinked = Number(r.data ?? 0)
      } else relinked = 0
      const never = await db(sb.from('crm_clients').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('external_source', src).is('external_seen_at', null))
      const stale = await db(sb.from('crm_clients').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('external_source', src).lt('external_seen_at', contactsPass))
      if (!never.error && !stale.error) missingInCrm = (never.count ?? 0) + (stale.count ?? 0)
      next.contacts = { started_at: null, position: null, read: 0, conflicts: [] }
    } else {
      next.contacts = { started_at: contactsPass, position: c.position, read: passRead, conflicts }
      problems.push(`Контакты: прочитано ${ofTotal(passRead, passTotal)} (${why(c, cap)}) — следующая синхронизация продолжит с этого места.`)
    }
  } else {
    contacts = { read: c.items.length, passRead: cursor.contacts.read, passTotal: null, passComplete: false }
    const stopped = upd.stopped ? upd : ins
    problems.push(stopped.stopped === 'time'
      ? `Не успели записать клиентов: ${upd.notWritten + ins.notWritten} — следующая синхронизация повторит эту часть.`
      : `База не приняла запись клиентов (${stopped.error?.code ?? 'ошибка'}) — следующая синхронизация повторит эту часть.`)
  }

  let deals: PassReport | null = null
  let dealsWithoutContact: number | null = null
  let dealsOtherCurrency: number | null = null
  let avgUpdated: number | null = null
  let avgCleared: number | null = null
  const d = snapshot.deals
  if (!d || !classes) {
    problems.push(`Сделки не загружены (${snapshot.dealsError ?? 'ошибка CRM'}) — средний чек не обновлялся.`)
  } else if (!dealsW) {
    problems.push('Сделки не записаны (клиенты не записаны до конца) — следующая синхронизация повторит.')
  } else if (dealsW.stopped) {
    problems.push(dealsW.stopped === 'time'
      ? 'Не успели записать сделки — следующая синхронизация повторит эту часть.'
      : `База не приняла запись сделок (${dealsW.error?.code ?? 'ошибка'}) — следующая синхронизация повторит эту часть.`)
  } else {
    const passRead = cursor.deals.read + d.items.length
    const passTotal = d.total !== null ? cursor.deals.read + d.total : null
    const withoutContact = cursor.deals.without_contact + classes.withoutContact
    const otherCurrency = cursor.deals.other_currency + classes.otherCurrency
    deals = { read: d.items.length, passRead, passTotal, passComplete: d.complete }
    if (d.complete) {
      const applied = await db(sb.rpc('crm_sync_apply_deal_totals', {
        p_connection: conn.id, p_user: userId, p_source: src, p_pass_started_at: dealsPass,
      }))
      if (applied.error) {
        console.warn(`[crm/sync] avg_check of ${conn.id} not applied: ${applied.error.code ?? ''}`)
        deals = { ...deals, passComplete: false }
        problems.push('Средний чек не обновлён (ошибка базы) — следующая синхронизация повторит.')
      } else {
        const row = (Array.isArray(applied.data) ? applied.data[0] : applied.data) as { updated?: number; cleared?: number } | null
        avgUpdated = Number(row?.updated ?? 0)
        avgCleared = Number(row?.cleared ?? 0)
        dealsWithoutContact = withoutContact
        dealsOtherCurrency = otherCurrency
        next.deals = { started_at: null, position: null, read: 0, without_contact: 0, other_currency: 0 }
      }
    } else {
      next.deals = { started_at: dealsPass, position: d.position, read: passRead, without_contact: withoutContact, other_currency: otherCurrency }
      problems.push(`Сделки: прочитано ${ofTotal(passRead, passTotal)} (${why(d, cap)}) — средний чек обновится, когда будут прочитаны все сделки; следующая синхронизация продолжит.`)
    }
  }
  // A pass in progress, or writes that stopped, bring the automatic sync back within half an hour.
  next = {
    ...next,
    catching_up: next.contacts.started_at !== null || next.deals.started_at !== null || !clientsWritten || !!dealsW?.stopped,
  }

  const inserted = ins.rows.length
  const skippedAtWrite = Math.max(0, ins.sent - inserted)
  const updated = changed.length - linkedNow
  const unchanged = upd.rows.length - changed.length
  notes.push(
    `Контактов прочитано: ${c.items.length}, сделок: ${d ? d.items.length : '—'}. ` +
      `Новых клиентов: ${inserted}, дополнено: ${updated}, связано по телефону: ${linkedNow}, без изменений: ${unchanged}.`,
  )
  if (plan.mergedByPhone > 0) notes.push(`Контактов с одним телефоном объединено: ${plan.mergedByPhone}.`)
  if (plan.conflicts.length > 0) notes.push(`Не добавлено контактов: ${plan.conflicts.length} — их телефон у клиента, связанного с другой записью CRM.`)
  if (skippedAtWrite > 0) notes.push(`Не добавлено при записи: ${skippedAtWrite} — телефон или запись CRM появились у другого клиента во время синхронизации.`)
  if (relinked) notes.push(`Перепривязано к записи CRM, у которой теперь их телефон: ${relinked}.`)
  if (missingInCrm) notes.push(`Нет больше в CRM: ${missingInCrm} — в портале клиенты оставлены.`)
  if (avgUpdated !== null) {
    notes.push(`Средний чек обновлён: ${avgUpdated}` + (avgCleared ? `, очищен: ${avgCleared} (у контакта больше нет подходящих сделок).` : '.'))
  }
  if (dealsWithoutContact) notes.push(`Сделок без контакта: ${dealsWithoutContact} — клиентами не стали.`)
  if (dealsOtherCurrency) notes.push(`Сделок не в тенге: ${dealsOtherCurrency} — в средний чек не вошли.`)

  return {
    cursor: next,
    report: {
      status: problems.length > 0 ? 'partial' : 'success',
      message: [...problems, ...notes].join(' '),
      problems,
      contacts,
      deals,
      inserted,
      updated,
      linked: linkedNow,
      unchanged,
      skippedAtWrite,
      mergedByPhone: plan.mergedByPhone,
      phoneConflicts: plan.conflicts.length,
      relinked,
      missingInCrm,
      dealsWithoutContact,
      dealsOtherCurrency,
      avgUpdated,
      avgCleared,
      notWritten: upd.notWritten + ins.notWritten + (dealsW?.notWritten ?? 0),
    },
  }
}
