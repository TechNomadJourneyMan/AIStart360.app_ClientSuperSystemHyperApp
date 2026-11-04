export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { getAllSettings } from '@/lib/settings/store'

/**
 * GET /api/giga-admin/dev-tools/settings — снимок всех настроек платформы
 * (флаги, режимы) только для чтения. Меняются они в «Настройки».
 */
export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, 'devtools.use')
  if (guard.response) return guard.response
  try {
    const { values, meta } = await getAllSettings({ fresh: true })
    return NextResponse.json({ ok: true, values, meta })
  } catch (e) {
    console.error('[dev-tools/settings] read failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ ok: false, error: 'Не удалось прочитать настройки' }, { status: 500 })
  }
}
