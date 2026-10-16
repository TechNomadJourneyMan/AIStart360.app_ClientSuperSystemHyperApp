export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/admin/client-scope'
import { commError, guardComm } from '@/lib/comm/admin'
import { RECIPIENT_STATUSES, campaignForActor, listRecipients } from '@/lib/comm/campaign-admin'
import type { RecipientStatus } from '@/lib/comm/campaigns'
import { isCommChannel } from '@/lib/comm/types'

/**
 * GET /api/giga-admin/comm/campaigns/:id/recipients?status=failed|skipped|sent|pending|sending|cancelled&channel=&offset=  (inbox.view)
 * Recipients of the card with the reason of every error / skip, newest change
 * first, 50 per page. Contacts are masked for a role without users.sensitive.
 */
export async function GET(req: NextRequest, { params }: { params: { campaignId: string } }) {
  const g = await guardComm(req, 'inbox.view')
  if (g.response) return g.response
  if (!isUuid(params.campaignId)) return commError('Неверный id')
  const sp = req.nextUrl.searchParams
  const status = sp.get('status') || null
  const channel = sp.get('channel') || null
  if (status && !RECIPIENT_STATUSES.includes(status as RecipientStatus)) return commError('Неверный фильтр')
  if (channel && !isCommChannel(channel)) return commError('Неверный канал')
  try {
    const c = await campaignForActor(g.sb, g.actor, params.campaignId)
    if (!c) return commError('Рассылка не найдена', 404)
    const res = await listRecipients(g.sb, g.actor, c.id, {
      status: status as RecipientStatus | null,
      channel: channel && isCommChannel(channel) ? channel : null,
      offset: Number(sp.get('offset')) || 0,
    })
    return NextResponse.json({ ok: true, ...res })
  } catch (err) {
    console.error('[giga-admin/comm/campaigns/:id/recipients]', err instanceof Error ? err.message : err)
    return commError('Не удалось загрузить получателей', 500)
  }
}
