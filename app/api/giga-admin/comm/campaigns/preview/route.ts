export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { commError, guardComm } from '@/lib/comm/admin'
import { normalizeAudience } from '@/lib/comm/audience'
import { AudienceSchema, ChannelsSchema } from '@/lib/comm/campaign-admin'
import { previewAudience } from '@/lib/comm/campaigns'
import { CommError } from '@/lib/comm/store'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { withDeadline } from '@/lib/runtime/deadline'

/**
 * POST /api/giga-admin/comm/campaigns/preview  (inbox.manage)
 *   { channels, audience } → how many people the broadcast reaches: users,
 *   per channel «уйдёт» / «не дойдёт» with the reasons (no email, Telegram not
 *   linked, WhatsApp opt-out, blocked…), whether the audience is above the
 *   limit, picked users outside the staff member's scope. Writes nothing.
 */

const Body = z.object({ channels: ChannelsSchema, audience: AudienceSchema })

async function handlePost(req: NextRequest) {
  const g = await guardComm(req, 'inbox.manage')
  if (g.response) return g.response
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return commError('Неверный запрос: каналы и аудитория')
  const audience = normalizeAudience(parsed.data.audience, g.actor.id)
  if (!audience) return commError('Неверная аудитория')
  if (await isRateLimitedKey(g.actor.id, 'comm-campaign-preview', { max: 20, windowMs: 60_000 })) {
    return commError('Слишком много запросов — подождите минуту', 429)
  }
  try {
    const { preview } = await previewAudience(g.sb, g.actor, audience, parsed.data.channels)
    return NextResponse.json({ ok: true, data: preview })
  } catch (err) {
    if (err instanceof CommError && err.code !== 'db') return commError(err.message)
    console.error('[giga-admin/comm/campaigns/preview]', err instanceof Error ? err.message : err)
    return commError('Не удалось посчитать получателей', 500)
  }
}

/**
 * R-015: on Railway `next start` ignores maxDuration, so the request had no time limit. After 60 s the client
 * gets 504 (DEADLINE_EXCEEDED) and the work below sees its deadline spent. ROUTE_DEADLINE_MS_COMM_CAMPAIGN_PREVIEW overrides it;
 * ROUTE_DEADLINE_DISABLED=1 turns it off.
 */
export const POST = withDeadline(handlePost, { label: 'comm-campaign-preview', ms: 60_000 })
