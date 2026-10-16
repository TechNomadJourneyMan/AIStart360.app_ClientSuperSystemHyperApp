/**
 * WhatsApp Web bridge «pull control» (WHATSAPP_WEB_BRIDGE_CONTROL=pull).
 *
 * The bridge runs behind NAT (owner's Mac, 127.0.0.1, no public URL), so the
 * portal cannot call it. Instead:
 *   - the bridge PUSHES its session status (and the transient pairing QR while
 *     state = 'qr') to POST /api/webhooks/whatsapp-web/session;
 *   - GIGA buttons record a COMMAND (connect / logout) that the bridge CLAIMS
 *     via POST /api/webhooks/whatsapp-web/commands/claim and ACKS via
 *     POST /api/webhooks/whatsapp-web/commands/ack.
 *
 * Storage (migration 123, service role only):
 *   whatsapp_bridge_status    one row per session — the latest pushed status.
 *   whatsapp_bridge_commands  command log; at most one in-flight (pending or
 *                             claimed) command per session (partial unique
 *                             index), commands expire after COMMAND_TTL.
 *
 * DB-load discipline: a status push is ONE single-row upsert; identical
 * heartbeats closer than STATUS_MIN_WRITE_INTERVAL_MS are dropped per instance;
 * an idle claim is ONE indexed select. No cron, no Inngest.
 *
 * The QR string is account-equivalent for ~60 s: it is never logged, stored
 * only while pairing and cleared once expired or connected.
 */
