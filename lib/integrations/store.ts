/**
 * lib/integrations/store.ts — server-side access to integration_connections /
 * integration_facts (migration 105) through the direct connection (Prisma,
 * table owner — RLS does not apply). Callers authorise first:
 *   client routes  lib/tenancy resolveTenant (manage for changes),
 *   GIGA routes    requireGiga with an RBAC permission,
 *   the agent      a platform-scope task with RUN_INTEGRATION.
 *
 * Secret columns leave this module only through `claim*` (for the sync engine
 * and the connection test) — never in a row meant for an API response.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { validFact, type FactInput } from './facts'
import type { ErrorKind } from './http'
import type { ProviderKey } from './registry'

export type ConnectionStatus = 'connected' | 'error' | 'disconnected' | 'needs_reauth'

/** A connection as APIs may return it: no secrets, no lease token, no cursor internals. */
export interface ConnectionView {
  id: string
  companyId: string
  provider: ProviderKey
  status: ConnectionStatus
  authKind: string
  accountLabel: string | null
  settings: Record<string, string>
  lastSyncAt: string | null
  nextSyncAt: string | null
  lastError: string | null
  lastErrorKind: ErrorKind | null
  errorCount: number
  filledTo: string | null
  createdAt: string
  updatedAt: string
}

interface ConnectionRow {
  id: string
  company_id: string
  provider: string
  status: string
  auth_kind: string
  account_label: string | null
  settings: unknown
  cursor: unknown
  last_sync_at: Date | null
  next_sync_at: Date | null
  last_error: string | null
  last_error_kind: string | null
  error_count: number
  created_at: Date
  updated_at: Date
}

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null)

/** Migration 105 not applied in this environment (relation missing). */
export function isIntegrationsTableMissing(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return /42P01|relation "?(public\.)?integration_(connections|facts)"? does not exist/i.test(msg)
}

function stringMap(v: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (typeof val === 'string') out[k] = val
  }
  return out
}

function toView(r: ConnectionRow): ConnectionView {
  const cursor = (r.cursor && typeof r.cursor === 'object' ? r.cursor : {}) as Record<string, unknown>
  return {
    id: r.id,
    companyId: r.company_id,
    provider: r.provider as ProviderKey,
    status: r.status as ConnectionStatus,
    authKind: r.auth_kind,
    accountLabel: r.account_label,
    settings: stringMap(r.settings),
    lastSyncAt: iso(r.last_sync_at),
    nextSyncAt: iso(r.next_sync_at),
    lastError: r.last_error,
    lastErrorKind: (r.last_error_kind as ErrorKind | null) ?? null,
    errorCount: Number(r.error_count ?? 0),
    filledTo: typeof cursor.filled_to === 'string' ? cursor.filled_to : null,
    createdAt: iso(r.created_at) as string,
    updatedAt: iso(r.updated_at) as string,
  }
}

const VIEW_COLUMNS = Prisma.sql`id, company_id, provider, status, auth_kind, account_label, settings, cursor,
  last_sync_at, next_sync_at, last_error, last_error_kind, error_count, created_at, updated_at`

export async function listConnections(companyId: string): Promise<ConnectionView[]> {
  const rows = await prisma.$queryRaw<ConnectionRow[]>`
    SELECT ${VIEW_COLUMNS} FROM public.integration_connections
    WHERE company_id = ${companyId} ORDER BY provider`
  return rows.map(toView)
}

export interface StaffConnectionView extends ConnectionView {
  companyName: string | null
}

/** GIGA overview: every company's connections (bounded), optionally one company. */
export async function listConnectionsForStaff(opts: { companyId?: string | null; limit?: number } = {}): Promise<StaffConnectionView[]> {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500)
  const rows = await prisma.$queryRaw<Array<ConnectionRow & { company_name: string | null }>>`
    SELECT c.id, c.company_id, c.provider, c.status, c.auth_kind, c.account_label, c.settings, c.cursor,
           c.last_sync_at, c.next_sync_at, c.last_error, c.last_error_kind, c.error_count, c.created_at, c.updated_at,
           co.name AS company_name
    FROM public.integration_connections c
    LEFT JOIN public.companies co ON co.id = c.company_id
    WHERE (${opts.companyId ?? null}::text IS NULL OR c.company_id = ${opts.companyId ?? null})
    ORDER BY (c.status IN ('error', 'needs_reauth')) DESC, c.updated_at DESC
    LIMIT ${limit}`
  return rows.map((r) => ({ ...toView(r), companyName: r.company_name }))
}

