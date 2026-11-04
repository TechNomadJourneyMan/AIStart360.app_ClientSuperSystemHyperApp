export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { createServiceClient } from '@/lib/supabase-service'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { purgeUser } from '@/lib/admin/purge-user'
import { TEST_ACCOUNT_KIND_KEYS, isTestEmail, testAccountKind } from '@/lib/devtools/test-accounts'
import { createTestAccount, listTestAccounts } from '@/lib/devtools/test-accounts-server'

/**
 * Тестовые аккаунты Dev-tools (Super Admin, право devtools.use).
 *
 * GET    — список аккаунтов с profiles.is_test = true.
 * POST   { kind, withCompany? } — создать аккаунт роли / состояния; пароль
 *        возвращается ОДИН раз и нигде не хранится. Не чаще 20 в час.
 * DELETE { confirm: 'УДАЛИТЬ' } — удалить все тестовые аккаунты (полное
 *        удаление admin_purge_user, каждый — с записью в журнал).
 *
 * Удаляются только аккаунты, у которых И is_test = true, И адрес в домене
 * test.aistart360.app: случайно помеченный живой аккаунт не пострадает.
 */
const createSchema = z.object({
  kind: z.enum(TEST_ACCOUNT_KIND_KEYS),
  withCompany: z.boolean().optional(),
})
const purgeAllSchema = z.object({ confirm: z.literal('УДАЛИТЬ') })

export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, 'devtools.use')
  if (guard.response) return guard.response
  const res = await listTestAccounts(createServiceClient())
  if (!res.ok) {
    if (res.migration) return NextResponse.json({ ok: true, migrationRequired: true, message: res.error, data: [] })
    return NextResponse.json({ ok: false, error: 'Не удалось загрузить тестовые аккаунты' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, migrationRequired: false, data: res.rows.map((r) => ({ ...r, deletable: isTestEmail(r.email) })) })
}

export async function POST(req: NextRequest) {
  const guard = await requireGiga(req, 'devtools.use')
  if (guard.response) return guard.response
  const parsed = createSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Выберите тип тестового аккаунта' }, { status: 400 })
  const kind = testAccountKind(parsed.data.kind)
  if (!kind) return NextResponse.json({ ok: false, error: 'Неизвестный тип аккаунта' }, { status: 400 })
  if (await isRateLimitedKey(guard.actor.id, 'devtools-test-account', { max: 20, windowMs: 60 * 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Не больше 20 тестовых аккаунтов в час. Попробуйте позже.' }, { status: 429 })
  }

  try {
    const out = await createTestAccount(createServiceClient(), guard.actor, kind, { withCompany: parsed.data.withCompany, req })
    if (!out.ok) return NextResponse.json({ ok: false, error: out.error, ...(out.status === 409 ? { migrationRequired: true } : {}) }, { status: out.status })
    return NextResponse.json({ ok: true, data: { id: out.id, email: out.email, password: out.password, companyId: out.companyId, kind: kind.key, label: kind.label, client: kind.client } })
  } catch (e) {
    console.error('[dev-tools/test-accounts] create failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ ok: false, error: 'Журнал действий недоступен — аккаунт не создан' }, { status: 503 })
  }
}

export async function DELETE(req: NextRequest) {
  const guard = await requireGiga(req, 'devtools.use')
  if (guard.response) return guard.response
  const parsed = purgeAllSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Для подтверждения передайте confirm: «УДАЛИТЬ»' }, { status: 400 })
  if (await isRateLimitedKey(guard.actor.id, 'devtools-test-purge-all', { max: 5, windowMs: 10 * 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Слишком много операций. Попробуйте позже.' }, { status: 429 })
  }

  const sb = createServiceClient()
  const list = await listTestAccounts(sb, 200)
  if (!list.ok) {
    return NextResponse.json({ ok: false, error: list.error, ...(list.migration ? { migrationRequired: true } : {}) }, { status: list.migration ? 409 : 500 })
  }
  const targets = list.rows.filter((r) => r.id !== guard.actor.id && r.role !== 'super_admin' && r.staff_role !== 'super_admin' && isTestEmail(r.email))
  const skipped = list.rows.length - targets.length

  try {
    await recordAdminAction(guard.actor, {
      action: 'devtools.test_accounts_purge_all',
      entityType: 'devtools', entityId: guard.actor.id,
      oldValue: { count: targets.length, emails: targets.map((t) => t.email) },
      metadata: { skipped },
    }, req, { required: true })
  } catch {
    return NextResponse.json({ ok: false, error: 'Журнал действий недоступен — ничего не удалено' }, { status: 503 })
  }

  let deleted = 0
  let filesFailed = 0
  const failed: Array<{ email: string | null; error: string }> = []
  for (const t of targets) {
    try {
      const out = await purgeUser(sb, guard.actor, {
        userId: t.id,
        target: { staffRole: t.staff_role, profileRole: t.role, status: t.status, email: t.email },
        reason: 'Dev-tools: удаление всех тестовых аккаунтов',
        req,
        metadata: { source: 'devtools', testAccount: true, bulk: true },
      })
      if (out.ok) { deleted++; filesFailed += out.filesFailed } else failed.push({ email: t.email, error: out.error.slice(0, 200) })
    } catch (e) {
      // Required audit failed — stop: nothing more may be deleted without a journal.
      failed.push({ email: t.email, error: e instanceof Error ? e.message : 'audit failed' })
      break
    }
  }
  return NextResponse.json({ ok: true, deleted, failed, skipped, filesFailed })
}
