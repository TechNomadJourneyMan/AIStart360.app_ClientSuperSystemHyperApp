import { NextResponse, type NextRequest } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { whatsappLinkDelete, whatsappLinkGet, whatsappLinkPost } from '@/lib/whatsapp/link-api'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * WhatsApp of the signed-in staff member (GIGA › Уведомления): staff alerts by
 * level, quiet hours and cooldown like Telegram. Contract: lib/whatsapp/link-api.ts.
 * Only a personal staff account can link a number.
 */
async function guard(req: NextRequest) {
  const g = await requireGiga(req, 'dashboard.view')
  if (g.response) return { response: g.response }
  if (!UUID.test(g.actor.id)) {
    return { response: NextResponse.json({ ok: false, error: 'Привязка доступна только для личного аккаунта сотрудника' }, { status: 403 }) }
  }
  return { actor: g.actor }
}

export async function GET(req: NextRequest) {
  const g = await guard(req)
  if (g.response) return g.response
  return whatsappLinkGet(g.actor.id, 'staff')
}

export async function POST(req: NextRequest) {
  const g = await guard(req)
  if (g.response) return g.response
  const res = await whatsappLinkPost(req, g.actor.id, 'staff')
  if (res.ok) {
    await recordAdminAction(g.actor, { action: 'staff.whatsapp.updated', entityType: 'whatsapp_link', entityId: g.actor.id }, req).catch(() => {})
  }
  return res
}

export async function DELETE(req: NextRequest) {
  const g = await guard(req)
  if (g.response) return g.response
  const res = await whatsappLinkDelete(g.actor.id, 'staff')
  await recordAdminAction(g.actor, { action: 'staff.whatsapp.removed', entityType: 'whatsapp_link', entityId: g.actor.id }, req).catch(() => {})
  return res
}
