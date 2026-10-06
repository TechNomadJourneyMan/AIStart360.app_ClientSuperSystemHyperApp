/**
 * lib/reports/expert-list.ts — published report versions for the Expert
 * portal (/expert/reports).
 *
 * Access, reusing what already exists — no new rules:
 *   • the caller must pass requireExpert() (expert / admin / super_admin,
 *     lib/expert-auth.ts); without it nothing is read;
 *   • rows are read with the caller's own Supabase session, so RLS
 *     (report_versions_select, migration 085) decides visibility — the same
 *     path as the client API (lib/reports/client-access.ts). The query also
 *     asks for status = 'published' explicitly and the rows are filtered
 *     again: drafts and ready versions are reviewed in GIGA, not here.
 * There is no expert↔client assignment in the schema: experts are platform
 * staff (public.is_platform_staff()) and read every company — the same scope
 * /api/expert/clients already gives them.
 *
 * The PDF is served by GET /api/v1/reports/:id/pdf, which re-checks the same
 * access (publishedReportForCaller). Provenance is not selected.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ExpertViewer } from '@/lib/expert-auth'
import { REPORT_TYPES, type ReportType } from './types'

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  point_a: 'Точка А',
  full: 'Полная диагностика',
  gri: 'GRI',
  point_b: 'Точка Б',
}

export interface ExpertReportItem {
  id: string
  company_id: string
  company_name: string | null
  report_type: ReportType
  version: number
  title: string
  confidence: number | null
  published_at: string | null
}

export type ExpertReportsResult =
  | { ok: true; items: ExpertReportItem[] }
  | { ok: false; reason: 'forbidden' | 'db' }

const LIMIT = 200

const isReportType = (v: unknown): v is ReportType =>
  typeof v === 'string' && (REPORT_TYPES as readonly string[]).includes(v)

export async function listPublishedReportsForExpert(
  client: SupabaseClient,
  viewer: ExpertViewer | null,
): Promise<ExpertReportsResult> {
  if (!viewer) return { ok: false, reason: 'forbidden' }

  const { data, error } = await client
    .from('report_versions')
    .select('id, company_id, report_type, version, status, title, confidence, published_at')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(LIMIT)
  if (error) {
    console.error('[reports/expert-list] report_versions read failed:', error.message ?? error)
    return { ok: false, reason: 'db' }
  }

  const rows = ((data ?? []) as Array<Record<string, unknown>>)
    .filter((r) => r.status === 'published' && isReportType(r.report_type))

  const companyIds = Array.from(new Set(rows.map((r) => String(r.company_id))))
  const names = new Map<string, string | null>()
  if (companyIds.length > 0) {
    const { data: companies, error: companiesError } = await client
      .from('companies')
      .select('id, name')
      .in('id', companyIds)
    if (companiesError) {
      // Names are secondary: the list stays, the company column shows «—».
      console.error('[reports/expert-list] companies read failed:', companiesError.message ?? companiesError)
    }
    for (const c of (companies ?? []) as Array<{ id: unknown; name: unknown }>) {
      names.set(String(c.id), typeof c.name === 'string' && c.name.trim() ? c.name : null)
    }
  }

  return {
    ok: true,
    items: rows.map((r) => ({
      id: String(r.id),
      company_id: String(r.company_id),
      company_name: names.get(String(r.company_id)) ?? null,
      report_type: r.report_type as ReportType,
      version: Number(r.version),
      title: String(r.title),
      confidence: r.confidence == null ? null : Number(r.confidence),
      published_at: (r.published_at as string | null) ?? null,
    })),
  }
}
