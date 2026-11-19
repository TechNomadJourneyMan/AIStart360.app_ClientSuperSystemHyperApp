/**
 * lib/health/platform.ts — the platform checks shared by the public GET /api/health and the staff
 * /intelligence page: a database round-trip and completeness of the critical server environment.
 * Only what is measured is reported; names of missing variables are not exposed here.
 *
 * Readiness (R4-A1, N4A-5 / R-061) — what GET /api/health answers on top of that, on a persistent
 * server (Railway):
 *   • config also counts the variables that tie the services together (lib/env.ts
 *     missingServiceLinkEnv) — by number, never by name;
 *   • inngest — our own Inngest (INNGEST_SELF_HOSTED_URL) in the role that serves functions: the
 *     heartbeat `ops-ping` (lib/functions/ops-ping.ts, every 10 min) is in the journal and younger
 *     than 30 min (with no ping at all: a failure once the watchdog has expected it for 30 min). It proves the whole chain (the server fires the cron, calls the portal, the
 *     portal writes the database) without a call to the Inngest server itself;
 *   • jobs — the in-process cron of this role (CRON_RUNNER_ENABLED=1) has called something in the
 *     last 15 min (public.ops_job_runs, migration 154; with no call at all: a failure once the role
 *     has rows older than 15 min, or — no row of the role at all — once this process has been up
 *     for 15 min).
 *   • schema (N5-1a) — on every server: the newest migration this build ships (NEWEST_MIGRATION,
 *     lib/health/schema-version.ts) is recorded in public.schema_migrations. Not recorded — the
 *     code went out without its migrations (runbook §4: migrations go first) — or no journal table
 *     at all is a failure; a journal that cannot be read while the database answers is 'unknown'.
 *     The public answer says only «schema behind»; which file is expected and which is recorded
 *     last is for staff (GET /api/giga-admin/system/health → schema).
 *   A check whose evidence is not there yet (journal table missing, no row yet after a fresh start)
 *   is 'unknown', never a failure. Every check is bounded (DB_TIMEOUT_MS) and the whole result is
 *   cached for READINESS_CACHE_MS, one computation at a time, so a burst of probes is one query.
 * /api/healthz (Railway's deploy check) stays out of all of this: no database, no network.
 */
import { prisma } from '@/lib/db'
import { getMissingServerEnv, missingServiceLinkEnv } from '@/lib/env'
import { inngestTarget } from '@/lib/inngest-target'
import { isPersistentServer } from '@/lib/runtime/platform'
import { portalRole, servesWeb, type PortalRole } from '@/lib/runtime/role'
import { NEWEST_MIGRATION } from '@/lib/health/schema-version'

export type CheckStatus = 'online' | 'degraded' | 'offline'

export interface PlatformHealth {
  /**
   * status — the latency band (for the /intelligence tiles); reachable — the round trip answered
   * within DB_TIMEOUT_MS. Readiness fails the database only when it is not reachable: a slow
   * answer (the pool queue included) is «degraded», not «down» (R4-A1 review RB-6).
   */
  db: { status: CheckStatus; latencyMs: number; reachable: boolean }
  /** Number of missing critical server env vars (names are not exposed). */
  missingEnv: number
  allOnline: boolean
}

/** Database latency bands: < 150 ms online, < 400 ms degraded, otherwise offline. */
export function dbStatusFor(ok: boolean, latencyMs: number): CheckStatus {
  if (!ok) return 'offline'
  return latencyMs < 150 ? 'online' : latencyMs < 400 ? 'degraded' : 'offline'
}

/** No single check of the readiness may take longer. */
export const DB_TIMEOUT_MS = 3_000
export const READINESS_CACHE_MS = 15_000
/** ops-ping runs every 10 min: three missed in a row. */
export const INNGEST_HEARTBEAT_MAX_MS = 30 * 60_000
/** The busiest cron of a role runs at least every 5 min (web) or every minute (agents). */
export const JOBS_FRESH_MAX_MS = 15 * 60_000

