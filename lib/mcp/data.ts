/**
 * lib/mcp/data.ts — read models of the MCP tools (server Postgres connection,
 * like lib/telegram/bots/data.ts and lib/agents/admin.ts). Callers authorise
 * first (lib/mcp/server.ts: credential → current role → scope); this module
 * applies the data rules every tool shares:
 *   - only CLIENT companies: owner profile is a client (or legacy owner) and
 *     not staff — the expert-portal rule of lib/admin/user-data-access.ts;
 *   - contacts are masked without the PII scope (lib/mcp/pii.ts);
 *   - unreviewed AI hypotheses are never listed;
 *   - every list is bounded (limit ≤ 50) and paged by an opaque cursor.
 */
import { prisma } from '@/lib/db'
import { contactEmail, contactPhone, freeText } from './pii'

const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : null)

export const COMPANY_ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ─── Cursors ─────────────────────────────────────────────────────────────────

export const MAX_OFFSET = 10_000

export function encodeOffsetCursor(offset: number): string {
  return Buffer.from(`o:${offset}`).toString('base64url')
}

/** 0 for no cursor; null for a malformed one. */
export function decodeOffsetCursor(cursor: string | undefined | null): number | null {
  if (!cursor) return 0
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(cursor)) return null
  const m = Buffer.from(cursor, 'base64url').toString('utf8').match(/^o:(\d{1,6})$/)
  const n = m ? Number(m[1]) : NaN
  return Number.isInteger(n) && n >= 0 && n <= MAX_OFFSET ? n : null
}

// ─── Client companies ────────────────────────────────────────────────────────

/** Is this a client company (visible through MCP)? */
export async function clientCompanyExists(companyId: string): Promise<boolean> {
  if (!COMPANY_ID_RE.test(companyId)) return false
  const rows = await prisma.$queryRaw<Array<{ ok: boolean }>>`
    SELECT true AS ok FROM public.companies c LEFT JOIN public.profiles p ON p.id = c.user_id
    WHERE c.id = ${companyId}
      AND (c.user_id IS NULL OR (p.role IN ('client', 'owner')
           AND NOT EXISTS (SELECT 1 FROM public.staff_roles s WHERE s.user_id = c.user_id)))`
  return rows.length > 0
}

export interface ClientListItem {
  company_id: string
  company_name: string
  industry: string | null
  stage: string | null
  owner: { user_id: string; full_name: string | null; email: string | null; status: string | null } | null
  overall_score: number | null
  diagnostic_at: string | null
}

/**
 * Search client companies by company name or owner name; by e-mail too, but
 * only for callers who may see e-mails (otherwise a hit would confirm an
 * address the caller cannot read).
 */
