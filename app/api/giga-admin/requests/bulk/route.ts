export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { decideRequest } from '@/lib/admin/request-decision'

/**
 * POST /api/giga-admin/requests/bulk { action: 'approve'|'reject', ids: string[] (≤ 100), reason? }
 * → { ok, results: [{ id, ok, error }], done, failed }
 *
 * Тридцать заявок — не тридцать циклов «открыл → принял → закрыл». Каждая
 * заявка решается тем же кодом, что и одиночная (decideRequest), результат —
 * по каждой, частичный успех виден в отчёте.
 */

const MAX = 100
const bodySchema = z.object({
  action: z.enum(['approve', 'reject']),
  ids: z.array(z.string().trim().min(1).max(64)).min(1, 'Ничего не выбрано').max(MAX, `Не больше ${MAX} за раз`),
  reason: z.string().trim().max(500).optional(),
})

export async function POST(req: NextRequest) {
  const guard = await requireGiga(req, 'users.approve')
  if (guard.response) return guard.response

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Неверный запрос' }, { status: 400 })
  }
  if (await isRateLimitedKey(guard.actor.id, 'requests-bulk', { max: 20, windowMs: 10 * 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Слишком много массовых операций. Попробуйте позже.' }, { status: 429 })
  }

  const ids = Array.from(new Set(parsed.data.ids))
  const results: Array<{ id: string; ok: boolean; error: string | null }> = []
  for (const id of ids) {
    try {
      const r = await decideRequest(guard.actor, id, parsed.data.action, parsed.data.reason, req)
      results.push(r.ok ? { id, ok: true, error: null } : { id, ok: false, error: r.error })
    } catch (err) {
      results.push({ id, ok: false, error: err instanceof Error ? err.message : 'Ошибка' })
    }
  }

  const done = results.filter((r) => r.ok).length
  await recordAdminAction(guard.actor, {
    action: 'request.bulk_decision',
    entityType: 'request',
    entityId: `batch:${ids.length}`,
    metadata: { action: parsed.data.action, requested: ids.length, done, failed: ids.length - done, reason: parsed.data.reason ?? null },
  }, req)

  return NextResponse.json({ ok: true, results, done, failed: ids.length - done })
}
