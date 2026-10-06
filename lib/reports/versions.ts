/**
 * lib/reports/versions.ts — report_versions (migration 085) on the server's
 * direct Postgres connection (service privileges, like lib/agents/store.ts).
 *
 * Who writes what:
 *   • the `report` agent (through its tools) creates versions in status
 *     'ready' — never 'published' — and supersedes earlier unpublished ones;
 *   • a person in GIGA publishes a 'ready' version (the previous published
 *     one of the same company and type becomes 'superseded'), rejects a
 *     ready one or withdraws a published one. Routes authorise and write the
 *     audit log before calling these functions.
 * The tenant reads published versions through RLS (report_versions_select),
 * not through this module.
 *
 * All transitions are single statements guarded by the expected status, and
 * creation / publication take the same advisory lock as the version-number
 * trigger, so two writers never interleave for one company and report type.
 */
import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'
import type { PointAOverview } from '@/types/point-a-overview'
import type { SnapshotDiagnosticRow, SnapshotFindingRow, SnapshotInputs, SnapshotRecommendationRow } from './snapshot'
import type { ReportContent, ReportProvenance, ReportStatus, ReportType } from './types'

type Tx = Prisma.TransactionClient

const json = (v: unknown) => JSON.stringify(v ?? null)
const iso = (v: Date | string | null | undefined): string | null => (v ? new Date(v).toISOString() : null)

