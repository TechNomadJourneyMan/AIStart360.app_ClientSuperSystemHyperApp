export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { BULK_PERMISSIONS, bulkSchema, runBulkUserAction, validateAssignee, type BulkAction, type BulkItemResult } from '@/lib/admin/bulk-users'

/**
 * POST /api/giga-admin/users/bulk
 *   { action: 'approve'|'reject'|'set_tier'|'assign'|'block'|'archive'|'remind_survey',
 *     ids: uuid[] (≤ 200), reason?, tier?, assigneeId? }
 * → { ok, results: [{ id, ok, error, skipped? }], done, failed }
 *
 * Право на действие — как у одиночного маршрута и проверяется ДО чтения
 * данных; ранг цели — по каждому человеку (см. lib/admin/bulk-users.ts).
 */
export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null)
  const action = (raw as { action?: unknown } | null)?.action
  const known = typeof action === 'string' && Object.prototype.hasOwnProperty.call(BULK_PERMISSIONS, action)

  const guard = await requireGiga(req, known ? ['users.view', ...BULK_PERMISSIONS[action as BulkAction]] : 'users.view')
  if (guard.response) return guard.response

  const parsed = bulkSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Неверный запрос' }, { status: 400 })
  }
  if (await isRateLimitedKey(guard.actor.id, 'users-bulk', { max: 20, windowMs: 10 * 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Слишком много массовых операций. Попробуйте позже.' }, { status: 429 })
  }
  if (parsed.data.action === 'assign') {
    const bad = await validateAssignee(parsed.data.assigneeId)
    if (bad) return NextResponse.json({ ok: false, error: bad }, { status: 400 })
  }

  let results: BulkItemResult[]
  try {
    results = await runBulkUserAction(guard.actor, parsed.data, req)
  } catch (err) {
    console.error('[giga-admin/users/bulk]', err)
    return NextResponse.json({ ok: false, error: 'Не удалось выполнить массовое действие' }, { status: 500 })
  }

  const done = results.filter((r) => r.ok).length
  await recordAdminAction(guard.actor, {
    action: 'user.bulk_action',
    entityType: 'user',
    entityId: `batch:${results.length}`,
    metadata: {
      action: parsed.data.action, requested: results.length, done, failed: results.length - done,
      tier: parsed.data.tier ?? null, assigneeId: parsed.data.assigneeId ?? null,
    },
  }, req)

  return NextResponse.json({ ok: true, results, done, failed: results.length - done })
}
