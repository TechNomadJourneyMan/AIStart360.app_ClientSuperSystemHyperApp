export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/api-identity'
import {
  pointARepositoryError,
  readPointAModel,
  setManualPointAValue,
  verifyOwnedCompany,
} from '@/lib/point-a/model/repository'
import type { PointAScenario } from '@/lib/point-a/model/types'

const SCENARIOS = new Set<PointAScenario>(['fact', 'plan', 'forecast'])

export async function PUT(
  req: NextRequest,
  { params }: { params: { fieldKey: string } },
) {
  const sb = createServerClient()
  const user = await getSessionUser(sb)
  if (!user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json() as Record<string, unknown>
    if (!Object.prototype.hasOwnProperty.call(body, 'value')) {
      return NextResponse.json({ ok: false, error: 'value is required' }, { status: 400 })
    }
    const scenario = typeof body.scenario === 'string'
      ? body.scenario as PointAScenario
      : 'fact'
    if (!SCENARIOS.has(scenario)) {
      return NextResponse.json({ ok: false, error: 'invalid scenario' }, { status: 400 })
    }
    const companyId = await verifyOwnedCompany(
      sb,
      user.id,
      typeof body.companyId === 'string' ? body.companyId : null,
    )
    const result = await setManualPointAValue(sb, {
      userId: user.id,
      companyId,
      fieldKey: decodeURIComponent(params.fieldKey),
      value: body.value,
      unit: typeof body.unit === 'string' ? body.unit : null,
      currency: typeof body.currency === 'string' ? body.currency : null,
      period: typeof body.period === 'string' ? body.period : null,
      periodYear: typeof body.periodYear === 'number' ? body.periodYear : null,
      periodQuarter:
        typeof body.periodQuarter === 'string' &&
        ['Q1', 'Q2', 'Q3', 'Q4'].includes(body.periodQuarter)
          ? body.periodQuarter as 'Q1' | 'Q2' | 'Q3' | 'Q4'
          : null,
      periodMonth: typeof body.periodMonth === 'number' ? body.periodMonth : null,
      scenario,
    })
    const model = await readPointAModel(sb, { userId: user.id, companyId })
    return NextResponse.json({ ok: true, result, model })
  } catch (error) {
    const message = pointARepositoryError(error)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
