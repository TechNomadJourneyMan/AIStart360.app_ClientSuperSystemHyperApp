// POST /api/v1/reports/:id/link — an expiring link to exactly this published
// version (/r/v/<token>, lib/reports/version-link.ts) for the client to keep
// or forward. Same access as GET /api/v1/reports/:id: only a published version
// of a company the caller can read; anything else is a 404.

export const dynamic = 'force-dynamic'

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSameOriginMutation } from '@/lib/admin/giga-actor'
import { apiError, dbError, safeErrorMessage } from '@/lib/api-error'
import { publishedReportForCaller } from '@/lib/reports/client-access'
import { linkSecretConfigured, signVersionLink, VERSION_LINK_DEFAULT_DAYS } from '@/lib/reports/version-link'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isSameOriginMutation(req)) return apiError('Cross-site request blocked', 403)
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const found = await publishedReportForCaller(supabase, user?.id ?? null, params.id)
    if (!found.ok) {
      if (found.error === 'db') return dbError('api/v1/reports/:id/link', found.dbError, 'Не удалось загрузить отчёт')
      if (found.error === 'unauthenticated') return apiError('Требуется вход в систему', 401)
      return apiError('Отчёт не найден', 404)
    }
    if (!linkSecretConfigured()) return apiError('Ссылки на версии не настроены на сервере', 503)
    const link = await signVersionLink(found.report.id, found.report.version, VERSION_LINK_DEFAULT_DAYS)
    return NextResponse.json({ ok: true, data: { url: link.url, expires_at: link.expiresAt } })
  } catch (err) {
    console.error('[api/v1/reports/:id/link]', err instanceof Error ? err.message.split('\n')[0] : err)
    return apiError(safeErrorMessage(err, 'Не удалось создать ссылку'), 500)
  }
}
