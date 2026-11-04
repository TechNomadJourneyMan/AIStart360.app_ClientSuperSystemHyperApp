export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/api-identity'
import {
  backfillStoredDocumentsToPointA,
  backfillStoredSurveyAnswersToPointA,
  ensureOwnedCompany,
  pointARepositoryError,
  readPointAModel,
} from '@/lib/point-a/model/repository'

export async function GET(req: NextRequest) {
  const sb = createServerClient()
  const user = await getSessionUser(sb)
  if (!user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  try {
    const companyId = await ensureOwnedCompany(
      sb,
      user.id,
      req.nextUrl.searchParams.get('company_id'),
    )
    await backfillStoredSurveyAnswersToPointA(sb, { userId: user.id, companyId })
    await backfillStoredDocumentsToPointA(sb, { userId: user.id, companyId })
    const model = await readPointAModel(sb, { userId: user.id, companyId })
    return NextResponse.json({ ok: true, model })
  } catch (error) {
    const message = pointARepositoryError(error)
    const status = message.includes('не найдена') ? 404 : 500
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}