export async function getConnection(companyId: string, provider: ProviderKey): Promise<ConnectionView | null> {
  const rows = await prisma.$queryRaw<ConnectionRow[]>`
    SELECT ${VIEW_COLUMNS} FROM public.integration_connections
    WHERE company_id = ${companyId} AND provider = ${provider}`
  return rows[0] ? toView(rows[0]) : null
}

export async function companyExists(companyId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok FROM public.companies WHERE id = ${companyId}`
  return rows.length > 0
}

export interface SaveConnectionInput {
  companyId: string
  provider: ProviderKey
  authKind: 'token' | 'oauth' | 'basic' | 'file'
  secretCiphertext: string | null
  settings: Record<string, string>
  accountLabel: string | null
  createdBy: string | null
}

/**
 * Connect or re-connect. A changed account (other settings) starts the
 * history again; the same account keeps its cursor. Facts already written
 * stay (they are true for their periods).
 */
export async function saveConnection(input: SaveConnectionInput): Promise<ConnectionView> {
  const settings = JSON.stringify(input.settings)
  const rows = await prisma.$queryRaw<ConnectionRow[]>`
    INSERT INTO public.integration_connections
      (company_id, provider, status, auth_kind, secret_ciphertext, settings, account_label, created_by, next_sync_at)
    VALUES (${input.companyId}, ${input.provider}, 'connected', ${input.authKind}, ${input.secretCiphertext},
            ${settings}::jsonb, ${input.accountLabel}, ${input.createdBy}::uuid, now())
    ON CONFLICT (company_id, provider) DO UPDATE SET
      status = 'connected',
      auth_kind = EXCLUDED.auth_kind,
      secret_ciphertext = EXCLUDED.secret_ciphertext,
      refresh_ciphertext = NULL,
      expires_at = NULL,
      cursor = CASE WHEN public.integration_connections.settings = EXCLUDED.settings
                    THEN public.integration_connections.cursor ELSE '{}'::jsonb END,
      settings = EXCLUDED.settings,
      account_label = EXCLUDED.account_label,
      last_error = NULL,
      last_error_kind = NULL,
      error_count = 0,
      next_sync_at = now(),
      sync_lease_until = NULL,
      sync_lease_token = NULL
    RETURNING ${VIEW_COLUMNS}`
  return toView(rows[0])
}

/**
 * Disconnect: secrets are deleted at once. A live connection stays as a
 * 'disconnected' row (history, facts), a file connection is removed.
 */
export async function disconnectConnection(companyId: string, provider: ProviderKey): Promise<boolean> {
  const removed = await prisma.$executeRaw`
    DELETE FROM public.integration_connections
    WHERE company_id = ${companyId} AND provider = ${provider} AND auth_kind = 'file'`
  if (removed > 0) return true
  const updated = await prisma.$executeRaw`
    UPDATE public.integration_connections SET
      status = 'disconnected', secret_ciphertext = NULL, refresh_ciphertext = NULL, expires_at = NULL,
      sync_lease_until = NULL, sync_lease_token = NULL
    WHERE company_id = ${companyId} AND provider = ${provider}`
  return updated > 0
}

// ── Sync engine side ─────────────────────────────────────────────────────────

export interface ClaimedConnection {
  id: string
  companyId: string
  provider: ProviderKey
  authKind: string
  secretCiphertext: string | null
  settings: Record<string, string>
  cursor: Record<string, unknown>
  errorCount: number
  leaseToken: string
}

interface ClaimRow {
  id: string
  company_id: string
  provider: string
  auth_kind: string
  secret_ciphertext: string | null
  settings: unknown
  cursor: unknown
  error_count: number
  sync_lease_token: string
}

function toClaimed(r: ClaimRow): ClaimedConnection {
  return {
    id: r.id,
    companyId: r.company_id,
    provider: r.provider as ProviderKey,
    authKind: r.auth_kind,
    secretCiphertext: r.secret_ciphertext,
    settings: stringMap(r.settings),
    cursor: (r.cursor && typeof r.cursor === 'object' ? r.cursor : {}) as Record<string, unknown>,
    errorCount: Number(r.error_count ?? 0),
    leaseToken: r.sync_lease_token,
  }
}

/** Connections due for a sync, leased to this worker (two workers never get the same one). */
export async function claimDueConnections(limit: number, leaseSeconds: number): Promise<ClaimedConnection[]> {
  const n = Math.min(Math.max(Math.floor(limit), 1), 50)
  const rows = await prisma.$queryRaw<ClaimRow[]>`
    UPDATE public.integration_connections c SET
      sync_lease_until = now() + make_interval(secs => ${leaseSeconds}),
      sync_lease_token = gen_random_uuid()
    WHERE c.id IN (
      SELECT id FROM public.integration_connections
      WHERE status IN ('connected', 'error') AND auth_kind <> 'file' AND secret_ciphertext IS NOT NULL
        AND next_sync_at <= now()
        AND (sync_lease_until IS NULL OR sync_lease_until < now())
      ORDER BY next_sync_at
      LIMIT ${n}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING c.id, c.company_id, c.provider, c.auth_kind, c.secret_ciphertext, c.settings, c.cursor, c.error_count, c.sync_lease_token`
  return rows.map(toClaimed)
}

/** One connection (manual «Синхронизировать» / tests), if it is not leased by another run. */
export async function claimConnection(id: string, leaseSeconds: number): Promise<ClaimedConnection | null> {
  const rows = await prisma.$queryRaw<ClaimRow[]>`
    UPDATE public.integration_connections SET
      sync_lease_until = now() + make_interval(secs => ${leaseSeconds}),
      sync_lease_token = gen_random_uuid()
    WHERE id = ${id}::uuid AND status IN ('connected', 'error') AND auth_kind <> 'file'
      AND secret_ciphertext IS NOT NULL
      AND (sync_lease_until IS NULL OR sync_lease_until < now())
    RETURNING id, company_id, provider, auth_kind, secret_ciphertext, settings, cursor, error_count, sync_lease_token`
  return rows[0] ? toClaimed(rows[0]) : null
}

/** Secrets of one connection for a «Проверить» test (no lease: read only). */
export async function connectionSecret(companyId: string, provider: ProviderKey): Promise<{ id: string; secretCiphertext: string | null; settings: Record<string, string>; status: string } | null> {
  const rows = await prisma.$queryRaw<Array<{ id: string; secret_ciphertext: string | null; settings: unknown; status: string }>>`
    SELECT id, secret_ciphertext, settings, status FROM public.integration_connections
    WHERE company_id = ${companyId} AND provider = ${provider}`
  const r = rows[0]
  return r ? { id: r.id, secretCiphertext: r.secret_ciphertext, settings: stringMap(r.settings), status: r.status } : null
}

const FACT_BATCH = 500

/** Idempotent upsert: the same (company, provider, metric, period) keeps one row. */
export async function upsertFacts(
  tx: Prisma.TransactionClient,
  companyId: string,
  provider: ProviderKey,
  facts: readonly FactInput[],
): Promise<number> {
  const valid = facts.filter(validFact)
  let written = 0
  for (let i = 0; i < valid.length; i += FACT_BATCH) {
    const chunk = valid.slice(i, i + FACT_BATCH)
    const values = chunk.map((f) => Prisma.sql`(${companyId}, ${provider}, ${f.metricKey}, ${f.periodStart}::date, ${f.periodEnd}::date,
      ${f.value}::numeric, ${f.unit}, ${f.sourceRef ?? null}, now())`)
    written += await tx.$executeRaw`
      INSERT INTO public.integration_facts (company_id, provider, metric_key, period_start, period_end, value, unit, source_ref, fetched_at)
      VALUES ${Prisma.join(values)}
      ON CONFLICT (company_id, provider, metric_key, period_start, period_end) DO UPDATE SET
        value = EXCLUDED.value, unit = EXCLUDED.unit, source_ref = EXCLUDED.source_ref, fetched_at = EXCLUDED.fetched_at`
  }
  return written
}

export interface SuccessInput {
  facts: readonly FactInput[]
  cursor: Record<string, unknown>
  accountLabel?: string | null
  nextSyncAt: Date
}

/** Facts + cursor in one transaction, only while this run still holds the lease. */
export async function finishSyncSuccess(conn: ClaimedConnection, input: SuccessInput): Promise<{ written: number; leaseLost: boolean }> {
  return prisma.$transaction(async (tx) => {
    const own = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM public.integration_connections
      WHERE id = ${conn.id}::uuid AND sync_lease_token = ${conn.leaseToken}::uuid
        AND status IN ('connected', 'error')
      FOR UPDATE`
    if (!own.length) return { written: 0, leaseLost: true }
    const written = await upsertFacts(tx, conn.companyId, conn.provider, input.facts)
    await tx.$executeRaw`
      UPDATE public.integration_connections SET
        status = 'connected', cursor = ${JSON.stringify(input.cursor)}::jsonb,
        account_label = COALESCE(${input.accountLabel ?? null}, account_label),
        last_sync_at = now(), next_sync_at = ${input.nextSyncAt},
        last_error = NULL, last_error_kind = NULL, error_count = 0,
        sync_lease_until = NULL, sync_lease_token = NULL
      WHERE id = ${conn.id}::uuid`
    return { written, leaseLost: false }
  })
}

