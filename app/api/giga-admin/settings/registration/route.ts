export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { logAudit } from '@/lib/audit'
import { getRegistrationMode, setRegistrationMode, isRegistrationMode } from '@/lib/settings/system-settings'

// GET /api/giga-admin/settings/registration — current registration mode.
export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, 'users.manage')
  if (guard.response) return guard.response
  const mode = await getRegistrationMode()
  return NextResponse.json({ mode })
}

// PUT /api/giga-admin/settings/registration — set the mode (open|approval|invite).
export async function PUT(req: NextRequest) {
  const guard = await requireGiga(req, 'settings.manage')
  if (guard.response) return guard.response
  const actor = guard.actor

  const body = await req.json().catch(() => ({}))
  if (!isRegistrationMode(body.mode)) {
    return NextResponse.json(
      { error: 'Некорректный режим (open | approval | invite)' },
      { status: 400 },
    )
  }

  try {
    const before = await getRegistrationMode()
    await setRegistrationMode(body.mode, actor.id)

    await logAudit({
      entityType: 'system',
      entityId: 'registration_mode',
      action: 'settings.registration_mode_changed',
      performedBy: actor.id,
      diff: { before: { mode: before }, after: { mode: body.mode }, actorKind: actor.kind },
      ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
    })

    return NextResponse.json({ ok: true, mode: body.mode })
  } catch (error) {
    console.error('[giga-admin/settings/registration] PUT error:', error)
    return NextResponse.json(
      { error: 'Не удалось сохранить режим регистрации. Попробуйте ещё раз.' },
      { status: 500 },
    )
  }
}
