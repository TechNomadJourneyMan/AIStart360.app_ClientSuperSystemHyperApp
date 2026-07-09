export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { GIGA_COOKIE_NAME, verifyGigaRole } from '@/lib/giga-cookie'
import {
  getAutoApproveClients,
  setAutoApproveClients,
  getAccessGatesEnabled,
  setAccessGatesEnabled,
} from '@/lib/settings/system-settings'

// Только super_admin (HMAC-подписанная giga-cookie, паттерн settings/registration).
function isSuperAdmin(req: NextRequest): boolean {
  return verifyGigaRole(req.cookies.get(GIGA_COOKIE_NAME)?.value) === 'super_admin'
}

/**
 * GET/PUT /api/giga-admin/settings/access — системные тумблеры Фазы 6:
 *   auto_approve_clients — авто-одобрение self-serve регистраций (№15);
 *   access_gates — включить тарифные гейты (полный GRI / AI-чат / PDF / бенчмарки).
 */
export async function GET(req: NextRequest) {
  if (!isSuperAdmin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const [autoApproveClients, accessGates] = await Promise.all([
    getAutoApproveClients(),
    getAccessGatesEnabled(),
  ])
  return NextResponse.json({ ok: true, autoApproveClients, accessGates })
}

export async function PUT(req: NextRequest) {
  if (!isSuperAdmin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await req.json().catch(() => null)) as {
    autoApproveClients?: unknown
    accessGates?: unknown
  } | null
  if (!body || (typeof body.autoApproveClients !== 'boolean' && typeof body.accessGates !== 'boolean')) {
    return NextResponse.json({ error: 'boolean autoApproveClients or accessGates required' }, { status: 422 })
  }

  try {
    if (typeof body.autoApproveClients === 'boolean') {
      await setAutoApproveClients(body.autoApproveClients, 'giga:super_admin')
    }
    if (typeof body.accessGates === 'boolean') {
      await setAccessGatesEnabled(body.accessGates, 'giga:super_admin')
    }
    const [autoApproveClients, accessGates] = await Promise.all([
      getAutoApproveClients(),
      getAccessGatesEnabled(),
    ])
    return NextResponse.json({ ok: true, autoApproveClients, accessGates })
  } catch (e) {
    console.error('[giga-admin/settings/access]', e)
    return NextResponse.json({ error: 'save_failed' }, { status: 500 })
  }
}
