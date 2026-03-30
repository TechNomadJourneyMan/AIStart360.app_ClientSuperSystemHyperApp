export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

export interface AdminClientRow {
  id: string
  email: string
  full_name: string | null
  status: string
  approved_at: string | null
  created_at: string
  company_name: string | null
  industry: string | null
  stage: string | null
  overall_score: number | null   // 0–100 from Point A engine
  health_index: number | null
  finance_score: number | null
  sales_score: number | null
  operations_score: number | null
  marketing_score: number | null
  strategy_score: number | null
  calculated_at: string | null
}

// GET /api/v1/admin/clients
export async function GET() {
  try {
    const sb = createServerClient()

    const { data: profiles, error } = await sb
      .from('profiles')
      .select('id, email, full_name, status, approved_at, created_at')
      .not('status', 'eq', 'rejected')
      .order('created_at', { ascending: false })

    if (error) throw error
    if (!profiles || profiles.length === 0) {
      return NextResponse.json({ ok: true, data: [] })
    }

    const userIds = profiles.map((p) => p.id)

    // Fetch companies and current diagnostics in parallel
    const [companiesRes, diagnosticsRes] = await Promise.all([
      sb
        .from('companies')
        .select('user_id, name, industry, stage')
        .in('user_id', userIds),
      sb
        .from('diagnostics')
        .select('user_id, overall_score, health_index, finance_score, sales_score, operations_score, marketing_score, strategy_score, calculated_at')
        .in('user_id', userIds)
        .eq('is_current', true),
    ])

    const companyMap = new Map(
      (companiesRes.data ?? []).map((c) => [c.user_id, c])
    )
    const diagnosticMap = new Map(
      (diagnosticsRes.data ?? []).map((d) => [d.user_id, d])
    )

    const rows: AdminClientRow[] = profiles.map((p) => {
      const company = companyMap.get(p.id)
      const diag = diagnosticMap.get(p.id)

      const blockScore = (block: Record<string, unknown> | null) =>
        block && typeof block === 'object' && 'score' in block
          ? (block.score as number)
          : null

      return {
        id: p.id,
        email: p.email,
        full_name: p.full_name ?? null,
        status: p.status,
        approved_at: p.approved_at ?? null,
        created_at: p.created_at,
        company_name: company?.name ?? null,
        industry: company?.industry ?? null,
        stage: company?.stage ?? null,
        overall_score: diag?.overall_score ?? null,
        health_index: diag?.health_index ?? null,
        finance_score: blockScore(diag?.finance_score as Record<string, unknown> | null),
        sales_score: blockScore(diag?.sales_score as Record<string, unknown> | null),
        operations_score: blockScore(diag?.operations_score as Record<string, unknown> | null),
        marketing_score: blockScore(diag?.marketing_score as Record<string, unknown> | null),
        strategy_score: blockScore(diag?.strategy_score as Record<string, unknown> | null),
        calculated_at: diag?.calculated_at ?? null,
      }
    })

    return NextResponse.json({ ok: true, data: rows })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
