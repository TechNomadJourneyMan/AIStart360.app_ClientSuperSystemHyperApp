/**
 * lib/diagnostics/sessions.ts — diagnostic sessions (085 + 090).
 *
 * A session is one pass of the pipeline over a company. At most one session
 * per company and kind is in flight (unique partial index in 085), so two
 * triggers arriving together never run two pipelines: the second one only
 * marks `rerun_requested`, and the orchestrator decides at the end whether a
 * new pass is needed (inputs changed after the session started).
 *
 * Prisma raw SQL on the server connection (service privileges), like the
 * agent store; testable against the local prod-mirror database.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import type { DiagnosticStageKey, StageRecord } from './pipeline'

export type SessionKind = 'point_a' | 'full' | 'refresh' | 'gri'
export type SessionStatus = 'collecting' | 'processing' | 'ready' | 'failed' | 'cancelled' | 'archived'
export type SessionTrigger = 'manual' | 'event' | 'schedule' | 'agent'

export interface SessionRow {
  id: string
  company_id: string
  kind: SessionKind
  status: SessionStatus
  trigger: SessionTrigger
  initiated_by: string | null
  stage: string | null
  stages: Record<string, StageRecord>
  rerun_requested: boolean
  diagnostic_id: string | null
  completeness: number | null
  sources: Record<string, unknown>
  error: string | null
  started_at: Date
  completed_at: Date | null
  orchestrator_task_id: string | null
}

const COLUMNS = Prisma.sql`id, company_id, kind, status, trigger, initiated_by, stage, stages, rerun_requested,
  diagnostic_id, completeness, sources, error, started_at, completed_at, orchestrator_task_id`

function normalize(r: SessionRow): SessionRow {
  return { ...r, completeness: r.completeness == null ? null : Number(r.completeness) }
}

export const IN_FLIGHT: readonly SessionStatus[] = ['collecting', 'processing']

export async function getSession(id: string): Promise<SessionRow | null> {
  const rows = await prisma.$queryRaw<SessionRow[]>`
    SELECT ${COLUMNS} FROM public.diagnostic_sessions WHERE id = ${id}::uuid`
  return rows[0] ? normalize(rows[0]) : null
}

export async function inFlightSession(companyId: string, kind: SessionKind): Promise<SessionRow | null> {
  const rows = await prisma.$queryRaw<SessionRow[]>`
    SELECT ${COLUMNS} FROM public.diagnostic_sessions
    WHERE company_id = ${companyId} AND kind = ${kind} AND status IN ('collecting', 'processing')
    LIMIT 1`
  return rows[0] ? normalize(rows[0]) : null
}

/**
 * Open a session, or return the one already in flight for the company and
 * kind (then `rerun` marks it so the orchestrator re-runs after finishing).
 */
export async function openSession(args: {
  companyId: string
  kind?: SessionKind
  trigger: SessionTrigger
  initiatedBy: string | null
  orchestratorTaskId: string | null
  rerunIfBusy?: boolean
}): Promise<{ session: SessionRow; created: boolean }> {
  const kind = args.kind ?? 'point_a'
  const rows = await prisma.$queryRaw<SessionRow[]>`
    INSERT INTO public.diagnostic_sessions (company_id, kind, status, trigger, initiated_by, orchestrator_task_id)
    VALUES (${args.companyId}, ${kind}, 'collecting', ${args.trigger}, ${args.initiatedBy}, ${args.orchestratorTaskId}::uuid)
    ON CONFLICT (company_id, kind) WHERE status IN ('collecting', 'processing') DO NOTHING
    RETURNING ${COLUMNS}`
  if (rows[0]) return { session: normalize(rows[0]), created: true }

  const busy = args.rerunIfBusy
    ? await prisma.$queryRaw<SessionRow[]>`
        UPDATE public.diagnostic_sessions SET rerun_requested = TRUE
        WHERE company_id = ${args.companyId} AND kind = ${kind} AND status IN ('collecting', 'processing')
        RETURNING ${COLUMNS}`
    : await prisma.$queryRaw<SessionRow[]>`
        SELECT ${COLUMNS} FROM public.diagnostic_sessions
        WHERE company_id = ${args.companyId} AND kind = ${kind} AND status IN ('collecting', 'processing')`
  if (busy[0]) return { session: normalize(busy[0]), created: false }
  // The in-flight session finished between the two statements: try once more.
  return openSession({ ...args, rerunIfBusy: false })
}