/** Same key as public.report_versions_assign_version(): re-entrant inside one transaction. */
async function lockCompanyType(tx: Tx, companyId: string, reportType: ReportType): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('report_versions:' || ${companyId} || ':' || ${reportType}))`
}

// ─── Snapshot inputs ─────────────────────────────────────────────────────────

export type SnapshotLoad =
  | { ok: true; inputs: Omit<SnapshotInputs, 'generatedAt'> }
  | { ok: false; reason: 'no_session' | 'session_not_ready' | 'no_diagnostic'; message: string }

interface SessionRow {
  id: string
  status: string
  diagnostic_id: string | null
  overview: PointAOverview | null
  completed_at: Date | null
}

/**
 * Everything the snapshot needs, for the company of the task. `sessionId`
 * (from a DIAGNOSTIC_COMPLETED event) must belong to the company and be
 * ready; without it the latest ready Point A session is used.
 */
export async function loadSnapshotInputs(companyId: string, sessionId: string | null): Promise<SnapshotLoad> {
  const sessions = sessionId
    ? await prisma.$queryRaw<SessionRow[]>`
        SELECT id, status, diagnostic_id, overview, completed_at FROM public.diagnostic_sessions
        WHERE id = ${sessionId}::uuid AND company_id = ${companyId}`
    : await prisma.$queryRaw<SessionRow[]>`
        SELECT id, status, diagnostic_id, overview, completed_at FROM public.diagnostic_sessions
        WHERE company_id = ${companyId} AND kind = 'point_a' AND status = 'ready'
        ORDER BY completed_at DESC NULLS LAST LIMIT 1`
  const s = sessions[0]
  if (!s) return { ok: false, reason: 'no_session', message: 'нет завершённой диагностики компании' }
  if (s.status !== 'ready') return { ok: false, reason: 'session_not_ready', message: `сессия диагностики не завершена (${s.status})` }
  if (!s.diagnostic_id) return { ok: false, reason: 'no_diagnostic', message: 'в сессии нет расчёта Точки А' }

  const [diagRows, companyRows, findings, recommendations] = await Promise.all([
    prisma.$queryRaw<Array<SnapshotDiagnosticRow & { calculated_at: Date | string | null }>>`
      SELECT id::text, overall_score::text, health_index::text, stage, finance_score, sales_score, operations_score,
             marketing_score, strategy_score, risks, insights, quick_wins, data_gaps, calculated_at
      FROM public.diagnostics WHERE id = ${s.diagnostic_id}::uuid AND company_id = ${companyId}`,
    prisma.$queryRaw<Array<{ name: string | null; industry: string | null; stage: string | null; size: string | null }>>`
      SELECT name, industry, stage, size FROM public.companies WHERE id = ${companyId}`,
    prisma.$queryRaw<Array<Omit<SnapshotFindingRow, 'reviewed_at'> & { reviewed_at: Date | null }>>`
      SELECT id::text, kind, area, title, body, severity, provenance_type, confidence::text AS confidence, evidence,
             produced_by, model, status, visible_to_client, reviewed_at
      FROM public.diagnostic_findings WHERE company_id = ${companyId} AND status = 'active'`,
    prisma.$queryRaw<Array<Omit<SnapshotRecommendationRow, 'reviewed_at'> & { reviewed_at: Date | null }>>`
      SELECT id::text, area, title, body, expected_impact, effort, priority::int AS priority, horizon_days::int AS horizon_days,
             provenance_type, confidence::text AS confidence, produced_by, model, status, visible_to_client, reviewed_at,
             finding_ids::text[] AS finding_ids
      FROM public.diagnostic_recommendations
      WHERE company_id = ${companyId} AND status IN ('proposed', 'accepted', 'done')`,
  ])
  const d = diagRows[0]
  if (!d) return { ok: false, reason: 'no_diagnostic', message: 'расчёт Точки А сессии не найден' }

  return {
    ok: true,
    inputs: {
      company: companyRows[0] ?? null,
      session: { id: s.id, completed_at: iso(s.completed_at), overview: s.overview },
      diagnostic: { ...d, calculated_at: iso(d.calculated_at) },
      findings: findings.map((f) => ({ ...f, reviewed_at: iso(f.reviewed_at) })),
      recommendations: recommendations.map((r) => ({ ...r, reviewed_at: iso(r.reviewed_at) })),
    },
  }
}

// ─── Versions ────────────────────────────────────────────────────────────────

export interface VersionHead {
  id: string
  version: number
  status: ReportStatus
  data_hash: string
}

export async function latestVersion(companyId: string, reportType: ReportType): Promise<VersionHead | null> {
  const rows = await prisma.$queryRaw<VersionHead[]>`
    SELECT id::text, version, status, data_hash FROM public.report_versions
    WHERE company_id = ${companyId} AND report_type = ${reportType}
    ORDER BY version DESC LIMIT 1`
  return rows[0] ?? null
}

export type CreateVersionResult =
  | { created: true; id: string; version: number; superseded: string[] }
  | { created: false; unchanged: VersionHead }

/**
 * Create a 'ready' version unless the latest version of the company and type
 * already has this data hash (a failed version does not count). Earlier
 * unpublished versions (draft / ready) become 'superseded'; a published
 * version stays until a person publishes the new one.
 */
export async function createReadyVersion(args: {
  companyId: string
  sessionId: string | null
  reportType: ReportType
  title: string
  content: ReportContent
  provenance: ReportProvenance
  confidence: number | null
  dataHash: string
  createdBy: string
}): Promise<CreateVersionResult> {
  return prisma.$transaction(async (tx) => {
    await lockCompanyType(tx, args.companyId, args.reportType)
    const [latest] = await tx.$queryRaw<VersionHead[]>`
      SELECT id::text, version, status, data_hash FROM public.report_versions
      WHERE company_id = ${args.companyId} AND report_type = ${args.reportType}
      ORDER BY version DESC LIMIT 1`
    if (latest && latest.data_hash === args.dataHash && latest.status !== 'failed') {
      return { created: false as const, unchanged: latest }
    }
    const superseded = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE public.report_versions SET status = 'superseded'
      WHERE company_id = ${args.companyId} AND report_type = ${args.reportType} AND status IN ('draft', 'ready')
      RETURNING id::text`
    const confidence = args.confidence === null ? null : Math.min(1, Math.max(0, args.confidence)).toFixed(2)
    const [row] = await tx.$queryRaw<Array<{ id: string; version: number }>>`
      INSERT INTO public.report_versions
        (company_id, session_id, report_type, status, title, content, provenance, confidence, data_hash, created_by)
      VALUES (${args.companyId}, ${args.sessionId}::uuid, ${args.reportType}, 'ready', ${args.title.slice(0, 300)},
              ${json(args.content)}::jsonb, ${json(args.provenance)}::jsonb, ${confidence}::text::numeric,
              ${args.dataHash}, ${args.createdBy})
      RETURNING id::text, version`
    return { created: true as const, id: row.id, version: row.version, superseded: superseded.map((s) => s.id) }
  })
}