function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}: no answer in ${ms} ms`)), ms)
      ;(timer as { unref?: () => void }).unref?.()
    }),
  ]).finally(() => clearTimeout(timer))
}

export async function checkPlatformHealth(): Promise<PlatformHealth> {
  const t = Date.now()
  let ok = true
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, DB_TIMEOUT_MS, 'database')
  } catch (err) {
    console.error('[health] database check failed:', err instanceof Error ? err.message : err)
    ok = false
  }
  const latencyMs = Date.now() - t
  const db = { status: dbStatusFor(ok, latencyMs), latencyMs, reachable: ok }
  const missingEnv = getMissingServerEnv().length
  return { db, missingEnv, allOnline: db.status === 'online' && missingEnv === 0 }
}

// ─── Readiness ───────────────────────────────────────────────────────────────

/** off — not this process's business; unknown — no evidence yet (never a failure). */
export type ReadinessCheck = 'ok' | 'fail' | 'unknown' | 'off'

export interface Readiness extends PlatformHealth {
  inngest: ReadinessCheck
  jobs: ReadinessCheck
  /** N5-1a: the newest migration of the build is in the journal. Never 'off'. */
  schema: Exclude<ReadinessCheck, 'off'>
}

// ─── Schema (N5-1a) ──────────────────────────────────────────────────────────

export interface SchemaStatus {
  /** The newest migration this build ships. */
  expected: string
  /** public.schema_migrations exists. */
  journal: boolean
  /** `expected` is recorded there. */
  applied: boolean
  /** The newest file recorded (by name: NNN_ sorts by number); null without a journal or rows. */
  latestRecorded: string | null
}

/** Reads the journal for the build's newest migration. Throws when the database does. */
export async function schemaStatus(expected: string = NEWEST_MIGRATION): Promise<SchemaStatus> {
  const [t] = await prisma.$queryRaw<Array<{ journal: boolean }>>`
    SELECT to_regclass('public.schema_migrations') IS NOT NULL AS journal`
  if (!t?.journal) return { expected, journal: false, applied: false, latestRecorded: null }
  const [r] = await prisma.$queryRaw<Array<{ applied: boolean; latest: string | null }>>`
    SELECT EXISTS (SELECT 1 FROM public.schema_migrations WHERE file = ${expected}) AS applied,
           (SELECT max(file) FROM public.schema_migrations) AS latest`
  return { expected, journal: true, applied: r?.applied === true, latestRecorded: r?.latest ?? null }
}

/** The readiness verdict of a schema status. Pure. */
export function judgeSchema(s: SchemaStatus | null): Exclude<ReadinessCheck, 'off'> {
  if (!s) return 'unknown'
  return s.journal && s.applied ? 'ok' : 'fail'
}

type Env = Partial<NodeJS.ProcessEnv>

export interface JournalEvidence {
  /** The last cron call of this role (claim failures left out). */
  lastCron: Date | null
  /** The oldest row of this role in the journal: before it the cron of the role could not have written. */
  roleSince: Date | null
  /** The last successful ops-ping. */
  lastPing: Date | null
  /** Since when the watchdog expects ops-ping (ops_job_expectations); null — not noted yet. */
  pingExpectedSince: Date | null
}

/** Which of the journal checks apply to this process. */
export function readinessScope(env: Env = process.env): { inngest: boolean; jobs: boolean; role: PortalRole } {
  const role = portalRole(env)
  if (!isPersistentServer(env)) return { inngest: false, jobs: false, role }
  return {
    inngest: servesWeb(role) && inngestTarget(env as NodeJS.ProcessEnv).selfHostedUrl !== null,
    jobs: env.CRON_RUNNER_ENABLED === '1',
    role,
  }
}

/**
 * The journal checks from the evidence. Pure.
 * `processStartedAt` (R4-A1 verify NV-3): the jobs check runs in the very process whose cron it
 * judges, so a role with no row at all is judged from the start of this process — a runner that is
 * switched on but has written nothing for 15 minutes since the start is a failure, not «unknown»
 * forever. The first start after a deploy is covered: the busiest cron of a role writes within
 * 5 minutes (web) or 1 minute (agents).
 */
export function judgeJournal(
  e: JournalEvidence | null,
  scope: { inngest: boolean; jobs: boolean },
  now: Date,
  processStartedAt: Date | null = null,
): { inngest: ReadinessCheck; jobs: ReadinessCheck } {
  const age = (d: Date | null) => (d ? now.getTime() - d.getTime() : 0)
  /** `since`: from when the evidence could exist; without it (nothing noted yet) there is no verdict. */
  const judge = (last: Date | null, since: Date | null, maxMs: number): ReadinessCheck => {
    if (!e) return 'unknown'
    if (last) return age(last) <= maxMs ? 'ok' : 'fail'
    // Nothing yet: just migrated, a new role, ops-ping new in this release — not had the chance.
    return since && age(since) > maxMs ? 'fail' : 'unknown'
  }
  return {
    inngest: scope.inngest ? judge(e?.lastPing ?? null, e?.pingExpectedSince ?? null, INNGEST_HEARTBEAT_MAX_MS) : 'off',
    jobs: scope.jobs ? judge(e?.lastCron ?? null, e?.roleSince ?? processStartedAt, JOBS_FRESH_MAX_MS) : 'off',
  }
}

/** null — the journal table does not exist here (migration 154 not applied). */
async function loadJournalEvidence(role: PortalRole): Promise<JournalEvidence | null> {
  const rows = await prisma.$queryRaw<Array<{ present: boolean; expectations: boolean }>>`
    SELECT to_regclass('public.ops_job_runs') IS NOT NULL AS present,
           to_regclass('public.ops_job_expectations') IS NOT NULL AS expectations`
  if (!rows[0]?.present) return null
  const [r] = await prisma.$queryRaw<Array<{ last_cron: Date | null; role_since: Date | null; last_ping: Date | null }>>`
    SELECT
      (SELECT max(finished_at) FROM public.ops_job_runs
        WHERE kind = 'cron' AND service = ${role} AND status <> 'claim_failed'
          AND finished_at > now() - interval '1 day') AS last_cron,
      (SELECT min(finished_at) FROM public.ops_job_runs WHERE kind = 'cron' AND service = ${role}) AS role_since,
      (SELECT max(finished_at) FROM public.ops_job_runs
        WHERE job = 'inngest:ops-ping' AND status = 'ok' AND finished_at > now() - interval '1 day') AS last_ping`
  const [x] = rows[0].expectations
    ? await prisma.$queryRaw<Array<{ since: Date | null }>>`
        SELECT first_expected_at AS since FROM public.ops_job_expectations WHERE job = 'inngest:ops-ping'`
    : []
  return { lastCron: r?.last_cron ?? null, roleSince: r?.role_since ?? null, lastPing: r?.last_ping ?? null, pingExpectedSince: x?.since ?? null }
}

export interface ReadinessDeps {
  env?: Env
  now?: () => Date
  /** When this process started. Default: now minus process.uptime(). */
  processStartedAt?: () => Date
  platform?: () => Promise<PlatformHealth>
  journal?: (role: PortalRole) => Promise<JournalEvidence | null>
  schema?: () => Promise<SchemaStatus>
}

async function computeReadiness(deps: ReadinessDeps): Promise<Readiness> {
  const env = deps.env ?? process.env
  const scope = readinessScope(env)
  const needJournal = scope.inngest || scope.jobs
  const [platform, journal, schema] = await Promise.all([
    (deps.platform ?? checkPlatformHealth)(),
    needJournal
      ? withTimeout((deps.journal ?? loadJournalEvidence)(scope.role), DB_TIMEOUT_MS, 'journal').then(
          (e) => ({ ok: true as const, e }),
          (err: unknown) => {
            console.error('[health] journal check failed:', err instanceof Error ? err.message : err)
            return { ok: false as const }
          },
        )
      : Promise.resolve({ ok: true as const, e: null }),
    // A journal that cannot be read says nothing about the schema: 'unknown' (with the database down
    // the db check already fails).
    withTimeout((deps.schema ?? schemaStatus)(), DB_TIMEOUT_MS, 'schema').catch((err: unknown) => {
      console.error('[health] schema check failed:', err instanceof Error ? err.message : err)
      return null
    }),
  ])
  const schemaCheck = judgeSchema(schema)
  // A journal that cannot be read while the database answers is a failure of those checks; with
  // the database down the db check already fails, and the journal says nothing more.
  const judged = journal.ok
    ? judgeJournal(
        journal.e,
        scope,
        (deps.now ?? (() => new Date()))(),
        (deps.processStartedAt ?? (() => new Date(Date.now() - process.uptime() * 1000)))(),
      )
    : { inngest: scope.inngest ? ('unknown' as const) : ('off' as const), jobs: scope.jobs ? ('unknown' as const) : ('off' as const) }
  const missingEnv = platform.missingEnv + missingServiceLinkEnv(env).length
  return {
    ...platform,
    missingEnv,
    allOnline: platform.db.status === 'online' && missingEnv === 0 && judged.inngest !== 'fail' && judged.jobs !== 'fail' && schemaCheck !== 'fail',
    ...judged,
    schema: schemaCheck,
  }
}

const CACHE_KEY = Symbol.for('aistart360.health.readiness')
type CacheSlot = { at: number; value?: Readiness; pending?: Promise<Readiness> }

/** For tests: forget the cached readiness. */
export function resetReadinessCache(): void {
  delete (globalThis as Record<symbol, CacheSlot | undefined>)[CACHE_KEY]
}

/**
 * The readiness of this process, cached for READINESS_CACHE_MS; callers that arrive while it is
 * being computed share that computation.
 */
export async function checkReadiness(deps: ReadinessDeps = {}): Promise<Readiness> {
  const g = globalThis as Record<symbol, CacheSlot | undefined>
  const now = Date.now()
  const slot = g[CACHE_KEY]
  if (slot?.value && now - slot.at < READINESS_CACHE_MS) return slot.value
  if (slot?.pending) return slot.pending
  const pending = computeReadiness(deps)
  g[CACHE_KEY] = { at: slot?.at ?? 0, value: slot?.value, pending }
  try {
    const value = await pending
    g[CACHE_KEY] = { at: Date.now(), value }
    return value
  } catch (error) {
    g[CACHE_KEY] = slot?.value ? { at: slot.at, value: slot.value } : undefined
    throw error
  }
}
