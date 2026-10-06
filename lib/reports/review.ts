/**
 * lib/reports/review.ts — staff review of model output before a client sees it
 * (GIGA «Проверка выводов ИИ»).
 *
 * Queue:
 *   • findings with provenance AI_HYPOTHESIS, active, not reviewed yet;
 *   • model recommendations (produced by `…:ai` / with a model id), proposed,
 *     not reviewed yet.
 * Decisions (single guarded UPDATE, so two reviewers never both win):
 *   finding         approve → reviewed_by/at + visible_to_client = true
 *                   dismiss → status 'dismissed', stays hidden
 *   recommendation  approve → status 'accepted' (a person's decision: the
 *                             recommendation agent never replaces it) +
 *                             visible_to_client = true, reviewed_by/at
 *                   dismiss → status 'rejected', stays hidden
 * The route authorises (insights.moderate) and writes the audit log with the
 * reason before calling these functions. Approved items appear in the next
 * report version (the report agent rebuilds the snapshot on demand).
 */
import { prisma } from '@/lib/db'
import { getMetricCategory, isMetricCategoryKey } from '@/lib/metrics/taxonomy'

export type ReviewKind = 'finding' | 'recommendation'
export type ReviewDecision = 'approve' | 'dismiss'

export interface ReviewEvidence {
  type: string
  ref: string
  field: string | null
  value: string | number | null
  quote: string | null
  /** Title of the referenced finding when the evidence points at one. */
  label: string | null
}

export interface ReviewItem {
  kind: ReviewKind
  id: string
  company_id: string
  company_name: string | null
  session_id: string | null
  title: string
  body: string | null
  area: string
  /** Russian label of the area (metric category). */
  area_label: string
  severity: string | null
  finding_kind: string | null
  provenance_type: string
  confidence: number
  produced_by: string
  model: string | null
  prompt_version: string | null
  agent_run_id: string | null
  created_at: string
  /** Findings: their evidence; recommendations: the findings they address. */
  evidence: ReviewEvidence[]
  expected_impact: string | null
  effort: string | null
  priority: number | null
  horizon_days: number | null
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)
const areaLabel = (a: string): string => (isMetricCategoryKey(a) ? getMetricCategory(a).label : a)

function evidenceOf(raw: unknown, titles: Map<string, string>): ReviewEvidence[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .slice(0, 12)
    .map((e) => {
      const ref = String(e.ref ?? '')
      return {
        type: String(e.type ?? ''),
        ref,
        field: str(e.field),
        value: typeof e.value === 'number' ? e.value : str(e.value),
        quote: str(e.quote) ?? str(e.label),
        label: e.type === 'finding' ? titles.get(ref) ?? null : null,
      }
    })
}

export async function listReviewQueue(filter: { companyId?: string | null; limit?: number } = {}): Promise<ReviewItem[]> {
  const companyId = filter.companyId ?? null
  const limit = String(Math.min(Math.max(filter.limit ?? 100, 1), 200))
  const [findings, recs] = await Promise.all([
    prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT f.id::text, f.company_id, c.name AS company_name, f.session_id::text, f.title, f.body, f.area, f.severity,
             f.kind, f.provenance_type, f.confidence::text AS confidence, f.produced_by, f.model, f.prompt_version,
             f.agent_run_id::text, f.created_at, f.evidence
      FROM public.diagnostic_findings f LEFT JOIN public.companies c ON c.id = f.company_id
      WHERE f.status = 'active' AND f.provenance_type = 'AI_HYPOTHESIS' AND f.reviewed_at IS NULL
        AND (${companyId}::text IS NULL OR f.company_id = ${companyId})
      ORDER BY CASE f.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, f.created_at DESC
      LIMIT ${limit}::text::int`,
    prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT r.id::text, r.company_id, c.name AS company_name, r.session_id::text, r.title, r.body, r.area,
             r.provenance_type, r.confidence::text AS confidence, r.produced_by, r.model, r.prompt_version,
             r.agent_run_id::text, r.created_at, r.finding_ids::text[] AS finding_ids, r.expected_impact, r.effort,
             r.priority::int AS priority, r.horizon_days::int AS horizon_days
      FROM public.diagnostic_recommendations r LEFT JOIN public.companies c ON c.id = r.company_id
      WHERE r.status = 'proposed' AND r.reviewed_at IS NULL AND (r.model IS NOT NULL OR r.produced_by LIKE '%:ai')
        AND (${companyId}::text IS NULL OR r.company_id = ${companyId})
      ORDER BY r.priority, r.created_at DESC
      LIMIT ${limit}::text::int`,
  ])

  // Titles of every finding referenced by evidence or by a recommendation.
  const refIds = new Set<string>()
  for (const f of findings) {
    for (const e of Array.isArray(f.evidence) ? (f.evidence as Array<Record<string, unknown>>) : []) {
      if (e?.type === 'finding' && typeof e.ref === 'string') refIds.add(e.ref)
    }
  }
  for (const r of recs) for (const id of (r.finding_ids as string[] | null) ?? []) refIds.add(id)
  const uuids = [...refIds].filter((id) => /^[0-9a-f-]{36}$/i.test(id))
  const titles = new Map<string, string>()
  if (uuids.length) {
    const rows = await prisma.$queryRaw<Array<{ id: string; title: string }>>`
      SELECT id::text, title FROM public.diagnostic_findings WHERE id = ANY(${uuids}::uuid[])`
    for (const r of rows) titles.set(r.id, r.title)
  }

  const items: ReviewItem[] = []
  for (const f of findings) {
    items.push({
      kind: 'finding',
      id: String(f.id),
      company_id: String(f.company_id),
      company_name: (f.company_name as string | null) ?? null,
      session_id: (f.session_id as string | null) ?? null,
      title: String(f.title),
      body: (f.body as string | null) ?? null,
      area: String(f.area),
      area_label: areaLabel(String(f.area)),
      severity: String(f.severity),
      finding_kind: String(f.kind),
      provenance_type: String(f.provenance_type),
      confidence: Number(f.confidence),
      produced_by: String(f.produced_by),
      model: (f.model as string | null) ?? null,
      prompt_version: (f.prompt_version as string | null) ?? null,
      agent_run_id: (f.agent_run_id as string | null) ?? null,
      created_at: new Date(f.created_at as Date).toISOString(),
      evidence: evidenceOf(f.evidence, titles),
      expected_impact: null,
      effort: null,
      priority: null,
      horizon_days: null,
    })
  }
  for (const r of recs) {
    items.push({
      kind: 'recommendation',
      id: String(r.id),
      company_id: String(r.company_id),
      company_name: (r.company_name as string | null) ?? null,
      session_id: (r.session_id as string | null) ?? null,
      title: String(r.title),
      body: (r.body as string | null) ?? null,
      area: String(r.area),
      area_label: areaLabel(String(r.area)),
      severity: null,
      finding_kind: null,
      provenance_type: String(r.provenance_type),
      confidence: Number(r.confidence),
      produced_by: String(r.produced_by),
      model: (r.model as string | null) ?? null,
      prompt_version: (r.prompt_version as string | null) ?? null,
      agent_run_id: (r.agent_run_id as string | null) ?? null,
      created_at: new Date(r.created_at as Date).toISOString(),
      evidence: ((r.finding_ids as string[] | null) ?? []).map((id) => ({
        type: 'finding', ref: id, field: null, value: null, quote: null, label: titles.get(id) ?? null,
      })),
      expected_impact: (r.expected_impact as string | null) ?? null,
      effort: (r.effort as string | null) ?? null,
      priority: r.priority == null ? null : Number(r.priority),
      horizon_days: r.horizon_days == null ? null : Number(r.horizon_days),
    })
  }
  return items
}

