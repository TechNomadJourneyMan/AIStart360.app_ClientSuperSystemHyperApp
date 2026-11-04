export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/api-identity'
import {
  confirmPointAValue,
  pointARepositoryError,
  readPointAModel,
} from '@/lib/point-a/model/repository'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const sb = createServerClient()
  const user = await getSessionUser(sb)
  if (!user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json() as { valueId?: unknown }
    if (typeof body.valueId !== 'string') {
      return NextResponse.json({ ok: false, error: 'valueId is required' }, { status: 400 })
    }
    const { data: resolution } = await sb
      .from('point_a_resolutions')
      .select('id,company_id,field_key,period_key,scenario')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .single()
    if (!resolution) {
      return NextResponse.json({ ok: false, error: 'Конфликт не найден' }, { status: 404 })
    }
    const { data: candidate } = await sb
      .from('point_a_values')
      .select('id')
      .eq('id', body.valueId)
      .eq('user_id', user.id)
      .eq('company_id', resolution.company_id)
      .eq('field_key', resolution.field_key)
      .eq('period_key', resolution.period_key)
      .eq('scenario', resolution.scenario)
      .single()
    if (!candidate) {
      return NextResponse.json({ ok: false, error: 'Кандидат не найден' }, { status: 404 })
    }
    const updated = await confirmPointAValue(sb, {
      userId: user.id,
      companyId: String(resolution.company_id),
      valueId: String(candidate.id),
      eventType: 'conflict_resolved',
    })
    const model = await readPointAModel(sb, {
      userId: user.id,
      companyId: String(resolution.company_id),
    })
    return NextResponse.json({ ok: true, resolution: updated, model })
  } catch (error) {
    const message = pointARepositoryError(error)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