export async function searchClients(p: { query: string | null; pii: boolean; limit: number; offset: number }): Promise<{ items: ClientListItem[]; hasMore: boolean }> {
  const term = p.query?.trim().slice(0, 80) || null
  const pat = term ? like(term) : null
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT c.id, c.name, c.industry, c.stage, p.id::text AS owner_id, p.full_name, p.email, p.status AS owner_status,
           d.overall_score::float AS score, d.calculated_at
    FROM public.companies c
    LEFT JOIN public.profiles p ON p.id = c.user_id
    LEFT JOIN LATERAL (
      SELECT overall_score, calculated_at FROM public.diagnostics
      WHERE company_id = c.id AND is_current ORDER BY calculated_at DESC LIMIT 1
    ) d ON true
    WHERE (c.user_id IS NULL OR (p.role IN ('client', 'owner')
           AND NOT EXISTS (SELECT 1 FROM public.staff_roles s WHERE s.user_id = c.user_id)))
      AND (${term}::text IS NULL
           OR c.name ILIKE ${pat}
           OR p.full_name ILIKE ${pat}
           OR (${p.pii} AND (p.email ILIKE ${pat} OR c.contact_email ILIKE ${pat})))
    ORDER BY c.updated_at DESC NULLS LAST, c.id
    LIMIT ${p.limit + 1} OFFSET ${p.offset}`
  return {
    items: rows.slice(0, p.limit).map((r) => ({
      company_id: String(r.id),
      company_name: String(r.name),
      industry: (r.industry as string | null) ?? null,
      stage: (r.stage as string | null) ?? null,
      owner: r.owner_id
        ? { user_id: String(r.owner_id), full_name: (r.full_name as string | null) ?? null, email: contactEmail(r.email as string | null, p.pii), status: (r.owner_status as string | null) ?? null }
        : null,
      overall_score: num(r.score),
      diagnostic_at: iso(r.calculated_at),
    })),
    hasMore: rows.length > p.limit,
  }
}

function areaScore(v: unknown): number | null {
  if (typeof v === 'number' || typeof v === 'string') return num(v)
  if (v && typeof v === 'object') return num((v as Record<string, unknown>).score ?? (v as Record<string, unknown>).value)
  return null
}

function gapList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((g) => (typeof g === 'string' ? g : g && typeof g === 'object'
      ? String((g as Record<string, unknown>).label ?? (g as Record<string, unknown>).field ?? (g as Record<string, unknown>).key ?? '')
      : ''))
    .filter(Boolean)
    .slice(0, 10)
    .map((s) => s.slice(0, 200))
}

/** Card of a client: company, owner, contact person, current diagnostic, latest session, counts. */
export async function clientCard(p: { companyId?: string; userId?: string; pii: boolean }): Promise<Record<string, unknown> | null> {
  if (p.companyId !== undefined && !COMPANY_ID_RE.test(p.companyId)) return null
  if (p.userId !== undefined && !UUID_RE.test(p.userId)) return null
  const companyId = p.companyId ?? null
  const userId = p.userId ?? null
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT c.id, c.name, c.industry, c.stage, c.size, c.employee_count, c.business_model, c.regions, c.domain,
           c.founded_at, c.target_revenue_12m_kzt::float AS target_12m, c.target_revenue_3y_kzt::float AS target_3y,
           c.contact_name, c.contact_position, c.contact_email, c.contact_phone, c.created_at AS company_created_at,
           p.id::text AS owner_id, p.full_name, p.email, p.phone, p.status AS owner_status, p.organization,
           p.created_at AS owner_created_at, p.last_seen_at
    FROM public.companies c
    LEFT JOIN public.profiles p ON p.id = c.user_id
    WHERE ((${companyId}::text IS NOT NULL AND c.id = ${companyId})
           OR (${companyId}::text IS NULL AND ${userId}::text IS NOT NULL AND c.user_id = ${userId}::uuid))
      AND (c.user_id IS NULL OR (p.role IN ('client', 'owner')
           AND NOT EXISTS (SELECT 1 FROM public.staff_roles s WHERE s.user_id = c.user_id)))
    LIMIT 1`
  const c = rows[0]
  if (!c) return null
  const id = String(c.id)
  const [diag] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT overall_score::float AS score, health_index::float AS health, stage, finance_score, sales_score,
           operations_score, marketing_score, strategy_score, data_gaps, calculated_at
    FROM public.diagnostics WHERE company_id = ${id} AND is_current ORDER BY calculated_at DESC LIMIT 1`
  const [sess] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT id::text, kind, status, completeness::float AS completeness, started_at, completed_at
    FROM public.diagnostic_sessions WHERE company_id = ${id} ORDER BY started_at DESC LIMIT 1`
  const findings = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT id::text, kind, area, title, severity, provenance_type, confidence::float AS confidence, reviewed_at IS NOT NULL AS reviewed
    FROM public.diagnostic_findings
    WHERE company_id = ${id} AND status = 'active' AND severity IN ('critical', 'high')
      AND (provenance_type <> 'AI_HYPOTHESIS' OR reviewed_at IS NOT NULL)
    ORDER BY CASE severity WHEN 'critical' THEN 0 ELSE 1 END, created_at DESC LIMIT 8`
  const [counts] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT
      (SELECT count(*)::int FROM public.diagnostic_findings WHERE company_id = ${id} AND status = 'active' AND severity = 'critical'
         AND (provenance_type <> 'AI_HYPOTHESIS' OR reviewed_at IS NOT NULL)) AS critical,
      (SELECT count(*)::int FROM public.report_versions WHERE company_id = ${id} AND status = 'published') AS published_reports,
      (SELECT count(*)::int FROM public.diagnostic_sessions WHERE company_id = ${id}) AS sessions`
  return {
    company: {
      company_id: id,
      name: String(c.name),
      industry: (c.industry as string | null) ?? null,
      stage: (c.stage as string | null) ?? null,
      size: (c.size as string | null) ?? null,
      employee_count: num(c.employee_count),
      business_model: (c.business_model as string | null) ?? null,
      regions: Array.isArray(c.regions) ? (c.regions as string[]).slice(0, 20) : [],
      website: (c.domain as string | null) ?? null,
      founded_at: iso(c.founded_at),
      target_revenue_12m_kzt: num(c.target_12m),
      target_revenue_3y_kzt: num(c.target_3y),
      created_at: iso(c.company_created_at),
    },
    contact_person: c.contact_name || c.contact_email || c.contact_phone ? {
      name: (c.contact_name as string | null) ?? null,
      position: (c.contact_position as string | null) ?? null,
      email: contactEmail(c.contact_email as string | null, p.pii),
      phone: contactPhone(c.contact_phone as string | null, p.pii),
    } : null,
    owner: c.owner_id ? {
      user_id: String(c.owner_id),
      full_name: (c.full_name as string | null) ?? null,
      email: contactEmail(c.email as string | null, p.pii),
      phone: contactPhone(c.phone as string | null, p.pii),
      organization: (c.organization as string | null) ?? null,
      status: (c.owner_status as string | null) ?? null,
      registered_at: iso(c.owner_created_at),
      last_seen_at: iso(c.last_seen_at),
    } : null,
    current_diagnostic: diag ? {
      overall_score: num(diag.score),
      health_index: num(diag.health),
      stage: (diag.stage as string | null) ?? null,
      area_scores: {
        finance: areaScore(diag.finance_score),
        sales: areaScore(diag.sales_score),
        operations: areaScore(diag.operations_score),
        marketing: areaScore(diag.marketing_score),
        strategy: areaScore(diag.strategy_score),
      },
      data_gaps: gapList(diag.data_gaps),
      calculated_at: iso(diag.calculated_at),
    } : null,
    latest_session: sess ? {
      session_id: String(sess.id), kind: String(sess.kind), status: String(sess.status),
      completeness: num(sess.completeness), started_at: iso(sess.started_at), completed_at: iso(sess.completed_at),
    } : null,
    key_findings: findings.map((f) => ({
      finding_id: String(f.id), kind: String(f.kind), area: (f.area as string | null) ?? null, title: freeText(f.title, p.pii, 200),
      severity: String(f.severity), provenance: String(f.provenance_type), confidence: num(f.confidence), reviewed: Boolean(f.reviewed),
    })),
    counts: {
      critical_findings: num(counts?.critical) ?? 0,
      published_reports: num(counts?.published_reports) ?? 0,
      diagnostic_sessions: num(counts?.sessions) ?? 0,
    },
  }
}