export type ReviewResult =
  | { ok: true; kind: ReviewKind; id: string; company_id: string; status: string; visible_to_client: boolean }
  | { ok: false; reason: 'not_found' | 'already_reviewed' }

/** Apply a review decision to a pending item. */
export async function reviewItem(args: {
  kind: ReviewKind
  id: string
  decision: ReviewDecision
  actorId: string
}): Promise<ReviewResult> {
  const approve = args.decision === 'approve'
  const rows = args.kind === 'finding'
    ? await prisma.$queryRaw<Array<{ id: string; company_id: string; status: string; visible_to_client: boolean }>>`
        UPDATE public.diagnostic_findings SET
          reviewed_by = ${args.actorId}, reviewed_at = now(),
          visible_to_client = ${approve},
          status = CASE WHEN ${approve} THEN status ELSE 'dismissed' END
        WHERE id = ${args.id}::uuid AND status = 'active' AND provenance_type = 'AI_HYPOTHESIS' AND reviewed_at IS NULL
        RETURNING id::text, company_id, status, visible_to_client`
    : await prisma.$queryRaw<Array<{ id: string; company_id: string; status: string; visible_to_client: boolean }>>`
        UPDATE public.diagnostic_recommendations SET
          reviewed_by = ${args.actorId}, reviewed_at = now(),
          visible_to_client = ${approve},
          status = CASE WHEN ${approve} THEN 'accepted' ELSE 'rejected' END
        WHERE id = ${args.id}::uuid AND status = 'proposed' AND reviewed_at IS NULL
          AND (model IS NOT NULL OR produced_by LIKE '%:ai')
        RETURNING id::text, company_id, status, visible_to_client`
  const row = rows[0]
  if (row) return { ok: true, kind: args.kind, id: row.id, company_id: row.company_id, status: row.status, visible_to_client: row.visible_to_client }
  const exists = args.kind === 'finding'
    ? await prisma.$queryRaw<Array<{ id: string }>>`SELECT id::text FROM public.diagnostic_findings WHERE id = ${args.id}::uuid`
    : await prisma.$queryRaw<Array<{ id: string }>>`SELECT id::text FROM public.diagnostic_recommendations WHERE id = ${args.id}::uuid`
  return { ok: false, reason: exists[0] ? 'already_reviewed' : 'not_found' }
}

/** Company of a pending/any review item — the audit entry names it before the write. */
export async function reviewItemCompany(kind: ReviewKind, id: string): Promise<{ company_id: string; title: string } | null> {
  const rows = kind === 'finding'
    ? await prisma.$queryRaw<Array<{ company_id: string; title: string }>>`
        SELECT company_id, title FROM public.diagnostic_findings WHERE id = ${id}::uuid`
    : await prisma.$queryRaw<Array<{ company_id: string; title: string }>>`
        SELECT company_id, title FROM public.diagnostic_recommendations WHERE id = ${id}::uuid`
  return rows[0] ?? null
}
