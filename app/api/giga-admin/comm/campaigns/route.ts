export const dynamic = 'force-dynamic'
// «Создать и запустить» writes up to 20 000 recipient rows in batches of 500.
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { recordAdminAction } from '@/lib/admin/audit'
import { commError, guardComm } from '@/lib/comm/admin'
import { normalizeAudience } from '@/lib/comm/audience'
import {
  AudienceSchema, CampaignTextSchema, ChannelsSchema, campaignDTO, cleanCampaignText, listCampaigns, scheduleInfo, staffNames,
} from '@/lib/comm/campaign-admin'
import { createCampaign, startCampaign } from '@/lib/comm/campaigns'
import { CommError } from '@/lib/comm/store'
import { hasPermission } from '@/lib/admin/rbac'
import { profanityResponse } from '@/lib/moderation/http'
import { isRateLimitedKey } from '@/lib/rate-limit'

/**
 * GET  /api/giga-admin/comm/campaigns?status=  (inbox.view)
 *   Broadcasts, newest first, with counters; the working hours and pacing
 *   (`schedule`) for the page. A staff member with «только назначенные» sees
 *   only his own broadcasts.
 *
 * POST /api/giga-admin/comm/campaigns  (inbox.manage)
 *   { title, body, subject?, channels: [...], audience: { kind:'filters', filters } | { kind:'users', userIds }, start?: boolean }
 *   Creates a draft; with start: true also writes the recipients and starts
 *   sending (only in the working hours, one message per ~10–15 s). Profanity in
 *   title / subject / body → 400 naming the field. Audit: comm.campaign.created
 *   (+ comm.campaign.started).
 */

const STATUSES = new Set(['draft', 'scheduled', 'running', 'paused', 'done', 'cancelled'])

export async function GET(req: NextRequest) {
  const g = await guardComm(req, 'inbox.view')
  if (g.response) return g.response
  const status = req.nextUrl.searchParams.get('status') || null
  if (status && !STATUSES.has(status)) return commError('Неверный фильтр')
  try {
    const [data, schedule] = await Promise.all([listCampaigns(g.sb, g.actor, { status }), scheduleInfo()])
    return NextResponse.json({ ok: true, data, schedule, can: { manage: hasPermission(g.actor.role, 'inbox.manage') } })
  } catch (err) {
    console.error('[giga-admin/comm/campaigns]', err instanceof Error ? err.message : err)
    return commError('Не удалось загрузить рассылки', 500)
  }
}

const Body = CampaignTextSchema.extend({
  channels: ChannelsSchema,
  audience: AudienceSchema,
  start: z.boolean().optional(),
})

export async function POST(req: NextRequest) {
  const g = await guardComm(req, 'inbox.manage')
  if (g.response) return g.response
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return commError('Неверный запрос: название, текст, каналы и аудитория')
  const bad = profanityResponse({ title: parsed.data.title, subject: parsed.data.subject ?? null, body: parsed.data.body })
  if (bad) return bad
  const text = cleanCampaignText(parsed.data.body)
  if ('error' in text) return commError(text.error)
  const audience = normalizeAudience(parsed.data.audience, g.actor.id)
  if (!audience) return commError('Неверная аудитория')
  if (await isRateLimitedKey(g.actor.id, 'comm-campaign', { max: 10, windowMs: 60_000 })) {
    return commError('Слишком много запросов — подождите минуту', 429)
  }

  try {
    let campaign = await createCampaign(g.sb, g.actor.id, {
      title: parsed.data.title, body: text.body, subject: parsed.data.subject || null, channels: parsed.data.channels, audience,
    })
    await recordAdminAction(g.actor, {
      action: 'comm.campaign.created', entityType: 'comm_campaign', entityId: campaign.id,
      newValue: { title: campaign.title, subject: campaign.subject, body: campaign.body.slice(0, 500), channels: campaign.channels, audience },
    }, req)

    let engine: boolean | null = null
    if (parsed.data.start) {
      try {
        const started = await startCampaign(g.sb, g.actor, campaign)
        campaign = started.campaign
        engine = started.engine
      } catch (err) {
        // The draft stays — it can be fixed and started from its card.
        if (err instanceof CommError && err.code !== 'db') {
          return NextResponse.json({ ok: false, error: err.message, data: campaignDTO(campaign) }, { status: 400 })
        }
        throw err
      }
      await recordAdminAction(g.actor, {
        action: 'comm.campaign.started', entityType: 'comm_campaign', entityId: campaign.id,
        newValue: { total: campaign.total_count, skipped: campaign.skipped_count },
      }, req)
    }
    const names = await staffNames(g.sb, [campaign.created_by])
    return NextResponse.json({ ok: true, data: campaignDTO(campaign, names), engine })
  } catch (err) {
    console.error('[giga-admin/comm/campaigns POST]', err instanceof Error ? err.message : err)
    return commError('Не удалось создать рассылку', 500)
  }
}
