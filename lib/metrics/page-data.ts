/**
 * Server-side data loaders for /metrics page.
 *
 * Reads live data via Supabase REST (service-role) to bypass RLS quirks and
 * match the pattern used in app/(dashboard)/dashboard/page.tsx and the
 * Point-A GRIAssessmentBlock. Pure async functions — no React, no hooks.
 *
 * Realtime invalidation is wired client-side via useRealtimeSync on:
 *   - gri_assessments  → header chip + GRI tab
 *   - companies        → Goals tab (target_revenue_*_kzt)
 *   - metrics          → Biz tab + MetricsLiveCatalog
 *   - diagnostics      → KPI tab (survey-derived)
 */

export interface GriAssessmentRow {
  id: string
  user_id: string
  company_id: string | null
  scores: Record<string, Record<string, number>> | null
  section_avgs: Record<string, number> | null
  gri_index: number
  completed_sections: Record<string, boolean> | null
  is_current: boolean
  created_at: string
}

export interface CompanyRow {
  id: string
  user_id: string | null
  name: string | null
  target_revenue_12m_kzt: number | null
  target_revenue_3y_kzt: number | null
}

export interface MetricsPageData {
  userId: string | null
  griAssessment: GriAssessmentRow | null
  company: CompanyRow | null
  surveyAnswers: Record<string, unknown>
}

function restHeaders(serviceKey: string): Record<string, string> {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
  }
}

/**
 * Coerce numeric columns that PostgREST sometimes returns as strings
 * (NUMERIC(18,2) → string in PG REST output).
 */
function toNumericOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = parseFloat(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export async function loadMetricsPageData(userId: string | null): Promise<MetricsPageData> {
  const out: MetricsPageData = {
    userId,
    griAssessment: null,
    company: null,
    surveyAnswers: {},
  }
  if (!userId) return out

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !serviceKey) return out

  const headers = restHeaders(serviceKey)

  try {
    const [griRes, companyRes, surveyRes] = await Promise.all([
      fetch(
        `${supabaseUrl}/rest/v1/gri_assessments?user_id=eq.${userId}&is_current=eq.true&select=*&limit=1`,
        { headers, cache: 'no-store' },
      ),
      fetch(
        `${supabaseUrl}/rest/v1/companies?user_id=eq.${userId}&select=id,user_id,name,target_revenue_12m_kzt,target_revenue_3y_kzt&limit=1`,
        { headers, cache: 'no-store' },
      ),
      fetch(
        `${supabaseUrl}/rest/v1/survey_answers?user_id=eq.${userId}&select=question_key,answer`,
        { headers, cache: 'no-store' },
      ),
    ])

    if (griRes.ok) {
      const rows = (await griRes.json()) as GriAssessmentRow[]
      out.griAssessment = Array.isArray(rows) && rows[0] ? rows[0] : null
    }

    if (companyRes.ok) {
      const rows = (await companyRes.json()) as Array<Record<string, unknown>>
      const r = rows?.[0]
      if (r) {
        out.company = {
          id: String(r.id ?? ''),
          user_id: r.user_id ? String(r.user_id) : null,
          name: (r.name as string) ?? null,
          target_revenue_12m_kzt: toNumericOrNull(r.target_revenue_12m_kzt),
          target_revenue_3y_kzt: toNumericOrNull(r.target_revenue_3y_kzt),
        }
      }
    }

    if (surveyRes.ok) {
      const rows = (await surveyRes.json()) as Array<{
        question_key: string
        answer: { value?: unknown } | unknown
      }>
      for (const row of rows) {
        if (row && typeof row.question_key === 'string') {
          const a = row.answer
          if (a && typeof a === 'object' && 'value' in (a as object)) {
            out.surveyAnswers[row.question_key] = (a as { value?: unknown }).value
          } else {
            out.surveyAnswers[row.question_key] = a
          }
        }
      }
    }
  } catch (err) {
    console.error('[metrics/page-data] fetch error', err)
  }

  return out
}
