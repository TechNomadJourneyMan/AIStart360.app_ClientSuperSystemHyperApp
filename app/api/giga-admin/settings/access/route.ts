export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { logAudit } from '@/lib/audit'
import {
  getAutoApproveClients,
  setAutoApproveClients,
  getAccessGatesEnabled,
  setAccessGatesEnabled,
  getInsightModerationEnabled,
  setInsightModerationEnabled,
} from '@/lib/settings/system-settings'

/**
 * GET/PUT /api/giga-admin/settings/access — системные тумблеры Фазы 6:
 *   auto_approve_clients — авто-одобрение self-serve регистраций (№15);
 *   access_gates — включить тарифные гейты (полный GRI / AI-чат / PDF / бенчмарки).
 */
export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, 'users.manage')
  if (guard.response) return guard.response
  const [autoApproveClients, accessGates, insightModeration] = await Promise.all([
    getAutoApproveClients(),
    getAccessGatesEnabled(),
    getInsightModerationEnabled(),
  ])
  return NextResponse.json({ ok: true, autoApproveClients, accessGates, insightModeration })
}

export async function PUT(req: NextRequest) {
  const guard = await requireGiga(req, 'settings.manage')
  if (guard.response) return guard.response
  const actor = guard.actor

  const body = (await req.json().catch(() => null)) as {
    autoApproveClients?: unknown
    accessGates?: unknown
    insightModeration?: unknown
  } | null
  if (
    !body ||
    (typeof body.autoApproveClients !== 'boolean' &&
      typeof body.accessGates !== 'boolean' &&
      typeof body.insightModeration !== 'boolean')
  ) {
    return NextResponse.json(
      { error: 'boolean autoApproveClients, accessGates or insightModeration required' },
      { status: 422 },
    )
  }

  try {
    const [beforeAuto, beforeGates, beforeModeration] = await Promise.all([
      getAutoApproveClients(),
      getAccessGatesEnabled(),
      getInsightModerationEnabled(),
    ])
    if (typeof body.autoApproveClients === 'boolean') {
      await setAutoApproveClients(body.autoApproveClients, actor.id)
    }
    if (typeof body.accessGates === 'boolean') {
      await setAccessGatesEnabled(body.accessGates, actor.id)
    }
    if (typeof body.insightModeration === 'boolean') {
      // Выключение = автопубликация ИИ-инсайтов без проверки эксперта —
      // осознанное критичное решение, фиксируется в аудите ниже.
      await setInsightModerationEnabled(body.insightModeration, actor.id)
    }

    // These are access-affecting system toggles — audit them like
    // settings/registration (they previously left no audit trail at all).
    await logAudit({
      entityType: 'system',
      entityId: 'access_settings',
      action: 'settings.access_changed',
      performedBy: actor.id,
      diff: {
        before: {
          ...(typeof body.autoApproveClients === 'boolean' ? { autoApproveClients: beforeAuto } : {}),
          ...(typeof body.accessGates === 'boolean' ? { accessGates: beforeGates } : {}),
          ...(typeof body.insightModeration === 'boolean' ? { insightModeration: beforeModeration } : {}),
        },
        after: {
          ...(typeof body.autoApproveClients === 'boolean' ? { autoApproveClients: body.autoApproveClients } : {}),
          ...(typeof body.accessGates === 'boolean' ? { accessGates: body.accessGates } : {}),
          ...(typeof body.insightModeration === 'boolean' ? { insightModeration: body.insightModeration } : {}),
        },
        actorKind: actor.kind,
      },
      ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
    })
    const [autoApproveClients, accessGates, insightModeration] = await Promise.all([
      getAutoApproveClients(),
      getAccessGatesEnabled(),
      getInsightModerationEnabled(),
    ])
    return NextResponse.json({ ok: true, autoApproveClients, accessGates, insightModeration })
  } catch (e) {
    console.error('[giga-admin/settings/access]', e)
    return NextResponse.json({ error: 'Не удалось сохранить настройку. Попробуйте ещё раз; если ошибка повторяется — проверьте журнал сервера.' }, { status: 500 })
  }
}
