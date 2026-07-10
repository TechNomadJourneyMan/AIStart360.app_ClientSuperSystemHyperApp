export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getGigaActor } from '@/lib/admin/giga-actor'
import { logAudit } from '@/lib/audit'
import {
  getAutoApproveClients,
  setAutoApproveClients,
  getAccessGatesEnabled,
  setAccessGatesEnabled,
} from '@/lib/settings/system-settings'

/**
 * GET/PUT /api/giga-admin/settings/access — системные тумблеры Фазы 6:
 *   auto_approve_clients — авто-одобрение self-serve регистраций (№15);
 *   access_gates — включить тарифные гейты (полный GRI / AI-чат / PDF / бенчмарки).
 */
export async function GET(req: NextRequest) {
  if (!(await getGigaActor(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const [autoApproveClients, accessGates] = await Promise.all([
    getAutoApproveClients(),
    getAccessGatesEnabled(),
  ])
  return NextResponse.json({ ok: true, autoApproveClients, accessGates })
}

export async function PUT(req: NextRequest) {
  const actor = await getGigaActor(req)
  if (!actor) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await req.json().catch(() => null)) as {
    autoApproveClients?: unknown
    accessGates?: unknown
  } | null
  if (!body || (typeof body.autoApproveClients !== 'boolean' && typeof body.accessGates !== 'boolean')) {
    return NextResponse.json({ error: 'boolean autoApproveClients or accessGates required' }, { status: 422 })
  }

  try {
    if (typeof body.autoApproveClients === 'boolean') {
      await setAutoApproveClients(body.autoApproveClients, actor.id)
    }
    if (typeof body.accessGates === 'boolean') {
      await setAccessGatesEnabled(body.accessGates, actor.id)
    }

    // These are access-affecting system toggles — audit them like
    // settings/registration (they previously left no audit trail at all).
    await logAudit({
      entityType: 'system',
      entityId: 'access_settings',
      action: 'settings.access_changed',
      performedBy: actor.id,
      diff: {
        after: {
          ...(typeof body.autoApproveClients === 'boolean' ? { autoApproveClients: body.autoApproveClients } : {}),
          ...(typeof body.accessGates === 'boolean' ? { accessGates: body.accessGates } : {}),
        },
        actorKind: actor.kind,
      },
      ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
    })
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
