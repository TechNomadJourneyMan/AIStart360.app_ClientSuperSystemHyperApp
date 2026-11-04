export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/api-identity'
import {
  pointARepositoryError,
  readPointAFieldHistory,
  verifyOwnedCompany,
} from '@/lib/point-a/model/repository'

export async function GET(
  req: NextRequest,
  { params }: { params: { fieldKey: string } },
) {
  const sb = createServerClient()
  const user = await getSessionUser(sb)
  if (!user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  try {
    const companyId = await verifyOwnedCompany(
      sb,
      user.id,
      req.nextUrl.searchParams.get('company_id'),
    )
    const events = await readPointAFieldHistory(sb, {
      userId: user.id,
      companyId,
      fieldKey: decodeURIComponent(params.fieldKey),
    })
    return NextResponse.json({ ok: true, events })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: pointARepositoryError(error) },
      { status: 500 },
    )
  }
}
