/**
 * Rate limiting shared by every serverless instance.
 *
 * Store (picked once per process, see selectBackend):
 *   1. Upstash Redis — when UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set;
 *   2. Postgres — public.rate_limit_hit() (migration 100) through Prisma;
 *   3. in-memory — ONLY outside production (dev without a DB, tests).
 * RATE_LIMIT_BACKEND=upstash|postgres|memory forces a store ("memory" is
 * ignored in production).
 *
 * All stores implement the same sliding window (previous fixed window weighted
 * by its overlap; only allowed hits count), so limits behave alike everywhere.
 *
 * Identifiers (user id, IP, chat id) are HMAC-hashed before they reach a
 * store: keys look like '<bucket>:<hash>'.
 *
 * When the store fails:
 *   - outside production → the in-memory store answers (and the error is logged);
 *   - in production → fail-closed buckets refuse (reason 'unavailable'),
 *     fail-open buckets allow. Every bucket is fail-closed unless it is in
 *     FAIL_OPEN_BUCKETS (low-risk telemetry / UI preferences) or the caller
 *     passes `failClosed: false`. RATE_LIMIT_FAIL_OPEN=1 is an emergency
 *     switch that makes every bucket fail open.
 *   Errors are logged at most once per backend per 10 minutes, without keys.
 *
 * Public API (kept for the existing call sites): isRateLimited, isRateLimitedKey,
 * clientIp, authRateLimit. New: checkRateLimit / checkRateLimitForRequest return
 * the full decision, rateLimitResponse builds the 429 (or 503) with Retry-After,
 * pruneRateLimits deletes expired Postgres rows (maintenance cron).
 */
import { createHmac } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createMemoryStore, type MemoryStore } from './rate-limit/memory'
import { createPostgresStore, prunePostgres } from './rate-limit/postgres'
import { createUpstashStore, upstashConfigured } from './rate-limit/upstash'
import type { RateLimitBackend, RateLimitStore, StoreDecision } from './rate-limit/types'

export type { RateLimitBackend } from './rate-limit/types'

const DEFAULT_WINDOW_MS = 60_000
const DEFAULT_MAX = 10
/** Retry-After for a refusal caused by an unavailable store. */
const UNAVAILABLE_RETRY_SECONDS = 30
const ERROR_LOG_EVERY_MS = 10 * 60_000
const PRUNE_EVERY_MS = 15 * 60_000

export interface RateLimitOptions {
  /** Hits allowed per sliding window (default 10). */
  max?: number
  /** Window length in ms (default 60 000; rounded to whole seconds, min 1 s). */
  windowMs?: number
  /**
   * What to do in production when the store is unavailable: true = refuse,
   * false = allow. Default: true, except for FAIL_OPEN_BUCKETS.
   */
  failClosed?: boolean
}

export interface RateLimitResult {
  limited: boolean
  /** 'limit' = over the limit; 'unavailable' = refused because the store failed (fail-closed). */
  reason: 'ok' | 'limit' | 'unavailable'
  limit: number
  remaining: number
  retryAfterSeconds: number
  backend: RateLimitBackend
}

/**
 * Low-risk buckets that stay available when the store is down: telemetry,
 * UI preferences, reads of the caller's own data and autosaves of it.
 * Unknown buckets fail closed on purpose, so a new route is protected without
 * opting in. Everything else —
 * auth, registration, 2FA/MFA, AI, MCP, bots, webhooks, uploads, admin
 * actions, outgoing messages — fails closed.
 */
export const FAIL_OPEN_BUCKETS: ReadonlySet<string> = new Set([
  'events',
  'nba-event',
  'consents-put',
  'survey-save',
  'action-plan-patch',
  'pulse-briefing',
  'nba-get',
  'next-best-action',
  'psych-post',
  'assistant:context',
  'assistant:events',
  'assistant:feedback',
  'assistant:hide',
  'assistant:settings',
  'assistant:settings:write',
])

// ── Helpers ─────────────────────────────────────────────────────────────────

export function clientIp(req: Request): string {
  const h = req.headers
  const value = (
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    h.get('x-real-ip')?.trim() ||
    'unknown'
  )
  return value.length > 0 && value.length <= 64 ? value : 'unknown'
}

function truthy(v: string | undefined): boolean {
  return /^(1|true|on|yes)$/i.test(v?.trim() ?? '')
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production'
}