// ─── Diagnostics ─────────────────────────────────────────────────────────────

export async function listDiagnostics(p: { companyId: string; pii: boolean; limit: number; offset: number }): Promise<{ items: Record<string, unknown>[]; hasMore: boolean }> {
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT s.id::text, s.kind, s.status, s.trigger, s.completeness::float AS completeness, s.error,
           s.started_at, s.completed_at, s.sources,
           d.id::text AS diagnostic_id, d.overall_score::float AS score, d.health_index::float AS health, d.stage,
           d.calculated_at, d.is_current
    FROM public.diagnostic_sessions s
    LEFT JOIN public.diagnostics d ON d.id = s.diagnostic_id
    WHERE s.company_id = ${p.companyId}
    ORDER BY s.started_at DESC, s.id
    LIMIT ${p.limit + 1} OFFSET ${p.offset}`
  return {
    items: rows.slice(0, p.limit).map((r) => ({
      session_id: String(r.id),
      kind: String(r.kind),
      status: String(r.status),
      trigger: String(r.trigger),
      completeness: num(r.completeness),
      sources: r.sources && typeof r.sources === 'object' && !Array.isArray(r.sources) ? r.sources : {},
      error: freeText(r.error, p.pii, 300),
      started_at: iso(r.started_at),
      completed_at: iso(r.completed_at),
      diagnostic: r.diagnostic_id ? {
        diagnostic_id: String(r.diagnostic_id), overall_score: num(r.score), health_index: num(r.health),
        stage: (r.stage as string | null) ?? null, calculated_at: iso(r.calculated_at), is_current: Boolean(r.is_current),
      } : null,
    })),
    hasMore: rows.length > p.limit,
  }
}

// ─── Reports ─────────────────────────────────────────────────────────────────

/** Published report versions only — drafts, versions under review and withdrawn ones are never listed. */
export async function listPublishedReports(p: { companyId: string | null; limit: number; offset: number }): Promise<{ items: Record<string, unknown>[]; hasMore: boolean }> {
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT r.id::text, r.company_id, c.name AS company_name, r.report_type, r.version, r.title,
           r.confidence::float AS confidence, r.published_at, r.created_at
    FROM public.report_versions r
    JOIN public.companies c ON c.id = r.company_id
    LEFT JOIN public.profiles p ON p.id = c.user_id
    WHERE r.status = 'published'
      AND (${p.companyId}::text IS NULL OR r.company_id = ${p.companyId})
      AND (c.user_id IS NULL OR (p.role IN ('client', 'owner')
           AND NOT EXISTS (SELECT 1 FROM public.staff_roles s WHERE s.user_id = c.user_id)))
    ORDER BY r.published_at DESC NULLS LAST, r.id
    LIMIT ${p.limit + 1} OFFSET ${p.offset}`
  return {
    items: rows.slice(0, p.limit).map((r) => ({
      report_version_id: String(r.id),
      company_id: String(r.company_id),
      company_name: (r.company_name as string | null) ?? null,
      report_type: String(r.report_type),
      version: num(r.version),
      title: freeText(r.title, true, 300),
      confidence: num(r.confidence),
      published_at: iso(r.published_at),
      created_at: iso(r.created_at),
    })),
    hasMore: rows.length > p.limit,
  }
}

/** Company names for spend rows grouped by company. */
export async function companyNames(ids: string[]): Promise<Map<string, string>> {
  const clean = ids.filter((id) => COMPANY_ID_RE.test(id)).slice(0, 200)
  if (!clean.length) return new Map()
  const rows = await prisma.$queryRaw<Array<{ id: string; name: string }>>`SELECT id, name FROM public.companies WHERE id = ANY(${clean}::text[])`
  return new Map(rows.map((r) => [r.id, r.name]))
}
