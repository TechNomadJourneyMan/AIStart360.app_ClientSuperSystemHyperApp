export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga, staffRoleOfUser } from '@/lib/admin/giga-actor'
import { canManageTarget } from '@/lib/admin/rbac'
import { recordAdminAction } from '@/lib/admin/audit'
import { createServiceClient } from '@/lib/supabase-service'

/**
 * PATCH /api/giga-admin/users/:id/company — данные компании и контакта.
 *
 * Зачем отдельный маршрут: сотрудник часто знает о клиенте больше, чем тот
 * успел внести сам (отрасль, размер, контакты). Раньше дополнить это можно
 * было только войдя в кабинет клиента — то есть от его имени. Теперь есть
 * прямой путь, и он честно подписан: в журнале остаётся, кто и что изменил.
 *
 * Компания создаётся, если её ещё нет: у части аккаунтов строки companies
 * просто не существует, пока клиент не дошёл до первого шага анкеты.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const nullableText = (max: number) => z.string().trim().max(max).nullable().optional()

const bodySchema = z.object({
  company: z.object({
    name: z.string().trim().min(1).max(200).optional(),
    industry: nullableText(120),
    stage: z.enum(['Startup', 'Growth', 'Scale', 'Mature']).nullable().optional(),
    business_model: z.enum(['B2B', 'B2C', 'B2B2C', 'Mixed']).nullable().optional(),
    employee_count: z.number().int().min(0).max(1_000_000).nullable().optional(),
    regions: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
    contact_name: nullableText(160),
    contact_position: nullableText(160),
    contact_phone: nullableText(60),
    contact_email: z.string().trim().email().max(200).nullable().optional(),
  }).optional(),
  profile: z.object({
    full_name: nullableText(160),
    organization: nullableText(200),
    position: nullableText(160),
    phone: nullableText(60),
  }).optional(),
  reason: z.string().trim().max(300).optional(),
})

/** Пустая строка из формы означает «очистить поле», а не «записать пустоту». */
function clean<T extends Record<string, unknown>>(patch: T): Partial<T> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    out[k] = typeof v === 'string' && v.trim() === '' ? null : v
  }
  return out as Partial<T>
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, ['company.edit', 'users.sensitive'])
  if (guard.response) return guard.response
  if (!UUID_RE.test(params.id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Неверный формат данных' }, { status: 400 })
  }
  const companyPatch = clean(parsed.data.company ?? {})
  const profilePatch = clean(parsed.data.profile ?? {})
  if (!Object.keys(companyPatch).length && !Object.keys(profilePatch).length) {
    return NextResponse.json({ ok: false, error: 'Нечего сохранять' }, { status: 400 })
  }

  const target = await staffRoleOfUser(params.id)
  if (!target.profileRole) return NextResponse.json({ ok: false, error: 'Пользователь не найден' }, { status: 404 })
  if (!canManageTarget(guard.actor.role, target.staffRole)) {
    return NextResponse.json({ ok: false, error: 'Недостаточно прав для этого пользователя' }, { status: 403 })
  }

  const sb = createServiceClient()
  const COMPANY_COLS = 'id, name, industry, stage, business_model, employee_count, regions, contact_name, contact_position, contact_phone, contact_email'
  const PROFILE_COLS = 'full_name, organization, position, phone'

  const [{ data: beforeCompany }, { data: beforeProfile }] = await Promise.all([
    sb.from('companies').select(COMPANY_COLS).eq('user_id', params.id).maybeSingle(),
    sb.from('profiles').select(PROFILE_COLS).eq('id', params.id).maybeSingle(),
  ])

  // Журнал пишем ДО изменения и требуем успеха: неподписанная правка чужих
  // данных — ровно то, чего быть не должно.
  await recordAdminAction(guard.actor, {
    action: 'user.company_edited',
    entityType: 'company',
    entityId: (beforeCompany as { id?: string } | null)?.id ?? params.id,
    targetUserId: params.id,
    oldValue: { company: beforeCompany ?? null, profile: beforeProfile ?? null },
    newValue: { company: companyPatch, profile: profilePatch },
    metadata: { reason: parsed.data.reason ?? null },
  }, req, { required: true })

  let company = beforeCompany as Record<string, unknown> | null
  if (Object.keys(companyPatch).length) {
    if (company) {
      const { data, error } = await sb
        .from('companies')
        .update({ ...companyPatch, updated_at: new Date().toISOString() })
        .eq('user_id', params.id)
        .select(COMPANY_COLS)
        .maybeSingle()
      if (error) return NextResponse.json({ ok: false, error: 'Не удалось сохранить компанию' }, { status: 500 })
      company = data as Record<string, unknown> | null
    } else {
      // Название обязательно на уровне БД — без него создавать нечего.
      const name = typeof companyPatch.name === 'string' && companyPatch.name.trim() ? companyPatch.name : null
      if (!name) return NextResponse.json({ ok: false, error: 'У клиента ещё нет компании — укажите название' }, { status: 400 })
      const { data, error } = await sb
        .from('companies')
        .insert({ ...companyPatch, name, user_id: params.id })
        .select(COMPANY_COLS)
        .maybeSingle()
      if (error) return NextResponse.json({ ok: false, error: 'Не удалось создать компанию' }, { status: 500 })
      company = data as Record<string, unknown> | null
    }
  }

  let profile = beforeProfile as Record<string, unknown> | null
  if (Object.keys(profilePatch).length) {
    const { data, error } = await sb
      .from('profiles')
      .update({ ...profilePatch, updated_at: new Date().toISOString() })
      .eq('id', params.id)
      .select(PROFILE_COLS)
      .maybeSingle()
    if (error) return NextResponse.json({ ok: false, error: 'Не удалось сохранить профиль' }, { status: 500 })
    profile = data as Record<string, unknown> | null
  }

  return NextResponse.json({ ok: true, data: { company, profile } })
}