/** Merge a stage record (and optionally session fields). Only in-flight sessions change. */
export async function recordStage(
  sessionId: string,
  stage: DiagnosticStageKey,
  patch: Partial<StageRecord>,
  fields: { completeness?: number | null; sources?: Record<string, unknown>; diagnosticId?: string | null } = {},
): Promise<boolean> {
  const now = new Date().toISOString()
  const stamp: Partial<StageRecord> =
    patch.status === 'running' ? { started_at: now } : patch.status ? { finished_at: now } : {}
  const record = JSON.stringify({ ...stamp, ...patch })
  const completeness = fields.completeness === undefined ? null : fields.completeness
  const n = await prisma.$executeRaw`
    UPDATE public.diagnostic_sessions SET
      status = 'processing',
      stage = ${patch.status === 'running' ? stage : null},
      stages = jsonb_set(stages, ARRAY[${stage}]::text[],
                         coalesce(stages -> ${stage}, '{}'::jsonb) || ${record}::jsonb),
      completeness = CASE WHEN ${fields.completeness !== undefined} THEN ${completeness === null ? null : completeness.toFixed(3)}::text::numeric ELSE completeness END,
      sources = CASE WHEN ${fields.sources !== undefined} THEN ${JSON.stringify(fields.sources ?? {})}::jsonb ELSE sources END,
      diagnostic_id = CASE WHEN ${fields.diagnosticId !== undefined} THEN ${fields.diagnosticId ?? null}::uuid ELSE diagnostic_id END
    WHERE id = ${sessionId}::uuid AND status IN ('collecting', 'processing')`
  return n > 0
}

/** Mark the session ready with the overview snapshot. Returns the row as it was finalised. */
export async function completeSession(
  sessionId: string,
  args: { overview: unknown; completeness: number | null },
): Promise<SessionRow | null> {
  const rows = await prisma.$queryRaw<SessionRow[]>`
    UPDATE public.diagnostic_sessions SET
      status = 'ready', stage = NULL, completed_at = now(), error = NULL,
      overview = ${JSON.stringify(args.overview ?? null)}::jsonb,
      completeness = coalesce(${args.completeness === null ? null : args.completeness.toFixed(3)}::text::numeric, completeness)
    WHERE id = ${sessionId}::uuid AND status IN ('collecting', 'processing')
    RETURNING ${COLUMNS}`
  return rows[0] ? normalize(rows[0]) : null
}

/** End an in-flight session without a result. `status` failed (an error) or cancelled (nothing to do). */
export async function endSession(
  sessionId: string,
  status: 'failed' | 'cancelled',
  error: string,
): Promise<boolean> {
  const n = await prisma.$executeRaw`
    UPDATE public.diagnostic_sessions SET
      status = ${status}, stage = NULL, completed_at = now(), error = ${error.slice(0, 1000)}
    WHERE id = ${sessionId}::uuid AND status IN ('collecting', 'processing')`
  return n > 0
}

/**
 * Fail sessions that can no longer progress: in flight, idle for
 * `idleMinutes`, and none of their tasks is queued, running or waiting for an
 * approval (the chain broke: a task was cancelled, rejected or lost).
 * Returns the ids it failed.
 */
export async function failStalledSessions(idleMinutes = 15): Promise<Array<{ id: string; company_id: string }>> {
  return prisma.$queryRaw<Array<{ id: string; company_id: string }>>`
    UPDATE public.diagnostic_sessions s SET
      status = 'failed', stage = NULL, completed_at = now(),
      error = coalesce(
        (SELECT 'Этап «' || t.agent_key || '» завершился без результата (' || t.status || coalesce(': ' || t.last_error_code, '') || ')'
         FROM public.agent_tasks t WHERE t.session_id = s.id
         ORDER BY t.updated_at DESC LIMIT 1),
        'Пайплайн не продолжился: нет активных задач')
    WHERE s.status IN ('collecting', 'processing')
      AND s.updated_at < now() - make_interval(mins => ${idleMinutes}::int)
      AND NOT EXISTS (
        SELECT 1 FROM public.agent_tasks t
        WHERE t.session_id = s.id AND t.status IN ('queued', 'running', 'awaiting_approval'))
    RETURNING s.id, s.company_id`
}

/**
 * The newest moment any input of the company changed: survey answers of the
 * owner, documents processed, metric values (history records real changes
 * only). Used to decide whether a score is stale and whether a re-run is needed.
 */
export async function lastInputAt(companyId: string): Promise<Date | null> {
  const rows = await prisma.$queryRaw<Array<{ t: Date | null }>>`
    SELECT greatest(
      (SELECT max(sa.answered_at) FROM public.survey_answers sa
         JOIN public.companies c ON c.user_id = sa.user_id
        WHERE c.id = ${companyId} AND sa.step > 0),
      (SELECT max(coalesce(d.processed_at, d.uploaded_at)) FROM public.documents d
        WHERE d.company_id = ${companyId} AND d.parse_status IN ('parsed', 'completed')),
      (SELECT max(h.recorded_at) FROM public.metric_value_history h WHERE h.company_id = ${companyId})
    ) AS t`
  return rows[0]?.t ?? null
}
