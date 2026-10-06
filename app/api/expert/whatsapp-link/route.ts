import { NextResponse, type NextRequest } from 'next/server'
import { requireExpert } from '@/lib/expert-auth'
import { isSameOriginMutation } from '@/lib/admin/giga-actor'
import { whatsappLinkDelete, whatsappLinkGet, whatsappLinkPost } from '@/lib/whatsapp/link-api'

export const dynamic = 'force-dynamic'

/**
 * WhatsApp of the signed-in expert (expert notifications, «отчёт на
 * проверку»). Same gate as every /api/expert/* route (requireExpert).
 * Contract: lib/whatsapp/link-api.ts.
 */
async function guard(req: NextRequest): Promise<{ userId: string } | { response: NextResponse }> {
  if (!isSameOriginMutation(req)) return { response: NextResponse.json({ ok: false, error: 'Cross-site request blocked' }, { status: 403 }) }
  const viewer = await requireExpert()
  if (!viewer) return { response: NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 }) }
  return { userId: viewer.id }
}

export async function GET(req: NextRequest) {
  const g = await guard(req)
  if ('response' in g) return g.response
  return whatsappLinkGet(g.userId, 'expert')
}

export async function POST(req: NextRequest) {
  const g = await guard(req)
  if ('response' in g) return g.response
  return whatsappLinkPost(req, g.userId, 'expert')
}

export async function DELETE(req: NextRequest) {
  const g = await guard(req)
  if ('response' in g) return g.response
  return whatsappLinkDelete(g.userId, 'expert')
}