// ─── Staff read models (GIGA) ────────────────────────────────────────────────

export interface ReportVersionListItem {
  id: string
  company_id: string
  company_name: string | null
  session_id: string | null
  report_type: ReportType
  version: number
  status: ReportStatus
  title: string
  confidence: number | null
  data_hash: string
  created_by: string
  created_at: string
  published_by: string | null
  published_at: string | null
  agent_key: string | null
  model: string | null
  findings: number
  recommendations: number
  hidden_hypotheses: number | null
  unreviewed_model_recommendations: number | null
  has_narrative: boolean
}

export interface ReportVersionFull extends ReportVersionListItem {
  content: ReportContent
  provenance: ReportProvenance
  pdf_storage_path: string | null
  updated_at: string
}

const n = (v: unknown): number | null => (v == null ? null : Number(v))

function listItem(r: Record<string, unknown>): ReportVersionListItem {
  return {
    id: String(r.id),
    company_id: String(r.company_id),
    company_name: (r.company_name as string | null) ?? null,
    session_id: (r.session_id as string | null) ?? null,
    report_type: r.report_type as ReportType,
    version: Number(r.version),
    status: r.status as ReportStatus,
    title: String(r.title),
    confidence: n(r.confidence),
    data_hash: String(r.data_hash),
    created_by: String(r.created_by),
    created_at: iso(r.created_at as Date)!,
    published_by: (r.published_by as string | null) ?? null,
    published_at: iso(r.published_at as Date | null),
    agent_key: (r.agent_key as string | null) ?? null,
    model: (r.model as string | null) ?? null,
    findings: Number(r.findings ?? 0),
    recommendations: Number(r.recommendations ?? 0),
    hidden_hypotheses: n(r.hidden_hypotheses),
    unreviewed_model_recommendations: n(r.unreviewed_model_recommendations),
    has_narrative: Boolean(r.has_narrative),
  }
}

const LIST_COLUMNS = `
  v.id::text, v.company_id, c.name AS company_name, v.session_id::text, v.report_type, v.version, v.status, v.title,
  v.confidence::text AS confidence, v.data_hash, v.created_by, v.created_at, v.published_by, v.published_at,
  v.provenance ->> 'agent_key' AS agent_key, v.provenance ->> 'model' AS model,
  coalesce(jsonb_array_length(CASE WHEN jsonb_typeof(v.content -> 'findings') = 'array' THEN v.content -> 'findings' END), 0) AS findings,
  coalesce(jsonb_array_length(CASE WHEN jsonb_typeof(v.content -> 'recommendations') = 'array' THEN v.content -> 'recommendations' END), 0) AS recommendations,
  (v.provenance -> 'staff' ->> 'hidden_hypotheses')::int AS hidden_hypotheses,
  (v.provenance -> 'staff' ->> 'unreviewed_model_recommendations')::int AS unreviewed_model_recommendations,
  coalesce(jsonb_typeof(v.content -> 'narrative') = 'object', false) AS has_narrative`

