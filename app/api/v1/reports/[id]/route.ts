// GET /api/v1/reports/:id — one published report version (frozen snapshot).
//
// Read with the caller's session client (RLS), only status 'published', and
// the company confirmed through lib/tenancy. Another tenant's report — or a
// version that is not published — is a 404, never a 403.

export const dynamic = 'force-dynamic'

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { apiError, dbError, safeErrorMessage } from '@/lib/api-error'
import { publishedReportForCaller } from '@/lib/reports/client-access'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const found = await publishedReportForCaller(supabase, user?.id ?? null, params.id)
    if (!found.ok) {
      if (found.error === 'db') return dbError('api/v1/reports/:id', found.dbError, 'Не удалось загрузить отчёт')
      if (found.error === 'unauthenticated') return apiError('Требуется вход в систему', 401)
      return apiError('Отчёт не найден', 404)
    }
    return NextResponse.json({ ok: true, data: found.report })
  } catch (err) {
    console.error('[api/v1/reports/:id]', err)
    return apiError(safeErrorMessage(err, 'Не удалось загрузить отчёт'), 500)
  }
}
