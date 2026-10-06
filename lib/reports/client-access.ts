/**
 * lib/reports/client-access.ts — published report versions for the client
 * portal (/api/v1/reports/**).
 *
 * Reads go through the CALLER's Supabase session client, so RLS
 * (report_versions_select, migration 085) decides visibility: a tenant sees
 * only published versions of companies it can read. The routes add
 * `status = 'published'` explicitly as well — staff and partner consultants
 * may read drafts through RLS, but the client surface shows only what was
 * published — and confirm the company with lib/tenancy.
 *
 * Responses carry the frozen content and a few columns; provenance (with its
 * staff-only part) is not selected at all.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { BUSINESS_TIME_ZONE } from '@/lib/format/period'
import { resolveTenantWith, type TenantResult } from '@/lib/tenancy'
import type { ReportContent, ReportType } from './types'

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface ClientReport {
  id: string
  company_id: string
  report_type: ReportType
  version: number
  title: string
  confidence: number | null
  data_hash: string
  published_at: string | null
  /** When the version was built: the date of «Версия N · дата». */
  created_at: string | null
  content: ReportContent
}

export interface ClientReportSummary {
  id: string
  report_type: ReportType
  version: number
  title: string
  confidence: number | null
  data_hash: string
  published_at: string | null
  created_at: string | null
  generated_at: string | null
  calculated_at: string | null
  overall_score: number | null
  findings: number
  recommendations: number
  has_narrative: boolean
}

export const CLIENT_REPORT_COLUMNS = 'id, company_id, report_type, version, title, confidence, data_hash, published_at, created_at, content'

export function toClientReport(row: Record<string, unknown>): ClientReport {
  return {
    id: String(row.id),
    company_id: String(row.company_id),
    report_type: row.report_type as ReportType,
    version: Number(row.version),
    title: String(row.title),
    confidence: row.confidence == null ? null : Number(row.confidence),
    data_hash: String(row.data_hash),
    published_at: (row.published_at as string | null) ?? null,
    created_at: (row.created_at as string | null) ?? null,
    content: row.content as ReportContent,
  }
}

export function summarize(r: ClientReport): ClientReportSummary {
  const c = r.content
  return {
    id: r.id,
    report_type: r.report_type,
    version: r.version,
    title: r.title,
    confidence: r.confidence,
    data_hash: r.data_hash,
    published_at: r.published_at,
    created_at: r.created_at,
    generated_at: c?.generated_at ?? null,
    calculated_at: c?.calculated_at ?? null,
    overall_score: c?.diagnostic?.overall_score ?? null,
    findings: Array.isArray(c?.findings) ? c.findings.length : 0,
    recommendations: Array.isArray(c?.recommendations) ? c.recommendations.length : 0,
    has_narrative: Boolean(c?.narrative),
  }
}

export type PublishedLookup =
  | { ok: true; report: ClientReport }
  | { ok: false; status: 401 | 403 | 404 | 500; error: 'unauthenticated' | 'not_found' | 'db'; dbError?: { message?: string; code?: string } }

/**
 * One published version the caller may read, or 404 — never 403, so the
 * existence of another tenant's report is not confirmed.
 */
export async function publishedReportForCaller(
  client: SupabaseClient,
  userId: string | null,
  id: string,
): Promise<PublishedLookup> {
  if (!userId) return { ok: false, status: 401, error: 'unauthenticated' }
  if (!UUID_RE.test(id)) return { ok: false, status: 404, error: 'not_found' }
  const { data, error } = await client
    .from('report_versions')
    .select(CLIENT_REPORT_COLUMNS)
    .eq('id', id)
    .eq('status', 'published')
    .maybeSingle()
  if (error) return { ok: false, status: 500, error: 'db', dbError: error }
  if (!data) return { ok: false, status: 404, error: 'not_found' }
  const row = data as Record<string, unknown>
  const tenant: TenantResult = await resolveTenantWith(client, userId, { companyId: String(row.company_id), access: 'read' })
  if (!tenant.ok) return { ok: false, status: tenant.status === 401 ? 401 : 404, error: tenant.status === 401 ? 'unauthenticated' : 'not_found' }
  return { ok: true, report: toClientReport(row) }
}

/**
 * ASCII-safe attachment name plus the UTF-8 one (RFC 6266). With the version
 * date: «Отчёт Точка А — версия 3 от 06.10.2026.pdf» (Asia/Almaty).
 */
export function pdfDisposition(r: { report_type: string; version: number; created_at?: string | Date | null }): string {
  const day = r.created_at ? new Date(r.created_at) : null
  const valid = day && !Number.isNaN(day.getTime()) ? day : null
  const isoDay = valid ? new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(valid) : null
  const ruDay = valid ? new Intl.DateTimeFormat('ru-RU', { timeZone: BUSINESS_TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric' }).format(valid) : null
  const ascii = `aistart360-${r.report_type.replace(/[^a-z_]/g, '')}-v${r.version}${isoDay ? `-${isoDay}` : ''}.pdf`
  const label: Record<string, string> = { point_a: 'Точка А', full: 'Полная диагностика', gri: 'GRI', point_b: 'Точка Б' }
  const utf8 = encodeURIComponent(`Отчёт ${label[r.report_type] ?? ''} — версия ${r.version}${ruDay ? ` от ${ruDay}` : ''}.pdf`.replace(/\s+/g, ' '))
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`
}