let hashSecret: string | null = null
function getHashSecret(): string {
  if (hashSecret === null) {
    const explicit = process.env.RATE_LIMIT_HASH_SECRET?.trim()
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
    hashSecret = explicit
      || (serviceKey ? createHmac('sha256', serviceKey).update('aistart360:rate-limit:v1').digest('base64url') : '')
      || 'aistart360:rate-limit:v1'
  }
  return hashSecret
}

/** HMAC of an identifier: stores never see raw user ids / IPs / chat ids. */
export function hashIdentifier(identifier: string): string {
  return createHmac('sha256', getHashSecret()).update(identifier).digest('base64url').slice(0, 32)
}

function storeKey(bucket: string, identifier: string): string {
  const safeBucket = bucket.replace(/[^A-Za-z0-9:_.-]/g, '_').slice(0, 64) || 'default'
  return `${safeBucket}:${hashIdentifier(identifier)}`
}

export function isFailClosed(bucket: string, opts: Pick<RateLimitOptions, 'failClosed'> = {}): boolean {
  if (truthy(process.env.RATE_LIMIT_FAIL_OPEN)) return false
  if (typeof opts.failClosed === 'boolean') return opts.failClosed
  return !FAIL_OPEN_BUCKETS.has(bucket)
}

/** Which store this process uses, from the environment. */
export function selectBackend(env: NodeJS.ProcessEnv = process.env): RateLimitBackend {
  const production = env.NODE_ENV === 'production'
  const forced = env.RATE_LIMIT_BACKEND?.trim().toLowerCase()
  if (forced === 'upstash' && upstashConfigured(env)) return 'upstash'
  if (forced === 'postgres') return 'postgres'
  if (forced === 'memory' && !production) return 'memory'
  if (upstashConfigured(env)) return 'upstash'
  if (production) return 'postgres'
  if (env.NODE_ENV === 'test' || env.VITEST) return 'memory'
  return env.DATABASE_URL ? 'postgres' : 'memory'
}

// ── Store state ─────────────────────────────────────────────────────────────

let store: RateLimitStore | null = null
let memoryStore: MemoryStore | null = null
let lastPruneAt = 0
const lastErrorLog = new Map<string, { at: number; suppressed: number }>()

function getMemoryStore(): MemoryStore {
  memoryStore ??= createMemoryStore()
  return memoryStore
}

function getStore(): RateLimitStore {
  if (!store) {
    const backend = selectBackend()
    store = backend === 'upstash' ? createUpstashStore()
      : backend === 'postgres' ? createPostgresStore()
        : getMemoryStore()
  }
  return store
}

/** Test hook: use `s` as the store (null = re-select from env on next call). */
export function __setRateLimitStoreForTests(s: RateLimitStore | null): void {
  store = s
  memoryStore = null
  hashSecret = null
  lastPruneAt = 0
  lastErrorLog.clear()
}

function logStoreError(backend: RateLimitBackend, key: string, err: unknown): void {
  const now = Date.now()
  const prev = lastErrorLog.get(backend)
  if (prev && now - prev.at < ERROR_LOG_EVERY_MS) {
    prev.suppressed += 1
    return
  }
  lastErrorLog.set(backend, { at: now, suppressed: 0 })
  const name = err instanceof Error ? err.name : typeof err
  const code = (err as { code?: unknown } | null)?.code
  const raw = err instanceof Error ? err.message : String(err)
  const message = (key ? raw.split(key).join('<key>') : raw).slice(0, 200)
  console.error(
    `[rate-limit] ${backend} store unavailable` +
    `${prev?.suppressed ? ` (${prev.suppressed} more since last log)` : ''}: ` +
    `${name}${typeof code === 'string' ? ` ${code}` : ''} ${message}`,
  )
}

function maybePrune(backend: RateLimitBackend): void {
  if (backend !== 'postgres') return
  const now = Date.now()
  if (now - lastPruneAt < PRUNE_EVERY_MS) return
  lastPruneAt = now
  prunePostgres(5_000).catch(() => { /* the maintenance cron prunes too */ })
}

// ── Core ────────────────────────────────────────────────────────────────────

function toResult(d: StoreDecision, max: number, backend: RateLimitBackend): RateLimitResult {
  return {
    limited: !d.allowed,
    reason: d.allowed ? 'ok' : 'limit',
    limit: max,
    remaining: d.remaining,
    retryAfterSeconds: d.allowed ? 0 : Math.max(1, d.retryAfterSeconds),
    backend,
  }
}