export interface FailureInput {
  kind: ErrorKind
  message: string
  nextSyncAt: Date
  /** needs_reauth on auth errors; error after repeated failures. */
  status: ConnectionStatus
  /** Count the failure (rate limits and budget stops are not failures). */
  countAsFailure: boolean
}

export async function finishSyncFailure(conn: ClaimedConnection, input: FailureInput): Promise<{ errorCount: number; leaseLost: boolean }> {
  const rows = await prisma.$queryRaw<Array<{ error_count: number }>>`
    UPDATE public.integration_connections SET
      status = ${input.status},
      last_error = ${input.message.slice(0, 500)}, last_error_kind = ${input.kind},
      error_count = error_count + ${input.countAsFailure ? 1 : 0},
      next_sync_at = ${input.nextSyncAt},
      sync_lease_until = NULL, sync_lease_token = NULL
    WHERE id = ${conn.id}::uuid AND sync_lease_token = ${conn.leaseToken}::uuid
      AND status IN ('connected', 'error')
    RETURNING error_count`
  return rows[0] ? { errorCount: Number(rows[0].error_count), leaseLost: false } : { errorCount: conn.errorCount, leaseLost: true }
}

/**
 * Give a claimed connection back without a verdict (the run hit its deadline,
 * or credentials storage is not configured on this worker): status, cursor,
 * error count and last error stay as they are; only the next run time moves.
 */
