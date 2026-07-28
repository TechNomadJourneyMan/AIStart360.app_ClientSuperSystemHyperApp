export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

function isSuperAdmin(req: NextRequest): boolean {
  return req.cookies.get('aistart360_role')?.value === 'super_admin'
}

function score(value: unknown): number {
  const raw = Number((value as { score?: number } | null)?.score)
  return Number.isFinite(raw) ? Math.round(raw) / 10 : 0
}

export async function GET(req: NextRequest) {
  if (!isSuperAdmin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const admin = createServerClient()
    const { data: companies, error: companiesError } = await admin
      .from('companies')
      .select('id,name,domain,status,createdAt,user_id,industry,stage')
      .not('user_id', 'is', null)
      .order('createdAt', { ascending: false })
    if (companiesError) throw companiesError

    const userIds = [...new Set((companies ?? []).map((company) => company.user_id).filter(Boolean))]
    const [profilesResult, diagnosticsResult] = await Promise.all([
      userIds.length
        ? admin.from('profiles').select('id,full_name,email,status,role').in('id', userIds)
        : Promise.resolve({ data: [], error: null }),
      userIds.length
        ? admin
            .from('diagnostics')
            .select(`
              user_id,overall_score,finance_score,sales_score,operations_score,
              marketing_score,strategy_score,calculated_at
            `)
            .in('user_id', userIds)
            .eq('is_current', true)
        : Promise.resolve({ data: [], error: null }),
    ])
    if (profilesResult.error) throw profilesResult.error
    if (diagnosticsResult.error) throw diagnosticsResult.error

    const profiles = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile]))
    const diagnostics = new Map((diagnosticsResult.data ?? []).map((diagnostic) => [diagnostic.user_id, diagnostic]))

    const clients = (companies ?? []).map((company) => {
      const profile = profiles.get(company.user_id)
      const diagnostic = diagnostics.get(company.user_id)
      const overall = diagnostic?.overall_score == null ? null : Number(diagnostic.overall_score) / 10
      const website = company.domain
        ? (company.domain.startsWith('http') ? company.domain : `https://${company.domain}`)
        : null

      return {
        id: company.id,
        name: company.name,
        industry: company.industry ?? 'Отрасль не указана',
        stage: company.stage ?? 'Seed',
        status: profile?.status === 'approved' ? 'active' : 'onboarding',
        website,
        createdAt: company.createdAt,
        manager: profile
          ? { id: profile.id, name: profile.full_name, email: profile.email }
          : null,
        latestGri: diagnostic && overall !== null
          ? {
              score: overall,
              productScore: score(diagnostic.sales_score),
              trustScore: score(diagnostic.strategy_score),
              businessModelScore: score(diagnostic.strategy_score),
              cashScore: score(diagnostic.finance_score),
              operationsScore: score(diagnostic.operations_score),
              teamScore: score(diagnostic.operations_score),
              founderScore: score(diagnostic.marketing_score),
              calculatedAt: diagnostic.calculated_at,
            }
          : null,
        pulseMetrics: null,
      }
    })

    return NextResponse.json({ clients })
  } catch (error) {
    console.error('[giga-admin/clients] Error:', error)
    return NextResponse.json({ error: 'Не удалось загрузить компании из Supabase' }, { status: 500 })
  }
}
