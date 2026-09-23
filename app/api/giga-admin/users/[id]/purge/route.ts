export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga, staffRoleOfUser } from '@/lib/admin/giga-actor'
import { createServiceClient } from '@/lib/supabase-service'
import { recordAdminAction } from '@/lib/admin/audit'
import { isRateLimitedKey } from '@/lib/rate-limit'

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
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const bodySchema = z.object({
  confirmEmail: z.string().trim().min(1, 'Введите email пользователя для подтверждения'),
  reason: z.string().trim().min(3, 'Укажите причину').max(300),
})

type PurgeResult = {
  found: boolean
  counts?: Record<string, number>
  storage?: Array<{ bucket: string; name: string }>
}

type Guarded = { response: NextResponse } | { response?: undefined; actorId: string; target: Awaited<ReturnType<typeof staffRoleOfUser>> }

async function guardTarget(id: string, actorId: string): Promise<Guarded> {
  if (!UUID_RE.test(id)) return { response: NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 }) }
  if (id === actorId) return { response: NextResponse.json({ ok: false, error: 'Нельзя удалить себя' }, { status: 400 }) }
  const target = await staffRoleOfUser(id)
  if (!target.profileRole) return { response: NextResponse.json({ ok: false, error: 'Пользователь не найден' }, { status: 404 }) }
  if (target.profileRole === 'super_admin' || target.staffRole === 'super_admin') {
    return { response: NextResponse.json({ ok: false, error: 'Super Admin удалить нельзя — сначала снимите роль' }, { status: 403 }) }
  }
  return { actorId, target }
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, 'users.delete')
  if (guard.response) return guard.response
  const g = await guardTarget(params.id, guard.actor.id)
  if (g.response) return g.response

  const { data, error } = await createServiceClient().rpc('admin_purge_user', { p_user_id: params.id, p_dry_run: true })
  if (error) {
    console.error('[purge] preview failed:', error.message)
    return NextResponse.json({ ok: false, error: 'Предпросмотр недоступен (применена ли миграция 083?)' }, { status: 500 })
  }
  const r = data as PurgeResult
  return NextResponse.json({ ok: true, email: g.target.email, counts: r.counts ?? {} })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, 'users.delete')
  if (guard.response) return guard.response
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

  const sb = createServiceClient()
  const preview = await sb.rpc('admin_purge_user', { p_user_id: params.id, p_dry_run: true })
  if (preview.error) {
    console.error('[purge] preview failed:', preview.error.message)
    return NextResponse.json({ ok: false, error: 'Удаление недоступно (применена ли миграция 083?)' }, { status: 500 })
  }
  const { data: profile } = await sb.from('profiles').select('full_name, organization, created_at').eq('id', params.id).maybeSingle()

  // Журнал ДО удаления: если запись не легла — удаления не будет.
  await recordAdminAction(guard.actor, {
    action: 'user.purged',
    entityType: 'user', entityId: params.id, targetUserId: params.id,
    oldValue: { email, role: g.target.profileRole, staffRole: g.target.staffRole, status: g.target.status, ...(profile ?? {}) },
    newValue: null,
    metadata: { reason, counts: (preview.data as PurgeResult).counts ?? {} },
  }, req, { required: true })

  const { data, error } = await sb.rpc('admin_purge_user', { p_user_id: params.id, p_dry_run: false })
  if (error) {
    console.error('[purge] failed:', error.message)
    // The journal is append-only and already says «purged» — record that it did not happen.
    await recordAdminAction(guard.actor, {
      action: 'user.purge_failed',
      entityType: 'user', entityId: params.id, targetUserId: params.id,
      metadata: { reason, error: error.message.slice(0, 300) },
    }, req).catch(() => false)
    return NextResponse.json({ ok: false, error: 'Не удалось удалить пользователя' }, { status: 500 })
  }
  const result = data as PurgeResult

  // Файлы — после успешной транзакции: осиротевший файл лучше, чем пользователь без файлов.
  const byBucket = new Map<string, string[]>()
  for (const o of result.storage ?? []) byBucket.set(o.bucket, [...(byBucket.get(o.bucket) ?? []), o.name])
  let filesFailed = 0
  for (const [bucket, names] of Array.from(byBucket)) {
    for (let i = 0; i < names.length; i += 100) {
      const chunk = names.slice(i, i + 100)
      const { error: rmErr } = await sb.storage.from(bucket).remove(chunk)
      if (rmErr) {
        filesFailed += chunk.length
        console.error(`[purge] storage remove failed in ${bucket}:`, rmErr.message)
      }
    }
  }

  return NextResponse.json({ ok: true, counts: result.counts ?? {}, filesFailed })
}
