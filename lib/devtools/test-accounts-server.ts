/**
 * lib/devtools/test-accounts-server.ts — создание, смена статуса и удаление
 * тестовых аккаунтов (Dev-tools Super Admin). Только сервер (service role).
 *
 * Порядок создания:
 *   1. колонка profiles.is_test есть (миграция 120) — иначе ничего не создаём:
 *      аккаунт без пометки не удалить одной кнопкой;
 *   2. ОБЯЗАТЕЛЬНАЯ запись в журнал (id пользователя генерируется заранее, так
 *      что запись сразу привязана к будущему аккаунту);
 *   3. auth.admin.createUser — письмо не отправляется, email подтверждён;
 *      роль/статус передаются в app_metadata (handle_new_user, миграция 099,
 *      доверяет только ему) — профиль сразу создаётся правильным;
 *   4. профиль: role, status, is_test, approved_at; staff_roles для персонала;
 *      пустая компания для клиента (по желанию);
 *   5. любой сбой после п.3 — откат: аккаунт удаляется полностью.
 */
import type { createServiceClient } from '@/lib/supabase-service'
import { recordAdminAction } from '@/lib/admin/audit'
import type { GigaActor } from '@/lib/admin/giga-actor'
import { purgeUser, purgeTargetBlock } from '@/lib/admin/purge-user'
import {
  generateTestPassword, isMissingColumnError, testAccountEmail, testAccountName, MIGRATION_120_MESSAGE,
  type TestAccountKind, type TestProfileStatus,
} from './test-accounts'

type Svc = ReturnType<typeof createServiceClient>

export type ColumnState = { ready: true } | { ready: false; error: string; migration: boolean }

/** Есть ли колонка profiles.is_test (миграция 120). */
export async function testColumnState(sb: Svc): Promise<ColumnState> {
  const { error } = await sb.from('profiles').select('id', { count: 'exact', head: true }).eq('is_test', true)
  if (!error) return { ready: true }
  if (isMissingColumnError(error)) return { ready: false, error: MIGRATION_120_MESSAGE, migration: true }
  return { ready: false, error: `Не удалось проверить тестовые аккаунты: ${error.message}`, migration: false }
}

export interface TestAccountRow {
  id: string
  email: string | null
  full_name: string | null
  role: string | null
  status: string | null
  created_at: string | null
  staff_role: string | null
}

export async function listTestAccounts(sb: Svc, limit = 200): Promise<{ ok: true; rows: TestAccountRow[] } | { ok: false; error: string; migration: boolean }> {
  const { data, error } = await sb
    .from('profiles')
    .select('id, email, full_name, role, status, created_at')
    .eq('is_test', true)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) {
    return isMissingColumnError(error)
      ? { ok: false, error: MIGRATION_120_MESSAGE, migration: true }
      : { ok: false, error: error.message, migration: false }
  }
  const rows = (data ?? []) as Array<Omit<TestAccountRow, 'staff_role'>>
  const ids = rows.map((r) => r.id)
  const staff = new Map<string, string>()
  if (ids.length) {
    const { data: sr } = await sb.from('staff_roles').select('user_id, role').in('user_id', ids)
    for (const r of (sr ?? []) as Array<{ user_id: string; role: string }>) staff.set(r.user_id, r.role)
  }
  return { ok: true, rows: rows.map((r) => ({ ...r, staff_role: staff.get(r.id) ?? null })) }
}

/** Профиль помечен как тестовый (и это не Super Admin). */
export async function loadTestAccount(sb: Svc, userId: string): Promise<
  | { ok: true; row: { id: string; email: string | null; role: string | null; status: string | null; staffRole: string | null } }
  | { ok: false; status: number; error: string }
> {
  const { data, error } = await sb.from('profiles').select('id, email, role, status, is_test').eq('id', userId).maybeSingle()
  if (error) {
    return isMissingColumnError(error)
      ? { ok: false, status: 409, error: MIGRATION_120_MESSAGE }
      : { ok: false, status: 500, error: 'Не удалось прочитать профиль' }
  }
  const p = data as { id: string; email: string | null; role: string | null; status: string | null; is_test?: boolean } | null
  if (!p) return { ok: false, status: 404, error: 'Пользователь не найден' }
  if (p.is_test !== true) return { ok: false, status: 403, error: 'Это не тестовый аккаунт — здесь им управлять нельзя' }
  if (p.role === 'super_admin') return { ok: false, status: 403, error: 'Super Admin здесь не удаляется' }
  const { data: sr } = await sb.from('staff_roles').select('role').eq('user_id', userId).maybeSingle()
  return { ok: true, row: { id: p.id, email: p.email, role: p.role, status: p.status, staffRole: (sr as { role?: string } | null)?.role ?? null } }
}

export type CreateOutcome =
  | { ok: true; id: string; email: string; password: string; companyId: string | null }
  | { ok: false; status: number; error: string }

