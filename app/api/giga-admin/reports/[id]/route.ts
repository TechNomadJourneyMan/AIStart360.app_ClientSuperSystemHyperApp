import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { apiError, dbError } from '@/lib/api-error'
import { getReportVersion } from '@/lib/reports/versions'
import { REPORT_WRONG_STATUS, transitionReportVersion } from '@/lib/admin/staff-actions'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const Schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('publish'), reason: z.string().trim().max(500).optional() }).strict(),
  z.object({ action: z.literal('reject'), reason: z.string().trim().min(3).max(500) }).strict(),
  z.object({ action: z.literal('withdraw'), reason: z.string().trim().min(3).max(500) }).strict(),
])

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

  const res = await transitionReportVersion({
    id: params.id,
    action,
    reason,
    actorId: g.actor.id,
    audit: (entry, opts) => recordAdminAction(g.actor, entry, req, opts),
  })
  if (!res.ok) {
    switch (res.code) {
      case 'db_load': return dbError('giga-admin/reports/:id', res.err, 'Не удалось загрузить версию отчёта')
      case 'db_write': return dbError('giga-admin/reports/:id', res.err, 'Не удалось изменить статус версии')
      case 'audit_unavailable': return apiError('Журнал аудита недоступен — действие не выполнено', 503)
      case 'not_found': return apiError('Версия отчёта не найдена', 404)
      default: return apiError(REPORT_WRONG_STATUS[action], 409, { status: res.status ?? null })
    }
  }
  return NextResponse.json({ ok: true, status: res.status, superseded: res.superseded })
}
