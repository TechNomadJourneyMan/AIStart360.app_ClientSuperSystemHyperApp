export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { isSameOriginMutation, requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { STAFF_ROLE_LABELS } from '@/lib/admin/rbac'
import {
  VIEW_AS_COOKIE_NAME, VIEW_AS_COOKIE_OPTIONS, VIEW_AS_TTL_SECONDS, VIEWABLE_ROLES, isViewableRole, readViewAs, resolveViewAs, signViewAs,
} from '@/lib/devtools/view-as'

/**
 * «Посмотреть панель как роль» — Dev-tools Super Admin.
 *
 * GET    — текущее состояние режима.
 * POST   { role } — включить: подписанный httpOnly cookie на 2 часа, привязанный
 *          к id Super Admin. Права понижаются в requireGiga (lib/devtools/view-as.ts).
 * DELETE — выйти. Работает всегда: cookie стирается для любого вызова с нашего
 *          origin, а сами Dev-tools проверяют НАСТОЯЩУЮ роль (devtools.use).
 */
const bodySchema = z.object({ role: z.string() })

export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, 'devtools.use')
  if (guard.response) return guard.response
  const claims = await readViewAs(req.cookies.get(VIEW_AS_COOKIE_NAME)?.value)
  const role = resolveViewAs({ realRole: guard.actor.role, actorId: guard.actor.id, claims })
  return NextResponse.json({
    ok: true,
    viewAs: role ? { role, label: STAFF_ROLE_LABELS[role], expiresAt: claims ? new Date(claims.exp * 1000).toISOString() : null } : null,
    roles: VIEWABLE_ROLES.map((r) => ({ role: r, label: STAFF_ROLE_LABELS[r] })),
  })
}

export async function POST(req: NextRequest) {
  const guard = await requireGiga(req, 'devtools.use')
  if (guard.response) return guard.response
  // devtools.use is Super Admin only; the guard here makes the rule explicit.
  if (guard.actor.role !== 'super_admin') return NextResponse.json({ ok: false, error: 'Только для Super Admin' }, { status: 403 })
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  const role = parsed.success ? parsed.data.role : null
  if (!isViewableRole(role)) return NextResponse.json({ ok: false, error: 'Выберите роль персонала (кроме Super Admin)' }, { status: 400 })

  try {
    await recordAdminAction(guard.actor, {
      action: 'devtools.view_as_started',
      entityType: 'devtools', entityId: guard.actor.id,
      newValue: { viewAs: role },
      metadata: { ttlSeconds: VIEW_AS_TTL_SECONDS },
    }, req, { required: true })
  } catch {
    return NextResponse.json({ ok: false, error: 'Журнал действий недоступен — режим не включён' }, { status: 503 })
  }

  let token: string
  try {
    token = await signViewAs(guard.actor.id, role)
  } catch {
    return NextResponse.json({ ok: false, error: 'Не задан секрет подписи cookie (GIGA_COOKIE_SECRET)' }, { status: 500 })
  }
  const res = NextResponse.json({ ok: true, viewAs: { role, label: STAFF_ROLE_LABELS[role] } })
  res.cookies.set(VIEW_AS_COOKIE_NAME, token, VIEW_AS_COOKIE_OPTIONS)
  return res
}

export async function DELETE(req: NextRequest) {
  if (!isSameOriginMutation(req)) return NextResponse.json({ ok: false, error: 'Cross-site request blocked' }, { status: 403 })
  const hadCookie = !!req.cookies.get(VIEW_AS_COOKIE_NAME)?.value
  // Leaving never depends on the audit or on who calls: the cookie only ever
  // downgrades rights, so clearing it is always safe.
  if (hadCookie) {
    const guard = await requireGiga(req, 'devtools.use').catch(() => null)
    if (guard?.actor) {
      const claims = await readViewAs(req.cookies.get(VIEW_AS_COOKIE_NAME)?.value)
      await recordAdminAction(guard.actor, {
        action: 'devtools.view_as_stopped',
        entityType: 'devtools', entityId: guard.actor.id,
        oldValue: { viewAs: isViewableRole(claims?.role) ? claims?.role : null },
      }, req).catch(() => false)
    }
  }
  const res = NextResponse.json({ ok: true })
  res.cookies.set(VIEW_AS_COOKIE_NAME, '', { ...VIEW_AS_COOKIE_OPTIONS, maxAge: 0 })
  return res
}
