/**
 * Read models for the bots (server Postgres connection, service privileges —
 * like lib/agents/admin.ts). Callers authorise first; nothing here returns a
 * secret, a prompt or a document body.
 */
import { prisma } from '@/lib/db'

const n = (v: unknown) => (v == null ? 0 : Number(v))
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

// ─── Status ──────────────────────────────────────────────────────────────────

export interface StatusCounts {
  queued: number
  running: number
  awaitingApproval: number
  dead24h: number
  pendingApprovals: number
  pendingRegistrations: number
}

export async function statusCounts(): Promise<StatusCounts> {
  const [r] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT
      (SELECT count(*) FROM public.agent_tasks WHERE status = 'queued') AS queued,
      (SELECT count(*) FROM public.agent_tasks WHERE status = 'running') AS running,
      (SELECT count(*) FROM public.agent_tasks WHERE status = 'awaiting_approval') AS awaiting,
      (SELECT count(*) FROM public.agent_tasks WHERE status = 'dead' AND finished_at > now() - interval '24 hours') AS dead24h,
      (SELECT count(*) FROM public.agent_approvals WHERE status = 'pending' AND expires_at > now()) AS approvals,
      (SELECT count(*) FROM public.profiles WHERE status = 'pending_approval') AS registrations`
  return {
    queued: n(r?.queued), running: n(r?.running), awaitingApproval: n(r?.awaiting), dead24h: n(r?.dead24h),
    pendingApprovals: n(r?.approvals), pendingRegistrations: n(r?.registrations),
  }
}

export interface FailureRow { id: string; agent_key: string; status: string; last_error_code: string | null; finished_at: Date | null; company_name: string | null }

export async function lastFailures(limit = 5): Promise<FailureRow[]> {
  return prisma.$queryRaw<FailureRow[]>`
    SELECT t.id::text, t.agent_key, t.status, t.last_error_code, t.finished_at, c.name AS company_name
    FROM public.agent_tasks t LEFT JOIN public.companies c ON c.id = t.company_id
    WHERE t.status IN ('dead', 'failed') AND t.finished_at > now() - interval '7 days'
    ORDER BY t.finished_at DESC NULLS LAST LIMIT ${Math.min(Math.max(limit, 1), 20)}`
}

// ─── Companies / clients ─────────────────────────────────────────────────────

export interface CompanyRow {
  id: string
  name: string
  industry: string | null
  owner_email: string | null
  owner_name: string | null
  owner_id: string | null
  score: number | null
}

export async function searchCompanies(q: string | null, page = 0, size = 8): Promise<{ items: CompanyRow[]; hasMore: boolean }> {
  const term = q?.trim().slice(0, 80) || null
  const rows = await prisma.$queryRaw<CompanyRow[]>`
    SELECT c.id, c.name, c.industry, p.email AS owner_email, p.full_name AS owner_name, p.id::text AS owner_id,
           (SELECT d.overall_score::float FROM public.diagnostics d
             WHERE d.company_id = c.id AND d.is_current ORDER BY d.calculated_at DESC LIMIT 1) AS score
    FROM public.companies c LEFT JOIN public.profiles p ON p.id = c.user_id
    WHERE (${term}::text IS NULL
           OR c.name ILIKE ${term ? like(term) : null}
           OR p.email ILIKE ${term ? like(term) : null}
           OR p.full_name ILIKE ${term ? like(term) : null}
           OR c.contact_email ILIKE ${term ? like(term) : null})
    ORDER BY c.updated_at DESC NULLS LAST, c.name
    LIMIT ${size + 1} OFFSET ${page * size}`
  return { items: rows.slice(0, size), hasMore: rows.length > size }
}

export interface FindingLine { id: string; title: string; severity: string; provenance_type: string; reviewed: boolean; visible: boolean }

export interface CompanyCard {
  id: string
  name: string
  industry: string | null
  stage: string | null
  owner: { id: string; email: string | null; name: string | null; status: string | null } | null
  diagnostic: { score: number | null; health: number | null; stage: string | null; calculatedAt: Date | null; dataGaps: string[] } | null
  session: { id: string; status: string; stage: string | null; completeness: number | null; startedAt: Date; completedAt: Date | null; error: string | null } | null
  criticalCount: number
  findings: FindingLine[]
  pendingHypotheses: number
  publishedReports: number
}

function gapsOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((g) => (typeof g === 'string' ? g : g && typeof g === 'object' ? String((g as Record<string, unknown>).label ?? (g as Record<string, unknown>).field ?? (g as Record<string, unknown>).key ?? '') : ''))
    .filter(Boolean)
    .slice(0, 8)
}

/**
 * Card of a company. `includeUnreviewedHypotheses` — whether model hypotheses
 * not yet reviewed are listed (platform staff may read them under RLS 085;
 * they are always labelled as unreviewed).
 */
export async function companyCard(id: string, opts: { includeUnreviewedHypotheses: boolean }): Promise<CompanyCard | null> {
  const [c] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT c.id, c.name, c.industry, c.stage, p.id::text AS owner_id, p.email, p.full_name, p.status AS owner_status
    FROM public.companies c LEFT JOIN public.profiles p ON p.id = c.user_id WHERE c.id = ${id}`
  if (!c) return null
  const [diag] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT overall_score::float AS score, health_index::float AS health, stage, calculated_at, data_gaps
    FROM public.diagnostics WHERE company_id = ${id} AND is_current ORDER BY calculated_at DESC LIMIT 1`
  const [sess] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT id::text, status, stage, completeness::float AS completeness, started_at, completed_at, error
    FROM public.diagnostic_sessions WHERE company_id = ${id} ORDER BY started_at DESC LIMIT 1`
  const findings = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT id::text, title, severity, provenance_type, reviewed_at IS NOT NULL AS reviewed, visible_to_client AS visible
    FROM public.diagnostic_findings
    WHERE company_id = ${id} AND status = 'active' AND severity IN ('critical', 'high')
      AND (provenance_type <> 'AI_HYPOTHESIS' OR reviewed_at IS NOT NULL OR ${opts.includeUnreviewedHypotheses})
    ORDER BY CASE severity WHEN 'critical' THEN 0 ELSE 1 END, created_at DESC LIMIT 6`
  const [counts] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT
      (SELECT count(*) FROM public.diagnostic_findings WHERE company_id = ${id} AND status = 'active' AND severity = 'critical'
         AND (provenance_type <> 'AI_HYPOTHESIS' OR reviewed_at IS NOT NULL)) AS critical,
      (SELECT count(*) FROM public.diagnostic_findings WHERE company_id = ${id} AND status = 'active'
         AND provenance_type = 'AI_HYPOTHESIS' AND reviewed_at IS NULL) AS pending,
      (SELECT count(*) FROM public.report_versions WHERE company_id = ${id} AND status = 'published') AS published`
  return {
    id: String(c.id),
    name: String(c.name),
    industry: (c.industry as string | null) ?? null,
    stage: (c.stage as string | null) ?? null,
    owner: c.owner_id ? { id: String(c.owner_id), email: (c.email as string | null) ?? null, name: (c.full_name as string | null) ?? null, status: (c.owner_status as string | null) ?? null } : null,
    diagnostic: diag ? {
      score: diag.score == null ? null : Number(diag.score),
      health: diag.health == null ? null : Number(diag.health),
      stage: (diag.stage as string | null) ?? null,
      calculatedAt: (diag.calculated_at as Date | null) ?? null,
      dataGaps: gapsOf(diag.data_gaps),
    } : null,
    session: sess ? {
      id: String(sess.id), status: String(sess.status), stage: (sess.stage as string | null) ?? null,
      completeness: sess.completeness == null ? null : Number(sess.completeness),
      startedAt: sess.started_at as Date, completedAt: (sess.completed_at as Date | null) ?? null, error: (sess.error as string | null) ?? null,
    } : null,
    criticalCount: n(counts?.critical),
    findings: findings.map((f) => ({
      id: String(f.id), title: String(f.title), severity: String(f.severity), provenance_type: String(f.provenance_type),
      reviewed: Boolean(f.reviewed), visible: Boolean(f.visible),
    })),
    pendingHypotheses: n(counts?.pending),
    publishedReports: n(counts?.published),
  }
}