export async function listReportVersions(filter: {
  companyId?: string | null
  status?: ReportStatus | null
  reportType?: ReportType | null
  limit?: number
} = {}): Promise<ReportVersionListItem[]> {
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 200)
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT ${LIST_COLUMNS}
     FROM public.report_versions v LEFT JOIN public.companies c ON c.id = v.company_id
     WHERE ($1::text IS NULL OR v.company_id = $1)
       AND ($2::text IS NULL OR v.status = $2)
       AND ($3::text IS NULL OR v.report_type = $3)
     ORDER BY v.created_at DESC, v.version DESC
     LIMIT $4::text::int`,
    filter.companyId ?? null, filter.status ?? null, filter.reportType ?? null, String(limit),
  )
  return rows.map(listItem)
}

export async function getReportVersion(id: string): Promise<ReportVersionFull | null> {
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT ${LIST_COLUMNS}, v.content, v.provenance, v.pdf_storage_path, v.updated_at
     FROM public.report_versions v LEFT JOIN public.companies c ON c.id = v.company_id
     WHERE v.id = $1::uuid`,
    id,
  )
  const r = rows[0]
  if (!r) return null
  return {
    ...listItem(r),
    content: r.content as ReportContent,
    provenance: r.provenance as ReportProvenance,
    pdf_storage_path: (r.pdf_storage_path as string | null) ?? null,
    updated_at: iso(r.updated_at as Date)!,
  }
}

// ─── Staff transitions ───────────────────────────────────────────────────────

export type TransitionResult =
  | { ok: true; status: ReportStatus; superseded: string[] }
  | { ok: false; reason: 'not_found' | 'wrong_status'; status?: ReportStatus }

async function currentStatus(tx: Tx, id: string): Promise<{ status: ReportStatus; company_id: string; report_type: ReportType } | null> {
  const rows = await tx.$queryRaw<Array<{ status: ReportStatus; company_id: string; report_type: ReportType }>>`
    SELECT status, company_id, report_type FROM public.report_versions WHERE id = ${id}::uuid`
  return rows[0] ?? null
}

/**
 * Publish a 'ready' version to the client. The previously published version
 * of the same company and report type becomes 'superseded' in the same
 * transaction, so the client always sees exactly one.
 */
export async function publishReportVersion(id: string, actorId: string): Promise<TransitionResult> {
  return prisma.$transaction(async (tx) => {
    const head = await currentStatus(tx, id)
    if (!head) return { ok: false as const, reason: 'not_found' as const }
    await lockCompanyType(tx, head.company_id, head.report_type)
    const done = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE public.report_versions SET status = 'published', published_by = ${actorId}, published_at = now()
      WHERE id = ${id}::uuid AND status = 'ready'
      RETURNING id::text`
    if (!done[0]) {
      const again = await currentStatus(tx, id)
      return { ok: false as const, reason: 'wrong_status' as const, status: again?.status }
    }
    const superseded = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE public.report_versions SET status = 'superseded'
      WHERE company_id = ${head.company_id} AND report_type = ${head.report_type}
        AND status = 'published' AND id <> ${id}::uuid
      RETURNING id::text`
    return { ok: true as const, status: 'published' as const, superseded: superseded.map((s) => s.id) }
  })
}

/**
 * Take a version out of circulation: reject a ready / draft one, or withdraw
 * a published one (the client stops seeing it). The decision is kept in
 * provenance.review; the status vocabulary of 085 has no 'rejected'.
 */
export async function retireReportVersion(
  id: string,
  action: 'reject' | 'withdraw',
  actorId: string,
  reason: string,
): Promise<TransitionResult> {
  const from: ReportStatus[] = action === 'reject' ? ['ready', 'draft'] : ['published']
  const review = json({ action, by: actorId, at: new Date().toISOString(), reason: reason.slice(0, 500) })
  return prisma.$transaction(async (tx) => {
    const head = await currentStatus(tx, id)
    if (!head) return { ok: false as const, reason: 'not_found' as const }
    const done = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE public.report_versions
      SET status = 'superseded', provenance = provenance || jsonb_build_object('review', ${review}::jsonb)
      WHERE id = ${id}::uuid AND status = ANY(${from}::text[])
      RETURNING id::text`
    if (!done[0]) return { ok: false as const, reason: 'wrong_status' as const, status: head.status }
    return { ok: true as const, status: 'superseded' as const, superseded: [id] }
  })
}