/** Полностью убрать аккаунт, созданный наполовину (best-effort). */
async function rollback(sb: Svc, actor: GigaActor, userId: string, email: string, req: Request | null): Promise<void> {
  try {
    const out = await purgeUser(sb, actor, {
      userId,
      target: { staffRole: null, profileRole: 'client', status: null, email },
      reason: 'Откат: тестовый аккаунт создан не полностью',
      req,
      metadata: { source: 'devtools', testAccount: true, rollback: true },
    })
    if (out.ok) return
  } catch {
    /* fall through to the auth-only delete */
  }
  await sb.auth.admin.deleteUser(userId).catch(() => null)
}

export async function createTestAccount(sb: Svc, actor: GigaActor, kind: TestAccountKind, opts: { withCompany?: boolean; req?: Request | null } = {}): Promise<CreateOutcome> {
  const req = opts.req ?? null
  const column = await testColumnState(sb)
  if (!column.ready) return { ok: false, status: column.migration ? 409 : 500, error: column.error }

  const id = globalThis.crypto.randomUUID()
  const email = testAccountEmail(kind.key)
  const password = generateTestPassword()
  const fullName = testAccountName(kind)
  const withCompany = !!opts.withCompany && kind.client

  // Журнал ДО создания: без записи аккаунта не будет (исключение наверх).
  await recordAdminAction(actor, {
    action: 'devtools.test_account_created',
    entityType: 'user', entityId: id, targetUserId: id,
    newValue: { email, kind: kind.key, profileRole: kind.profileRole, status: kind.status, staffRole: kind.staffRole, withCompany },
    metadata: { source: 'devtools', testAccount: true },
  }, req, { required: true })

  // blocked is not a status handle_new_user accepts: the profile starts approved and is blocked below.
  const initialStatus: TestProfileStatus = kind.status === 'blocked' ? 'approved' : kind.status
  const { data: created, error: createErr } = await sb.auth.admin.createUser({
    id,
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, is_test: true },
    app_metadata: { role: kind.profileRole, status: initialStatus, is_test: true },
  })
  if (createErr || !created?.user) {
    await recordAdminAction(actor, {
      action: 'devtools.test_account_create_failed',
      entityType: 'user', entityId: id,
      metadata: { stage: 'auth', error: (createErr?.message ?? 'no user').slice(0, 300), email },
    }, req).catch(() => false)
    return { ok: false, status: 500, error: `Не удалось создать учётную запись: ${createErr?.message ?? 'нет ответа'}` }
  }
  const userId = created.user.id

  const fail = async (stage: string, message: string): Promise<CreateOutcome> => {
    await recordAdminAction(actor, {
      action: 'devtools.test_account_create_failed',
      entityType: 'user', entityId: userId, targetUserId: userId,
      metadata: { stage, error: message.slice(0, 300), email },
    }, req).catch(() => false)
    await rollback(sb, actor, userId, email, req)
    return { ok: false, status: 500, error: `Аккаунт не создан (${stage}): ${message}` }
  }

  const now = new Date().toISOString()
  const profile = {
    id: userId,
    email,
    full_name: fullName,
    role: kind.profileRole,
    status: kind.status,
    is_test: true,
    approved_at: kind.status === 'pending_approval' ? null : now,
  }
  // The trigger normally created the row already; upsert covers a slow / missing trigger.
  const { data: saved, error: profErr } = await sb.from('profiles').upsert(profile, { onConflict: 'id' }).select('id')
  if (profErr || !saved?.length) {
    if (isMissingColumnError(profErr)) {
      await rollback(sb, actor, userId, email, req)
      return { ok: false, status: 409, error: MIGRATION_120_MESSAGE }
    }
    return fail('profile', profErr?.message ?? 'профиль не сохранён')
  }

  if (kind.staffRole) {
    const { error } = await sb.from('staff_roles').upsert({ user_id: userId, role: kind.staffRole, granted_by: actor.id, updated_at: now }, { onConflict: 'user_id' })
    if (error) return fail('staff_role', error.message)
  }

  if (kind.status === 'blocked') {
    // Same as the panel's block: status + GoTrue ban.
    await sb.auth.admin.updateUserById(userId, { ban_duration: '87600h' }).catch(() => null)
  }

  let companyId: string | null = null
  if (withCompany) {
    const { data: co, error } = await sb.from('companies').insert({ user_id: userId, name: `Тестовая компания · ${email.split('@')[0]}` }).select('id').maybeSingle()
    if (error) return fail('company', error.message)
    companyId = (co as { id?: string } | null)?.id ?? null
  }

  return { ok: true, id: userId, email, password, companyId }
}

/** Сменить статус тестового аккаунта (одобрен / ждёт / заблокирован) + бан GoTrue. */
export async function setTestAccountStatus(sb: Svc, userId: string, status: TestProfileStatus): Promise<{ ok: true } | { ok: false; error: string }> {
  const patch: Record<string, unknown> = { status }
  if (status === 'approved') patch.approved_at = new Date().toISOString()
  const { data, error } = await sb.from('profiles').update(patch).eq('id', userId).eq('is_test', true).select('id')
  if (error || !data?.length) return { ok: false, error: error?.message ?? 'профиль не обновлён' }
  await sb.auth.admin.updateUserById(userId, { ban_duration: status === 'blocked' ? '87600h' : 'none' }).catch(() => null)
  return { ok: true }
}

export { purgeTargetBlock }
