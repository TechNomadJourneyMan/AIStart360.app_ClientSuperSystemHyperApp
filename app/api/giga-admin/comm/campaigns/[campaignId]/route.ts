export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { recordAdminAction } from '@/lib/admin/audit'
import { isUuid } from '@/lib/admin/client-scope'
import { hasPermission } from '@/lib/admin/rbac'
import { commError, guardComm } from '@/lib/comm/admin'
import { campaignDTO, campaignForActor, scheduleInfo, staffNames } from '@/lib/comm/campaign-admin'
import { changeCampaignStatus, channelProgress, startCampaign } from '@/lib/comm/campaigns'
import { CommError } from '@/lib/comm/store'

/**
 * GET   /api/giga-admin/comm/campaigns/:id  (inbox.view)
 *   The card: text, audience, status, counters, progress per channel.
 *   The page polls it only while the card is open and the tab is visible.
 * PATCH /api/giga-admin/comm/campaigns/:id  (inbox.manage)
 *   { action: 'start' | 'pause' | 'resume' | 'cancel' } — 409 when the status
 *   does not allow it (someone was faster). Audit: comm.campaign.<action>.
 * A campaign the staff member may not see (another author, «только
 * назначенные») is 404 — like one that does not exist.
 */

type Ctx = { params: { campaignId: string } }

export async function GET(req: NextRequest, { params }: Ctx) {
  const g = await guardComm(req, 'inbox.view')
  if (g.response) return g.response
  if (!isUuid(params.campaignId)) return commError('Неверный id')
  try {
    const c = await campaignForActor(g.sb, g.actor, params.campaignId)
    if (!c) return commError('Рассылка не найдена', 404)
    const [progress, names, schedule] = await Promise.all([channelProgress(g.sb, c), staffNames(g.sb, [c.created_by]), scheduleInfo()])
    return NextResponse.json({ ok: true, data: { ...campaignDTO(c, names), progress }, schedule, can: { manage: hasPermission(g.actor.role, 'inbox.manage') } })
  } catch (err) {
    console.error('[giga-admin/comm/campaigns/:id]', err instanceof Error ? err.message : err)
    return commError('Не удалось загрузить рассылку', 500)
  }
}

const Body = z.object({ action: z.enum(['start', 'pause', 'resume', 'cancel']) })

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const g = await guardComm(req, 'inbox.manage')
  if (g.response) return g.response
  if (!isUuid(params.campaignId)) return commError('Неверный id')
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return commError('Неверное действие')
  const { action } = parsed.data
  try {
    const c = await campaignForActor(g.sb, g.actor, params.campaignId)
    if (!c) return commError('Рассылка не найдена', 404)

    let updated
    let engine: boolean | null = null
    if (action === 'start') {
      if (c.status !== 'draft') return commError('Запустить можно только черновик', 409)
      try {
        const started = await startCampaign(g.sb, g.actor, c)
        updated = started.campaign
        engine = started.engine
      } catch (err) {
        if (err instanceof CommError && err.code !== 'db') return commError(err.message)
        throw err
      }
    } else {
      updated = await changeCampaignStatus(g.sb, c, action)
      if (!updated) return commError('Статус рассылки уже изменился — обновите страницу', 409)
    }

    await recordAdminAction(g.actor, {
      action: `comm.campaign.${action === 'start' ? 'started' : action === 'pause' ? 'paused' : action === 'resume' ? 'resumed' : 'cancelled'}`,
      entityType: 'comm_campaign', entityId: c.id,
      oldValue: { status: c.status },
      newValue: { status: updated.status, sent: updated.sent_count, failed: updated.failed_count, skipped: updated.skipped_count, total: updated.total_count },
    }, req)
    const names = await staffNames(g.sb, [updated.created_by])
    return NextResponse.json({ ok: true, data: campaignDTO(updated, names), engine })
  } catch (err) {
    console.error('[giga-admin/comm/campaigns/:id PATCH]', err instanceof Error ? err.message : err)
    return commError('Не удалось изменить рассылку', 500)
  }
}
