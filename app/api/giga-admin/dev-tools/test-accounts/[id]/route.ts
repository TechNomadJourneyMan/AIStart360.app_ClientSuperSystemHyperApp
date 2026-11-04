export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { createServiceClient } from '@/lib/supabase-service'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { purgeUser, purgeTargetBlock } from '@/lib/admin/purge-user'
import { isTestEmail } from '@/lib/devtools/test-accounts'
import { loadTestAccount, setTestAccountStatus } from '@/lib/devtools/test-accounts-server'

/**
 * Один тестовый аккаунт (Dev-tools, devtools.use).
 *
 * PATCH  { status: approved | pending_approval | blocked } — сменить статус.
 * DELETE — удалить аккаунт полностью (admin_purge_user).
 *
 * Работает ТОЛЬКО с профилями is_test = true в домене test.aistart360.app;
 * живых пользователей удаляют в User 360 (users.delete, с подтверждением email).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const statusSchema = z.object({ status: z.enum(['approved', 'pending_approval', 'blocked']) })

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, 'devtools.use')
  if (guard.response) return guard.response
  if (!UUID_RE.test(params.id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })
  const parsed = statusSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Неизвестный статус' }, { status: 400 })
  if (params.id === guard.actor.id) return NextResponse.json({ ok: false, error: 'Свой статус менять нельзя' }, { status: 400 })

  const sb = createServiceClient()
  const t = await loadTestAccount(sb, params.id)
  if (!t.ok) return NextResponse.json({ ok: false, error: t.error }, { status: t.status })
  const { status } = parsed.data
  if (t.row.status === status) return NextResponse.json({ ok: true, unchanged: true })

  try {
    await recordAdminAction(guard.actor, {
      action: 'devtools.test_account_status',
      entityType: 'user', entityId: params.id, targetUserId: params.id,
      oldValue: { status: t.row.status }, newValue: { status },
      metadata: { source: 'devtools', testAccount: true },
    }, req, { required: true })
  } catch {
    return NextResponse.json({ ok: false, error: 'Журнал действий недоступен — статус не изменён' }, { status: 503 })
  }
  const out = await setTestAccountStatus(sb, params.id, status)
  if (!out.ok) {
    console.error('[dev-tools/test-accounts] status failed:', out.error)
    return NextResponse.json({ ok: false, error: `Не удалось сменить статус: ${out.error}` }, { status: 409 })
  }
  return NextResponse.json({ ok: true, status })
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, 'devtools.use')
  if (guard.response) return guard.response
  if (!UUID_RE.test(params.id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })
  if (await isRateLimitedKey(guard.actor.id, 'devtools-test-purge', { max: 30, windowMs: 10 * 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Слишком много операций. Попробуйте позже.' }, { status: 429 })
  }

  const sb = createServiceClient()
  const t = await loadTestAccount(sb, params.id)
  if (!t.ok) return NextResponse.json({ ok: false, error: t.error }, { status: t.status })
  if (!isTestEmail(t.row.email)) {
    return NextResponse.json({ ok: false, error: 'Адрес не в тестовом домене — удалите аккаунт из User 360' }, { status: 403 })
  }
  const target = { staffRole: t.row.staffRole, profileRole: t.row.role, status: t.row.status, email: t.row.email }
  const blocked = purgeTargetBlock(guard.actor.id, params.id, target)
  if (blocked) return NextResponse.json({ ok: false, error: blocked }, { status: 403 })

  try {
    const out = await purgeUser(sb, guard.actor, {
      userId: params.id, target, req,
      reason: 'Dev-tools: удаление тестового аккаунта',
      metadata: { source: 'devtools', testAccount: true },
    })
    if (!out.ok) return NextResponse.json({ ok: false, error: 'Не удалось удалить аккаунт (применена ли миграция 083?)' }, { status: 500 })
    return NextResponse.json({ ok: true, counts: out.counts, filesFailed: out.filesFailed })
  } catch {
    return NextResponse.json({ ok: false, error: 'Журнал действий недоступен — аккаунт не удалён' }, { status: 503 })
  }
}