export interface SessionListRow { id: string; company_id: string; company_name: string | null; status: string; stage: string | null; completeness: number | null; started_at: Date; completed_at: Date | null }

export async function recentSessions(page = 0, size = 8, companyId: string | null = null): Promise<{ items: SessionListRow[]; hasMore: boolean }> {
  const rows = await prisma.$queryRaw<SessionListRow[]>`
    SELECT s.id::text, s.company_id, c.name AS company_name, s.status, s.stage, s.completeness::float AS completeness, s.started_at, s.completed_at
    FROM public.diagnostic_sessions s LEFT JOIN public.companies c ON c.id = s.company_id
    WHERE (${companyId}::text IS NULL OR s.company_id = ${companyId})
    ORDER BY s.started_at DESC LIMIT ${size + 1} OFFSET ${page * size}`
  return { items: rows.slice(0, size), hasMore: rows.length > size }
}

// ─── Users and registrations ─────────────────────────────────────────────────

export interface UserRow { id: string; email: string | null; full_name: string | null; role: string; status: string; organization: string | null; created_at: Date }

export async function searchUsers(q: string, page = 0, size = 8): Promise<{ items: UserRow[]; hasMore: boolean }> {
  const term = like(q.trim().slice(0, 80))
  const rows = await prisma.$queryRaw<UserRow[]>`
    SELECT id::text, email, full_name, role, status, organization, created_at FROM public.profiles
    WHERE email ILIKE ${term} OR full_name ILIKE ${term} OR organization ILIKE ${term}
    ORDER BY created_at DESC LIMIT ${size + 1} OFFSET ${page * size}`
  return { items: rows.slice(0, size), hasMore: rows.length > size }
}

