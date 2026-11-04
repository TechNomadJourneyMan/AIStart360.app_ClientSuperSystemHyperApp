export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/api-identity'
import {
  pointARepositoryError,
  readPointAModel,
  retractPointASource,
} from '@/lib/point-a/model/repository'

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const sb = createServerClient()
  const user = await getSessionUser(sb)
  if (!user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  try {
    const { data: source } = await sb
      .from('point_a_sources')
      .select('company_id')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .single()
    if (!source?.company_id) {
      return NextResponse.json({ ok: false, error: 'Источник не найден' }, { status: 404 })
    }
    const force = req.nextUrl.searchParams.get('force') === 'true'
    if (!force) {
      const { data: confirmed, error: confirmedError } = await sb
        .from('point_a_values')
        .select('field_key')
        .eq('source_id', params.id)
        .eq('user_id', user.id)
        .eq('status', 'confirmed')
      if (confirmedError) throw confirmedError
      if ((confirmed ?? []).length > 0) {
        return NextResponse.json({
          ok: false,
          error: 'Источник содержит подтверждённые значения. Подтвердите удаление и пересчёт.',
          requires_confirmation: true,
          confirmed_fields: [...new Set((confirmed ?? []).map((value) => value.field_key))],
        }, { status: 409 })
      }
    }
    const result = await retractPointASource(sb, {
      userId: user.id,
      companyId: String(source.company_id),
      sourceId: params.id,
      force,
    })
    const model = await readPointAModel(sb, {
      userId: user.id,
      companyId: String(source.company_id),
    })
    return NextResponse.json({ ok: true, result, model })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: pointARepositoryError(error) },
      { status: 500 },
    )
  }
}
