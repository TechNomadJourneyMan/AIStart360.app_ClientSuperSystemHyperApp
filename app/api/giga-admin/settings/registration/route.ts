export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getGigaActor } from '@/lib/admin/giga-actor'
import { logAudit } from '@/lib/audit'
import { getRegistrationMode, setRegistrationMode, isRegistrationMode } from '@/lib/settings/system-settings'

// GET /api/giga-admin/settings/registration — current registration mode.
export async function GET(req: NextRequest) {
  if (!(await getGigaActor(req))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const mode = await getRegistrationMode()
  return NextResponse.json({ mode })
}

// PUT /api/giga-admin/settings/registration — set the mode (open|approval|invite).
export async function PUT(req: NextRequest) {
  const actor = await getGigaActor(req)
  if (!actor) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  if (!isRegistrationMode(body.mode)) {
    return NextResponse.json(
      { error: 'Некорректный режим (open | approval | invite)' },
      { status: 400 },
    )
  }

  try {
    await setRegistrationMode(body.mode)

    await logAudit({
      entityType: 'system',
      entityId: 'registration_mode',
      action: 'settings.registration_mode_changed',
      performedBy: actor.id,
      diff: { after: { mode: body.mode }, actorKind: actor.kind },
      ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
    })

    return NextResponse.json({ ok: true, mode: body.mode })
  } catch (error) {
    console.error('[giga-admin/settings/registration] PUT error:', error)
    return NextResponse.json(
      { error: 'Не удалось сохранить настройку (применена ли миграция 040?)' },
      { status: 500 },
    )
  }
}
