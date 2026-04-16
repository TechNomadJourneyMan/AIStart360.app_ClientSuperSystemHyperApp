export const dynamic = 'force-dynamic'

// GET /api/expert/clients/[id]/dashboard
// Returns the current diagnostics snapshot + company + latest survey for
// the specified client. Expert-only; reads via service-role to bypass RLS.

import { NextResponse } from 'next/server'
import { requireExpert, srGet } from '@/lib/expert-auth'

interface Diagnostic {
  id: string
  user_id: string
  is_current: boolean
  finance_score: number | null
  sales_score: number | null
  operations_score: number | null
  marketing_score: number | null
  strategy_score: number | null
  overall_score: number | null
  ai_analysis: unknown
  created_at: string
  [key: string]: unknown
}

interface Company {
  id: string
  user_id: string
  name: string | null
  industry: string | null
  stage: string | null
  team_size: number | null
  founded_year: number | null
  website: string | null
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const viewer = await requireExpert()
  if (!viewer) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const clientId = params.id
  if (!clientId) return NextResponse.json({ error: 'client id required' }, { status: 400 })

  // Current diagnostic
  const diagRows = await srGet<Diagnostic[]>(
    `diagnostics?user_id=eq.${clientId}&is_current=eq.true&select=*&limit=1`,
  )
  const diagnostic = diagRows?.[0] ?? null

  // Company
  const companyRows = await srGet<Company[]>(
    `companies?user_id=eq.${clientId}&select=*&limit=1`,
  )
  const company = companyRows?.[0] ?? null

  // Basic profile
  const profileRows = await srGet<
    Array<{ id: string; full_name: string | null; avatar_url: string | null; email: string | null }>
  >(`profiles?id=eq.${clientId}&select=id,full_name,avatar_url,email&limit=1`)
  const profile = profileRows?.[0] ?? null

  return NextResponse.json({
    ok: true,
    data: { diagnostic, company, profile },
  })
}