import { createHash, randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase-service'

export const BRIDGE_PUSHED_STATES = [
  'disconnected',
  'connecting',
  'qr',
  'connected',
  'error',
] as const
export type BridgePushedState = (typeof BRIDGE_PUSHED_STATES)[number]

export const BRIDGE_COMMAND_ACTIONS = ['connect', 'logout'] as const
export type BridgeCommandAction = (typeof BRIDGE_COMMAND_ACTIONS)[number]

export type BridgeCommandStatus =
  | 'pending'
  | 'claimed'
  | 'succeeded'
  | 'failed'
  | 'expired'
  | 'cancelled'

/** A pushed status older than this means the bridge is not on the line. */
export const BRIDGE_STALE_AFTER_MS = 90_000
/** Identical heartbeats are written at most this often (per instance). */
export const STATUS_MIN_WRITE_INTERVAL_MS = 15_000
/** A pairing QR is never kept longer than this, whatever the bridge says. */
export const QR_MAX_TTL_MS = 120_000
export const COMMAND_TTL_SECONDS = 120
export const COMMAND_LEASE_SECONDS = 45
/** Finished commands older than this are pruned when a new one is issued. */
export const COMMAND_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export interface BridgeStatusRow {
  session_id: string
  state: BridgePushedState
  connected: boolean
  qr: string | null
  qr_expires_at: string | null
  error_code: string | null
  bridge_updated_at: string | null
  bridge_version: string | null
  last_seen_at: string
}

export interface BridgeCommandRow {
  id: string
  session_id: string
  action: BridgeCommandAction
  status: BridgeCommandStatus
  idempotency_key: string
  requested_by: string | null
  lease_token: string | null
  lease_until: string | null
  attempts: number
  result_code: string | null
  created_at: string
  expires_at: string
  claimed_at: string | null
  completed_at: string | null
}

export type NewBridgeCommand = Pick<
  BridgeCommandRow,
  'session_id' | 'action' | 'idempotency_key' | 'requested_by' | 'created_at' | 'expires_at'
>

/** Minimal storage port: every method is one statement (atomic on its own). */
export interface BridgeControlStore {
  upsertStatus(row: BridgeStatusRow): Promise<void>
  readStatus(sessionId: string): Promise<BridgeStatusRow | null>
  /** Clears a QR whose qr_expires_at <= `expiredAt` (no-op otherwise). */
  clearExpiredQr(sessionId: string, expiredAt: string): Promise<void>
  /** Marks in-flight commands with expires_at <= `now` as expired. */
  expireCommands(sessionId: string, now: string): Promise<void>
  /** Deletes finished commands created before `before`. */
  pruneCommands(before: string): Promise<void>
  /** The newest pending/claimed command of the session, if any. */
  findInFlight(sessionId: string): Promise<BridgeCommandRow | null>
  /** 'conflict' when another in-flight command or the same key exists. */
  insertCommand(row: NewBridgeCommand): Promise<BridgeCommandRow | 'conflict'>
  /** Compare-and-set on (id, status, lease_token); null when the fence moved. */
  updateCommand(
    id: string,
    expected: { status: BridgeCommandStatus; leaseToken: string | null },
    patch: Partial<BridgeCommandRow>,
  ): Promise<BridgeCommandRow | null>
}

// ─── Status push ────────────────────────────────────────────────────────────

export interface PushedBridgeStatus {
  sessionId: string
  state: BridgePushedState
  connected: boolean
  qr: string | null
  qrExpiresAt: string | null
  errorCode: string | null
  updatedAt: string | null
  bridgeVersion: string | null
}

const globalThrottle = globalThis as typeof globalThis & {
  __aistart360BridgeStatusWrites?: Map<string, { fingerprint: string; writtenAt: number }>
}

function writeThrottle(): Map<string, { fingerprint: string; writtenAt: number }> {
  globalThrottle.__aistart360BridgeStatusWrites ??= new Map()
  return globalThrottle.__aistart360BridgeStatusWrites
}

/** Test hook: forget the per-instance heartbeat throttle. */
export function resetBridgeStatusThrottle(): void {
  writeThrottle().clear()
}

function iso(value: string | null | undefined): string | null {
  if (!value) return null
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

/** Normalizes a push into the stored row. The QR survives only while pairing. */
export function normalizePushedStatus(input: PushedBridgeStatus, now: Date): BridgeStatusRow {
  const nowMs = now.getTime()
  const qrExpiresMs = input.qrExpiresAt ? new Date(input.qrExpiresAt).getTime() : NaN
  const qrUsable = input.state === 'qr'
    && typeof input.qr === 'string'
    && input.qr.length > 0
    && Number.isFinite(qrExpiresMs)
    && qrExpiresMs > nowMs
  return {
    session_id: input.sessionId,
    state: input.state,
    connected: input.state === 'connected',
    qr: qrUsable ? input.qr : null,
    qr_expires_at: qrUsable
      ? new Date(Math.min(qrExpiresMs, nowMs + QR_MAX_TTL_MS)).toISOString()
      : null,
    error_code: input.state === 'error' ? input.errorCode : null,
    bridge_updated_at: iso(input.updatedAt),
    bridge_version: input.bridgeVersion,
    last_seen_at: now.toISOString(),
  }
}

function fingerprint(row: BridgeStatusRow): string {
  return [
    row.state,
    row.connected ? '1' : '0',
    row.qr ? createHash('sha256').update(row.qr).digest('hex') : '-',
    row.error_code ?? '-',
    row.bridge_updated_at ?? '-',
  ].join('|')
}

/**
 * One single-row upsert per accepted push. An unchanged heartbeat arriving
 * sooner than STATUS_MIN_WRITE_INTERVAL_MS after the last write by this
 * instance is acknowledged without touching the database.
 */
export async function recordBridgeStatus(
  store: BridgeControlStore,
  input: PushedBridgeStatus,
  now: Date = new Date(),
): Promise<{ written: boolean }> {
  const row = normalizePushedStatus(input, now)
  const key = fingerprint(row)
  const throttle = writeThrottle()
  const last = throttle.get(row.session_id)
  if (
    last
    && last.fingerprint === key
    && now.getTime() - last.writtenAt < STATUS_MIN_WRITE_INTERVAL_MS
  ) {
    return { written: false }
  }
  await store.upsertStatus(row)
  throttle.set(row.session_id, { fingerprint: key, writtenAt: now.getTime() })
  return { written: true }
}

// ─── Status read (GIGA) ─────────────────────────────────────────────────────

export type BridgeViewState = BridgePushedState | 'never_seen' | 'offline'

export interface BridgeStatusView {
  state: BridgeViewState
  online: boolean
  connected: boolean
  /** Transient raw pairing payload — render, never persist or log. */
  qr: string | null
  lastSeenAt: string | null
  updatedAt: string | null
  errorCode: string | null
}

export function bridgeStatusView(row: BridgeStatusRow | null, now: Date = new Date()): BridgeStatusView {
  if (!row) {
    return {
      state: 'never_seen',
      online: false,
      connected: false,
      qr: null,
      lastSeenAt: null,
      updatedAt: null,
      errorCode: null,
    }
  }
  const nowMs = now.getTime()
  const lastSeenMs = new Date(row.last_seen_at).getTime()
  const online = Number.isFinite(lastSeenMs) && nowMs - lastSeenMs <= BRIDGE_STALE_AFTER_MS
  if (!online) {
    return {
      state: 'offline',
      online: false,
      connected: false,
      qr: null,
      lastSeenAt: row.last_seen_at,
      updatedAt: row.bridge_updated_at,
      errorCode: null,
    }
  }
  const qrExpiresMs = row.qr_expires_at ? new Date(row.qr_expires_at).getTime() : NaN
  const qrValid = row.state === 'qr' && Boolean(row.qr) && Number.isFinite(qrExpiresMs) && qrExpiresMs > nowMs
  return {
    // An expired QR means the bridge is between codes: show «connecting».
    state: row.state === 'qr' && !qrValid ? 'connecting' : row.state,
    online: true,
    connected: row.state === 'connected',
    qr: qrValid ? row.qr : null,
    lastSeenAt: row.last_seen_at,
    updatedAt: row.bridge_updated_at,
    errorCode: row.state === 'error' ? row.error_code : null,
  }
}

export interface BridgeControlSnapshot {
  view: BridgeStatusView
  pendingCommand: { id: string; action: BridgeCommandAction; status: BridgeCommandStatus; createdAt: string } | null
}

export async function readBridgeControlSnapshot(
  store: BridgeControlStore,
  sessionId: string,
  now: Date = new Date(),
): Promise<BridgeControlSnapshot> {
  const [row, inFlight] = await Promise.all([
    store.readStatus(sessionId),
    store.findInFlight(sessionId),
  ])
  // A stored QR outlives its usefulness only until the next read: clear it
  // (conditional single-row update, only when one is actually expired).
  if (row?.qr && row.qr_expires_at && new Date(row.qr_expires_at).getTime() <= now.getTime()) {
    await store.clearExpiredQr(sessionId, now.toISOString()).catch(() => undefined)
  }
  const live = inFlight && new Date(inFlight.expires_at).getTime() > now.getTime() ? inFlight : null
  return {
    view: bridgeStatusView(row, now),
    pendingCommand: live
      ? { id: live.id, action: live.action, status: live.status, createdAt: live.created_at }
      : null,
  }
}

// ─── Commands ───────────────────────────────────────────────────────────────

export type IssueBridgeCommandResult =
  | { kind: 'created'; command: BridgeCommandRow }
  /** The same action is already in flight — deduplicated, nothing new written. */
  | { kind: 'existing'; command: BridgeCommandRow }
  /** A different action is being executed by the bridge right now. */
  | { kind: 'busy'; command: BridgeCommandRow }

export async function issueBridgeCommand(
  store: BridgeControlStore,
  input: {
    sessionId: string
    action: BridgeCommandAction
    idempotencyKey: string
    requestedBy: string | null
    now?: Date
    ttlSeconds?: number
  },
): Promise<IssueBridgeCommandResult> {
  const now = input.now ?? new Date()
  const nowIso = now.toISOString()
  await store.expireCommands(input.sessionId, nowIso)
  await store.pruneCommands(new Date(now.getTime() - COMMAND_RETENTION_MS).toISOString()).catch(() => undefined)

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const inFlight = await store.findInFlight(input.sessionId)
    if (inFlight) {
      if (inFlight.action === input.action) return { kind: 'existing', command: inFlight }
      if (inFlight.status === 'claimed') return { kind: 'busy', command: inFlight }
      // Not picked up yet: the newer intent wins (e.g. «Завершить» after
      // «Получить QR» that the bridge has not seen).
      const cancelled = await store.updateCommand(
        inFlight.id,
        { status: 'pending', leaseToken: inFlight.lease_token },
        { status: 'cancelled', completed_at: nowIso, result_code: 'superseded' },
      )
      if (!cancelled) continue
    }
    const ttl = Math.max(30, Math.min(600, input.ttlSeconds ?? COMMAND_TTL_SECONDS))
    const inserted = await store.insertCommand({
      session_id: input.sessionId,
      action: input.action,
      idempotency_key: input.idempotencyKey,
      requested_by: input.requestedBy,
      created_at: nowIso,
      expires_at: new Date(now.getTime() + ttl * 1000).toISOString(),
    })
    if (inserted !== 'conflict') return { kind: 'created', command: inserted }
  }
  const winner = await store.findInFlight(input.sessionId)
  if (winner) {
    return { kind: winner.action === input.action ? 'existing' : 'busy', command: winner }
  }
  throw new Error('bridge command could not be recorded')
}

export interface ClaimedBridgeCommand {
  id: string
  action: BridgeCommandAction
  leaseToken: string
  expiresAt: string
}

/**
 * Hands the in-flight command to the bridge under a fresh lease token. A
 * claimed command whose lease lapsed (bridge crashed before acking) can be
 * re-claimed until it expires — connect/logout are idempotent on the bridge.
 */
export async function claimBridgeCommand(
  store: BridgeControlStore,
  input: { sessionId: string; now?: Date; leaseSeconds?: number; leaseToken?: string },
): Promise<ClaimedBridgeCommand | null> {
  const now = input.now ?? new Date()
  const nowMs = now.getTime()
  const candidate = await store.findInFlight(input.sessionId)
  if (!candidate || candidate.session_id !== input.sessionId) return null

  if (new Date(candidate.expires_at).getTime() <= nowMs) {
    await store.updateCommand(
      candidate.id,
      { status: candidate.status, leaseToken: candidate.lease_token },
      { status: 'expired', completed_at: now.toISOString() },
    )
    return null
  }
  if (
    candidate.status === 'claimed'
    && candidate.lease_until
    && new Date(candidate.lease_until).getTime() > nowMs
  ) {
    return null
  }

  const lease = Math.max(10, Math.min(120, input.leaseSeconds ?? COMMAND_LEASE_SECONDS))
  const leaseToken = input.leaseToken ?? randomUUID()
  const claimed = await store.updateCommand(
    candidate.id,
    { status: candidate.status, leaseToken: candidate.lease_token },
    {
      status: 'claimed',
      lease_token: leaseToken,
      lease_until: new Date(Math.min(
        nowMs + lease * 1000,
        new Date(candidate.expires_at).getTime(),
      )).toISOString(),
      claimed_at: now.toISOString(),
      attempts: candidate.attempts + 1,
    },
  )
  if (!claimed) return null
  return {
    id: claimed.id,
    action: claimed.action,
    leaseToken,
    expiresAt: claimed.expires_at,
  }
}

export async function ackBridgeCommand(
  store: BridgeControlStore,
  input: {
    sessionId: string
    commandId: string
    leaseToken: string
    outcome: 'succeeded' | 'failed'
    errorCode?: string | null
    now?: Date
  },
): Promise<{ accepted: boolean }> {
  const now = input.now ?? new Date()
  const updated = await store.updateCommand(
    input.commandId,
    { status: 'claimed', leaseToken: input.leaseToken },
    {
      status: input.outcome,
      result_code: input.outcome === 'failed' ? input.errorCode ?? 'bridge_failed' : null,
      completed_at: now.toISOString(),
      lease_until: null,
    },
  )
  return { accepted: Boolean(updated && updated.session_id === input.sessionId) }
}

// ─── Supabase store ─────────────────────────────────────────────────────────

const STATUS_TABLE = 'whatsapp_bridge_status'
const COMMANDS_TABLE = 'whatsapp_bridge_commands'
const IN_FLIGHT = ['pending', 'claimed'] as const

function storeError(operation: string): Error {
  // Supabase error payloads may echo row values; keep only the operation name.
  return new Error(`whatsapp bridge control: ${operation} failed`)
}

export function createSupabaseBridgeControlStore(
  client: SupabaseClient = createServiceClient(),
): BridgeControlStore {
  return {
    async upsertStatus(row) {
      const { error } = await client.from(STATUS_TABLE).upsert(row, { onConflict: 'session_id' })
      if (error) throw storeError('status upsert')
    },
    async readStatus(sessionId) {
      const { data, error } = await client
        .from(STATUS_TABLE)
        .select('session_id, state, connected, qr, qr_expires_at, error_code, bridge_updated_at, bridge_version, last_seen_at')
        .eq('session_id', sessionId)
        .maybeSingle()
      if (error) throw storeError('status read')
      return (data as BridgeStatusRow | null) ?? null
    },
    async clearExpiredQr(sessionId, expiredAt) {
      const { error } = await client
        .from(STATUS_TABLE)
        .update({ qr: null, qr_expires_at: null })
        .eq('session_id', sessionId)
        .not('qr', 'is', null)
        .lte('qr_expires_at', expiredAt)
      if (error) throw storeError('qr clear')
    },
    async expireCommands(sessionId, now) {
      const { error } = await client
        .from(COMMANDS_TABLE)
        .update({ status: 'expired', completed_at: now, lease_until: null })
        .eq('session_id', sessionId)
        .in('status', [...IN_FLIGHT])
        .lte('expires_at', now)
      if (error) throw storeError('command expiry')
    },
    async pruneCommands(before) {
      const { error } = await client
        .from(COMMANDS_TABLE)
        .delete()
        .lt('created_at', before)
        .not('status', 'in', `(${IN_FLIGHT.join(',')})`)
      if (error) throw storeError('command prune')
    },
    async findInFlight(sessionId) {
      const { data, error } = await client
        .from(COMMANDS_TABLE)
        .select('*')
        .eq('session_id', sessionId)
        .in('status', [...IN_FLIGHT])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw storeError('command read')
      return (data as BridgeCommandRow | null) ?? null
    },
    async insertCommand(row) {
      const { data, error } = await client
        .from(COMMANDS_TABLE)
        .insert({ ...row, status: 'pending', attempts: 0 })
        .select('*')
        .single()
      if (error) {
        if ((error as { code?: string }).code === '23505') return 'conflict'
        throw storeError('command insert')
      }
      return data as BridgeCommandRow
    },
    async updateCommand(id, expected, patch) {
      let query = client
        .from(COMMANDS_TABLE)
        .update(patch)
        .eq('id', id)
        .eq('status', expected.status)
      query = expected.leaseToken === null
        ? query.is('lease_token', null)
        : query.eq('lease_token', expected.leaseToken)
      const { data, error } = await query.select('*').maybeSingle()
      if (error) throw storeError('command update')
      return (data as BridgeCommandRow | null) ?? null
    },
  }
}
