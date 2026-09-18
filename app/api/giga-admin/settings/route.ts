export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { SETTINGS, isSettingKey, validateSetting, type SettingKey } from '@/lib/settings/registry'
import { getAllSettings, saveSettings } from '@/lib/settings/store'

/**
 * GET /api/giga-admin/settings — every platform setting with its current value.
 * PUT /api/giga-admin/settings — { values: { key: value, … } }; validated,
 * audited (before/after) BEFORE the write, saved in one upsert.
 */
export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, 'users.manage')
  if (guard.response) return guard.response
  const { values, meta } = await getAllSettings({ fresh: true })
  return NextResponse.json({
    ok: true,
    values,
    meta,
    actor: { kind: guard.actor.kind, canEdit: guard.actor.permissions.includes('settings.manage') },
  })
}

export async function PUT(req: NextRequest) {
  const guard = await requireGiga(req, 'settings.manage')
  if (guard.response) return guard.response
  const actor = guard.actor

  const body = (await req.json().catch(() => null)) as { values?: Record<string, unknown> } | null
  const input = body?.values
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.keys(input).length) {
    return NextResponse.json({ ok: false, error: 'Нет изменений для сохранения' }, { status: 422 })
  }

  const next: Partial<Record<SettingKey, unknown>> = {}
  for (const [key, raw] of Object.entries(input)) {
    if (!isSettingKey(key)) return NextResponse.json({ ok: false, error: `Неизвестная настройка: ${key}` }, { status: 422 })
    const v = validateSetting(key, raw)
    if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: 422 })
    next[key] = v.value
  }

  // The shared-password login may only be switched off from a personal
  // account — otherwise the actor would lock themselves out mid-session.
  if (next.break_glass_enabled === false && actor.kind !== 'session') {
    return NextResponse.json({
      ok: false,
      error: 'Аварийный вход можно выключить только из личного аккаунта Super Admin (не через общий пароль).',
    }, { status: 422 })
  }
  if (next.staff_require_mfa === true && actor.kind === 'break_glass') {
    return NextResponse.json({
      ok: false,
      error: 'Обязательную 2FA включайте из личного аккаунта: так вы сразу проверите, что ваш вход с 2FA работает.',
    }, { status: 422 })
  }

  try {
    const { values: before } = await getAllSettings({ fresh: true })
    const changed = (Object.keys(next) as SettingKey[]).filter(
      (k) => JSON.stringify(before[k]) !== JSON.stringify(next[k]),
    )
    if (!changed.length) return NextResponse.json({ ok: true, values: before, changed: [] })

    await recordAdminAction(actor, {
      action: 'settings.changed',
      entityType: 'system_settings',
      entityId: changed.join(','),
      oldValue: Object.fromEntries(changed.map((k) => [k, before[k]])),
      newValue: Object.fromEntries(changed.map((k) => [k, next[k]])),
      metadata: { critical: changed.filter((k) => SETTINGS[k].critical) },
    }, req, { required: true })

    await saveSettings(Object.fromEntries(changed.map((k) => [k, next[k]])), actor.id)
    const { values, meta } = await getAllSettings({ fresh: true })
    return NextResponse.json({ ok: true, values, meta, changed })
  } catch (e) {
    console.error('[giga-admin/settings PUT]', e)
    return NextResponse.json({ ok: false, error: 'Не удалось сохранить настройки. Повторите попытку.' }, { status: 500 })
  }
}
