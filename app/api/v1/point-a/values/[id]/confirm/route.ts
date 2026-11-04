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
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const sb = createServerClient()
  const user = await getSessionUser(sb)
  if (!user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  try {
    const { data: value } = await sb
      .from('point_a_values')
      .select('company_id')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .single()
    if (!value?.company_id) {
      return NextResponse.json({ ok: false, error: 'Значение не найдено' }, { status: 404 })
    }
    const resolution = await confirmPointAValue(sb, {
      userId: user.id,
      companyId: String(value.company_id),
      valueId: params.id,
    })
    const model = await readPointAModel(sb, {
      userId: user.id,
      companyId: String(value.company_id),
    })
    return NextResponse.json({ ok: true, resolution, model })
  } catch (error) {
    const message = pointARepositoryError(error)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
