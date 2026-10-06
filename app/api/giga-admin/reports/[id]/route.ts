import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { apiError, dbError } from '@/lib/api-error'
import { getReportVersion, publishReportVersion, retireReportVersion, type TransitionResult } from '@/lib/reports/versions'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const Schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('publish'), reason: z.string().trim().max(500).optional() }).strict(),
  z.object({ action: z.literal('reject'), reason: z.string().trim().min(3).max(500) }).strict(),
  z.object({ action: z.literal('withdraw'), reason: z.string().trim().min(3).max(500) }).strict(),
])

const TARGET: Record<'publish' | 'reject' | 'withdraw', string> = { publish: 'published', reject: 'superseded', withdraw: 'superseded' }
const WRONG_STATUS: Record<'publish' | 'reject' | 'withdraw', string> = {
  publish: 'Опубликовать можно только версию в статусе «Готов к проверке»',
  reject: 'Отклонить можно только неопубликованную версию',
  withdraw: 'Отозвать можно только опубликованную версию',
}

/** GET /api/giga-admin/reports/:id — one version with its frozen content and provenance. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await requireGiga(req, 'agents.view')
  if (g.response) return g.response
  if (!UUID.test(params.id)) return apiError('Версия отчёта не найдена', 404)
  try {
    const item = await getReportVersion(params.id)
    if (!item) return apiError('Версия отчёта не найдена', 404)
    return NextResponse.json({
      ok: true,
      item,
      can: { publish: g.actor.permissions.includes('reports.publish'), run: g.actor.permissions.includes('agents.run') },
    })
  } catch (err) {
    return dbError('giga-admin/reports/:id', err as { message?: string; code?: string }, 'Не удалось загрузить версию отчёта')
  }
}

/**
 * POST /api/giga-admin/reports/:id { action: publish | reject | withdraw, reason }
 *   publish   ready → published (the previous published version → superseded)
 *   reject    ready / draft → superseded, with a reason
 *   withdraw  published → superseded (the client stops seeing it), with a reason
 * The audit entry is written first; without it nothing changes.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await requireGiga(req, 'reports.publish')
  if (g.response) return g.response
  if (!UUID.test(params.id)) return apiError('Версия отчёта не найдена', 404)
  const parsed = Schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return apiError('Неверные данные: для отклонения и отзыва нужна причина (от 3 символов)', 400)
  }
  const { action } = parsed.data
  const reason = parsed.data.reason?.trim() || null

  let current
  try {
    current = await getReportVersion(params.id)
  } catch (err) {
    return dbError('giga-admin/reports/:id', err as { message?: string; code?: string }, 'Не удалось загрузить версию отчёта')
  }
  if (!current) return apiError('Версия отчёта не найдена', 404)

  try {
    await recordAdminAction(g.actor, {
      action: `report.${action}`,
      entityType: 'report_version',
      entityId: params.id,
      oldValue: { status: current.status },
      newValue: { status: TARGET[action], reason },
      metadata: { company_id: current.company_id, report_type: current.report_type, version: current.version, data_hash: current.data_hash },
    }, req, { required: true })
  } catch {
    return apiError('Журнал аудита недоступен — действие не выполнено', 503)
  }

  let res: TransitionResult
  try {
    res = action === 'publish'
      ? await publishReportVersion(params.id, g.actor.id)
      : await retireReportVersion(params.id, action, g.actor.id, reason ?? '')
  } catch (err) {
    return dbError('giga-admin/reports/:id', err as { message?: string; code?: string }, 'Не удалось изменить статус версии')
  }
  if (!res.ok) {
    return res.reason === 'not_found'
      ? apiError('Версия отчёта не найдена', 404)
      : apiError(WRONG_STATUS[action], 409, { status: res.status ?? null })
  }
  return NextResponse.json({ ok: true, status: res.status, superseded: res.superseded })
}
