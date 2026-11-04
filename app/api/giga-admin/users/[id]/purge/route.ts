export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga, staffRoleOfUser } from '@/lib/admin/giga-actor'
import { createServiceClient } from '@/lib/supabase-service'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { guardClientAccess } from '@/lib/admin/client-scope'
import { previewPurge, purgeTargetBlock, purgeUser } from '@/lib/admin/purge-user'

/**
 * Полное удаление пользователя из платформы и БД — Super Admin only.
 *
 * GET  /api/giga-admin/users/:id/purge — предпросмотр: что будет удалено.
 * POST /api/giga-admin/users/:id/purge { confirmEmail, reason } — удаление.
 *
 * В отличие от архивации это НЕОБРАТИМО: учётная запись (auth.users), профиль
 * и все данные пользователя удаляются одной транзакцией в admin_purge_user()
 * (миграция 083), файлы — через Storage API. Остаётся только запись в журнале
 * действий персонала, сделанная ДО удаления со снимком ключевых полей.
 * Сама последовательность — lib/admin/purge-user.ts (общая с массовым удалением).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const bodySchema = z.object({
  confirmEmail: z.string().trim().min(1, 'Введите email пользователя для подтверждения'),
  reason: z.string().trim().min(3, 'Укажите причину').max(300),
})

type Guarded = { response: NextResponse } | { response?: undefined; target: Awaited<ReturnType<typeof staffRoleOfUser>> }

async function guardTarget(id: string, actorId: string): Promise<Guarded> {
  if (!UUID_RE.test(id)) return { response: NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 }) }
  if (id === actorId) return { response: NextResponse.json({ ok: false, error: 'Нельзя удалить себя' }, { status: 400 }) }
  const target = await staffRoleOfUser(id)
  const why = purgeTargetBlock(actorId, id, target)
  if (why) return { response: NextResponse.json({ ok: false, error: why }, { status: target.profileRole ? 403 : 404 }) }
  return { target }
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, 'users.delete')
  if (guard.response) return guard.response
  const scopeDenied = await guardClientAccess(guard.actor, params.id)
  if (scopeDenied) return scopeDenied
  const g = await guardTarget(params.id, guard.actor.id)
  if (g.response) return g.response

  const preview = await previewPurge(createServiceClient(), params.id)
  if (!preview.ok) {
    return NextResponse.json({ ok: false, error: 'Предпросмотр недоступен (применена ли миграция 083?)' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, email: g.target.email, counts: preview.counts })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, 'users.delete')
  if (guard.response) return guard.response
  const scopeDenied = await guardClientAccess(guard.actor, params.id)
  if (scopeDenied) return scopeDenied
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Неверный запрос' }, { status: 400 })
  const g = await guardTarget(params.id, guard.actor.id)
  if (g.response) return g.response
  if (await isRateLimitedKey(guard.actor.id, 'user-purge', { max: 10, windowMs: 10 * 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Слишком много операций. Попробуйте позже.' }, { status: 429 })
  }

  const { confirmEmail, reason } = parsed.data
  const email = g.target.email ?? ''
  if (!email || confirmEmail.toLowerCase() !== email.toLowerCase()) {
    return NextResponse.json({ ok: false, error: 'Email не совпадает с email пользователя' }, { status: 400 })
  }

  const r = await purgeUser(createServiceClient(), guard.actor, { userId: params.id, target: g.target, reason, req })
  if (!r.ok) {
    return r.stage === 'preview'
      ? NextResponse.json({ ok: false, error: 'Удаление недоступно (применена ли миграция 083?)' }, { status: 500 })
      : NextResponse.json({ ok: false, error: 'Не удалось удалить пользователя' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, counts: r.counts, filesFailed: r.filesFailed })
}
