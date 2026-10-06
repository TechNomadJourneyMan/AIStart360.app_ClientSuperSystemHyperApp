import { NextResponse, type NextRequest } from 'next/server'
import { getSessionUserId } from '@/lib/current-user'
import { isSameOriginMutation } from '@/lib/admin/giga-actor'
import { whatsappLinkDelete, whatsappLinkGet, whatsappLinkPost } from '@/lib/whatsapp/link-api'

export const dynamic = 'force-dynamic'

/**
 * WhatsApp of the signed-in client (Настройки › Уведомления): number
 * verification by code, opt-in / opt-out for the CRM digest. Contract:
 * lib/whatsapp/link-api.ts.
 */
async function guard(req: NextRequest): Promise<{ userId: string } | { response: NextResponse }> {
  if (!isSameOriginMutation(req)) return { response: NextResponse.json({ ok: false, error: 'Cross-site request blocked' }, { status: 403 }) }
  const userId = await getSessionUserId()
  if (!userId) return { response: NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 }) }
  return { userId }
}

export async function GET(req: NextRequest) {
  const g = await guard(req)
  if ('response' in g) return g.response
  return whatsappLinkGet(g.userId, 'client')
}

export async function POST(req: NextRequest) {
  const g = await guard(req)
  if ('response' in g) return g.response
  return whatsappLinkPost(req, g.userId, 'client')
}

export async function DELETE(req: NextRequest) {
  const g = await guard(req)
  if ('response' in g) return g.response
  return whatsappLinkDelete(g.userId, 'client')
}