/**
 * Count one hit of `identifier` in `bucket` and return the decision.
 * Prefer a stable identifier (session user id) for authenticated endpoints.
 */
export async function checkRateLimit(
  identifier: string,
  bucket: string,
  opts: RateLimitOptions = {},
): Promise<RateLimitResult> {
  const max = Math.max(1, Math.floor(opts.max ?? DEFAULT_MAX))
  const windowSeconds = Math.max(1, Math.round((opts.windowMs ?? DEFAULT_WINDOW_MS) / 1000))
  const key = storeKey(bucket, identifier || 'unknown')
  const s = getStore()
  try {
    const d = await s.hit(key, windowSeconds, max)
    maybePrune(s.backend)
    return toResult(d, max, s.backend)
  } catch (err) {
    logStoreError(s.backend, key, err)
    if (!isProduction() && s.backend !== 'memory') {
      return toResult(await getMemoryStore().hit(key, windowSeconds, max), max, 'memory')
    }
    if (isFailClosed(bucket, opts)) {
      return { limited: true, reason: 'unavailable', limit: max, remaining: 0, retryAfterSeconds: UNAVAILABLE_RETRY_SECONDS, backend: s.backend }
    }
    return { limited: false, reason: 'ok', limit: max, remaining: max, retryAfterSeconds: 0, backend: s.backend }
  }
}

/** checkRateLimit keyed by the client IP. */
export function checkRateLimitForRequest(
  req: Request,
  bucket: string,
  opts: RateLimitOptions = {},
): Promise<RateLimitResult> {
  return checkRateLimit(clientIp(req), bucket, opts)
}

/**
 * Enforce a rate limit for `bucket`, keyed by client IP. Returns true when the
 * request should be rejected (429).
 */
export async function isRateLimited(
  req: Request,
  bucket: string,
  opts: RateLimitOptions = {},
): Promise<boolean> {
  return (await checkRateLimitForRequest(req, bucket, opts)).limited
}

/**
 * Like `isRateLimited` but keyed by an explicit identifier (e.g. the session
 * user id) instead of the client IP. Preferred for authenticated, expensive
 * endpoints (paid AI calls) where per-user throttling is more meaningful and
 * can't be evaded by rotating IPs.
 */
export async function isRateLimitedKey(
  identifier: string,
  bucket: string,
  opts: RateLimitOptions = {},
): Promise<boolean> {
  return (await checkRateLimit(identifier, bucket, opts)).limited
}

/** Retry-After / X-RateLimit-* headers for a decision. */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
  }
  if (result.limited) headers['Retry-After'] = String(result.retryAfterSeconds)
  return headers
}

/**
 * Standard refusal: 429 + Retry-After when over the limit, 503 + Retry-After
 * when a fail-closed bucket could not be checked.
 */
export function rateLimitResponse(
  result: RateLimitResult,
  message = 'Слишком много запросов. Попробуйте позже.',
): NextResponse {
  const unavailable = result.reason === 'unavailable'
  return NextResponse.json(
    { ok: false, error: message, code: unavailable ? 'RATE_LIMIT_UNAVAILABLE' : 'RATE_LIMITED' },
    { status: unavailable ? 503 : 429, headers: rateLimitHeaders(result) },
  )
}

/**
 * Back-compat for callers written against @upstash/ratelimit
 * (`authRateLimit.limit(key)` → `{ success }`): 10 hits per minute in the
 * fail-closed 'auth' bucket, on whichever store is active. Never null now.
 */
export const authRateLimit = {
  async limit(identifier: string): Promise<{ success: boolean; remaining: number; reset: number }> {
    const r = await checkRateLimit(identifier, 'auth', { max: 10, windowMs: 60_000, failClosed: true })
    return { success: !r.limited, remaining: r.remaining, reset: Date.now() + r.retryAfterSeconds * 1000 }
  },
}

/**
 * Delete expired Postgres counter rows (bounded batch). No-op for other
 * stores (Redis keys expire by themselves). Never throws.
 */
export async function pruneRateLimits(limit = 10_000): Promise<number> {
  if (getStore().backend !== 'postgres') return 0
  try {
    return await prunePostgres(limit)
  } catch (err) {
    logStoreError('postgres', '', err)
    return 0
  }
}