export interface UserCard extends UserRow {
  phone: string | null
  last_seen_at: Date | null
  staff_role: string | null
  company_id: string | null
  company_name: string | null
}

export async function userCard(id: string): Promise<UserCard | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const [r] = await prisma.$queryRaw<UserCard[]>`
    SELECT p.id::text, p.email, p.full_name, p.role, p.status, p.organization, p.created_at, p.phone, p.last_seen_at,
           s.role AS staff_role, c.id AS company_id, c.name AS company_name
    FROM public.profiles p
    LEFT JOIN public.staff_roles s ON s.user_id = p.id
    LEFT JOIN public.companies c ON c.user_id = p.id
    WHERE p.id = ${id}::uuid`
  return r ?? null
}

export interface RegistrationRow { user_id: string; request_id: string; email: string | null; full_name: string | null; organization: string | null; created_at: Date }

/** Pending access requests: profiles waiting for a decision (the source of truth), with their admin_requests id when one exists. */
export async function pendingRegistrations(page = 0, size = 8): Promise<{ items: RegistrationRow[]; hasMore: boolean }> {
  const rows = await prisma.$queryRaw<RegistrationRow[]>`
    SELECT p.id::text AS user_id,
           coalesce((SELECT ar.id FROM public.admin_requests ar WHERE ar."userId" = p.id::text
                     ORDER BY ar."createdAt" DESC LIMIT 1), p.id::text) AS request_id,
           p.email, p.full_name, p.organization, p.created_at
    FROM public.profiles p
    WHERE p.status = 'pending_approval'
    ORDER BY p.created_at DESC LIMIT ${size + 1} OFFSET ${page * size}`
  return { items: rows.slice(0, size), hasMore: rows.length > size }
}
