export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { GIGA_COOKIE_NAME, verifyGigaRole } from '@/lib/giga-cookie'
import { logAudit } from '@/lib/audit'
import { normalizeOverrides, normalizeTier } from '@/lib/access/entitlements'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isSuperAdmin(req: NextRequest): boolean {
  return verifyGigaRole(req.cookies.get(GIGA_COOKIE_NAME)?.value) === 'super_admin'
}

/** GET — текущий tier + feature_flags пользователя (для админ-панели). */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isSuperAdmin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }
  try {
    const svc = createServiceClient()
    const { data, error } = await svc
      .from('profiles')
      .select('id, tier, feature_flags')
      .eq('id', params.id)
      .maybeSingle()
    if (error) {
      // Колонок нет → миграция 048 не применена; честный маркер для UI.
      return NextResponse.json({ ok: false, error: 'migration_048_required' }, { status: 503 })
    }
    if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    return NextResponse.json({
      ok: true,
      tier: normalizeTier((data as { tier?: unknown }).tier),
      feature_flags: normalizeOverrides((data as { feature_flags?: unknown }).feature_flags),
    })
  } catch (e) {
    console.error('[giga-admin/users/access GET]', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/giga-admin/users/:id/access — тариф и per-user фича-флаги (Фаза 6C).
 * Body: { tier?: 'free'|'pro', feature_flags?: { gri_full?, pdf_export?, ai_chat?, benchmarks? } }
 *
 * ⚠ Урок аудита 2026-07-04: пишем service-клиентом (giga-сессия не даёт
 * auth.uid() → RLS молча дропает UPDATE profiles) и ОБЯЗАТЕЛЬНО проверяем число
 * затронутых строк — «кнопка, которая выглядит рабочей, но молча не работает»
 * уже была причиной инцидента.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isSuperAdmin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }

  const body = (await req.json().catch(() => null)) as {
    tier?: unknown
    feature_flags?: unknown
  } | null
  if (!body || (body.tier === undefined && body.feature_flags === undefined)) {
    return NextResponse.json({ error: 'tier or feature_flags required' }, { status: 422 })
  }

  const patch: Record<string, unknown> = {}
  if (body.tier !== undefined) {
    if (body.tier !== 'free' && body.tier !== 'pro') {
      return NextResponse.json({ error: 'tier must be free|pro' }, { status: 422 })
    }
    patch.tier = normalizeTier(body.tier)
  }
  if (body.feature_flags !== undefined) {
    // Только известные boolean-фичи; мусор отбрасывается.
    patch.feature_flags = normalizeOverrides(body.feature_flags)
  }

  try {
    const svc = createServiceClient()
    const { data, error } = await svc
      .from('profiles')
      .update(patch)
      .eq('id', params.id)
      .select('id, tier, feature_flags')
    if (error) {
      console.error('[giga-admin/users/access] update failed', error)
      return NextResponse.json({ error: 'db_error' }, { status: 500 })
    }
    if (!data || data.length === 0) {
      // 0 затронутых строк = профиль не найден ЛИБО миграция 048 не применена —
      // честная ошибка вместо тихого «вроде сохранилось».
      return NextResponse.json(
        { error: 'no_rows_updated — профиль не найден или миграция 048 не применена' },
        { status: 409 },
      )
    }

    await logAudit({
      entityType: 'user',
      entityId: params.id,
      action: 'user.access_changed',
      performedBy: 'giga:super_admin',
      diff: patch,
      ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
    })

    return NextResponse.json({ ok: true, profile: data[0] })
  } catch (e) {
    console.error('[giga-admin/users/access]', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