export async function releaseSync(conn: ClaimedConnection, nextSyncAt: Date): Promise<{ leaseLost: boolean }> {
  const n = await prisma.$executeRaw`
    UPDATE public.integration_connections SET
      next_sync_at = ${nextSyncAt},
      sync_lease_until = NULL, sync_lease_token = NULL
    WHERE id = ${conn.id}::uuid AND sync_lease_token = ${conn.leaseToken}::uuid
      AND status IN ('connected', 'error')`
  return { leaseLost: n === 0 }
}

/** Record a failed «Проверить» on an existing connection (auth → needs_reauth). */
export async function markTestResult(companyId: string, provider: ProviderKey, result: { ok: true; accountLabel: string | null } | { ok: false; kind: ErrorKind; message: string }): Promise<void> {
  if (result.ok) {
    await prisma.$executeRaw`
      UPDATE public.integration_connections SET
        next_sync_at = CASE WHEN status = 'needs_reauth' THEN now() ELSE next_sync_at END,
        status = CASE WHEN status = 'needs_reauth' THEN 'connected' ELSE status END,
        account_label = COALESCE(${result.accountLabel}, account_label),
        last_error = NULL, last_error_kind = NULL
      WHERE company_id = ${companyId} AND provider = ${provider} AND status <> 'disconnected'`
    return
  }
  await prisma.$executeRaw`
    UPDATE public.integration_connections SET
      status = CASE WHEN ${result.kind} = 'auth' THEN 'needs_reauth' ELSE status END,
      last_error = ${result.message.slice(0, 500)}, last_error_kind = ${result.kind}
    WHERE company_id = ${companyId} AND provider = ${provider} AND status <> 'disconnected'`
}

/** Bring a connection forward so the next agent run picks it up (manual «Синхронизировать»). */
export async function requestSyncNow(companyId: string, provider: ProviderKey): Promise<boolean> {
  const n = await prisma.$executeRaw`
    UPDATE public.integration_connections SET next_sync_at = now()
    WHERE company_id = ${companyId} AND provider = ${provider}
      AND status IN ('connected', 'error') AND auth_kind <> 'file'`
  return n > 0
}

export interface FactRow {
  provider: string
  metric_key: string
  period_start: string
  period_end: string
  value: number
  unit: string | null
  fetched_at: string
}

/** Company picker of the GIGA page: id + name, by name or id prefix (bounded). */
export async function searchCompanies(q: string, limit = 20): Promise<Array<{ id: string; name: string | null }>> {
  const term = q.trim().slice(0, 80)
  if (term.length < 2) return []
  const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  return prisma.$queryRaw<Array<{ id: string; name: string | null }>>`
    SELECT id, name FROM public.companies
    WHERE name ILIKE ${like} OR id LIKE ${`${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}
    ORDER BY name NULLS LAST
    LIMIT ${Math.min(Math.max(limit, 1), 50)}`
}
