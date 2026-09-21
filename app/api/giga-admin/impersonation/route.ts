export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { cookies } from 'next/headers'
import { getSetting } from '@/lib/settings/store'
import { requireGiga, staffRoleOfUser, STAFF_COOKIE_NAME, STAFF_COOKIE_TTL_SECONDS } from '@/lib/admin/giga-actor'
import { canImpersonate, hasPermission } from '@/lib/admin/rbac'
import { recordAdminAction } from '@/lib/admin/audit'
import { createServiceClient } from '@/lib/supabase-service'
import { createServerClient } from '@/lib/supabase-server'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { signToken } from '@/lib/security/signed-token'
import { IMP_COOKIE_NAME, IMP_COOKIE_OPTIONS, signImpersonation } from '@/lib/impersonation/token'
import { trackEvent } from '@/lib/events/track'

/**
 * GET  /api/giga-admin/impersonation?page=&active=1&userId= — session log.
 * POST /api/giga-admin/impersonation { userId, mode, reason } — open a user's
 *      cabinet as that user.
 *
 * How it is safe:
 *  - permission impersonate.view (+ impersonate.edit for edit mode), staff and
 *    blocked accounts are never targets, reason is mandatory, rate-limited;
 *  - the session is a DB row (TTL from settings, 30 min by default) — every request inside it is audited and
 *    view mode is enforced server-side by middleware;
 *  - the user's Supabase session is minted server-side (no magic link leaves
 *    the server); a signed httpOnly cookie marks it as the admin's.
 */

const startSchema = z.object({
  userId: z.string().uuid(),
  mode: z.enum(['view', 'edit']),
  reason: z.string().trim().min(5, 'Укажите причину (не короче 5 символов)').max(500),
  /** Where the cabinet opens. Only known client pages — never an arbitrary URL. */
  redirect: z.enum(['/client/home', '/client/onboarding', '/client/point-a', '/gri']).optional(),
})

export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, 'impersonate.view')
  if (guard.response) return guard.response
  const sp = req.nextUrl.searchParams
  const page = Math.max(1, Number(sp.get('page')) || 1)
  const size = 25
  const sb = createServiceClient()
  let q = sb
    .from('impersonation_sessions')
    .select('id, admin_id, admin_kind, admin_role, admin_email, target_user_id, mode, reason, started_at, expires_at, ended_at, end_reason, ip_address', { count: 'exact' })
    .order('started_at', { ascending: false })
    .range((page - 1) * size, page * size - 1)
  if (sp.get('active') === '1') q = q.is('ended_at', null).gt('expires_at', new Date().toISOString())
  const userId = sp.get('userId')
  if (userId && /^[0-9a-f-]{36}$/i.test(userId)) q = q.eq('target_user_id', userId)
  const { data, count, error } = await q
  if (error) return NextResponse.json({ ok: false, error: 'Не удалось загрузить сессии' }, { status: 500 })

  const ids = Array.from(new Set((data ?? []).map((r) => r.target_user_id)))
  const { data: people } = ids.length
    ? await sb.from('profiles').select('id, email, full_name').in('id', ids)
    : { data: [] as Array<{ id: string; email: string; full_name: string | null }> }
  const byId = new Map((people ?? []).map((p) => [p.id, p]))
  const now = Date.now()
  return NextResponse.json({
    ok: true,
    data: (data ?? []).map((r) => ({
      ...r,
      target: byId.get(r.target_user_id) ?? null,
      active: !r.ended_at && new Date(r.expires_at).getTime() > now,
    })),
    total: count ?? 0,
    page,
    pageSize: size,
  })
}

export async function POST(req: NextRequest) {
  // Everyone who may start a session holds impersonate.view; check it before parsing.
  const pre = await requireGiga(req, 'impersonate.view')
  if (pre.response) return pre.response
  const parsed = startSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Неверный запрос' }, { status: 400 })
  }
  const { userId, mode, reason, redirect } = parsed.data
  const guard = await requireGiga(req, mode === 'edit' ? ['impersonate.view', 'impersonate.edit'] : 'impersonate.view')
  if (guard.response) return guard.response
  const actor = guard.actor

  // Тумблер платформы: открывать кабинет клиента роли SuperExpert можно
  // запретить, не трогая остальные её права и не переписывая матрицу.
  if (actor.role === 'super_expert' && !(await getSetting('super_expert_impersonation'))) {
    return NextResponse.json({ ok: false, error: 'Вход в кабинет клиента для роли SuperExpert выключен в настройках платформы' }, { status: 403 })
  }

  if (await isRateLimitedKey(actor.id, 'impersonation-start', { max: 10, windowMs: 10 * 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Слишком много запусков. Попробуйте позже.' }, { status: 429 })
  }

  const target = await staffRoleOfUser(userId)
  if (!target.email) return NextResponse.json({ ok: false, error: 'Пользователь не найден' }, { status: 404 })
  if (!canImpersonate(actor.role, target)) {
    return NextResponse.json({ ok: false, error: 'Кабинет сотрудника нельзя открыть от его имени' }, { status: 403 })
  }
  if (target.status === 'blocked' || target.status === 'archived') {
    return NextResponse.json({ ok: false, error: 'Пользователь заблокирован или в архиве' }, { status: 409 })
  }
  if (mode === 'edit' && !hasPermission(actor.role, 'impersonate.edit')) {
    return NextResponse.json({ ok: false, error: 'Недостаточно прав для режима правки' }, { status: 403 })
  }

  const [editEnabled, ttlMinutes] = await Promise.all([
    getSetting('impersonation_edit_enabled'),
    getSetting('impersonation_ttl_minutes'),
  ])
  if (mode === 'edit' && !editEnabled) {
    return NextResponse.json({ ok: false, error: 'Режим правки от имени пользователя выключен в настройках платформы. Откройте кабинет в режиме просмотра.' }, { status: 403 })
  }
  const ttlSeconds = ttlMinutes * 60

  const sb = createServiceClient()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000)
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
  const ua = req.headers.get('user-agent')?.slice(0, 300) || null

  // One open session per admin: a new one closes the previous.
  await sb
    .from('impersonation_sessions')
    .update({ ended_at: now.toISOString(), end_reason: 'replaced' })
    .eq('admin_id', actor.id)
    .is('ended_at', null)

  const { data: session, error: insErr } = await sb
    .from('impersonation_sessions')
    .insert({
      admin_id: actor.id,
      admin_kind: actor.kind,
      admin_role: actor.role,
      admin_email: actor.email ?? null,
      target_user_id: userId,
      mode,
      reason,
      expires_at: expiresAt.toISOString(),
      ip_address: ip,
      user_agent: ua,
    })
    .select('id')
    .single()
  if (insErr || !session) return NextResponse.json({ ok: false, error: 'Не удалось открыть сессию' }, { status: 500 })

  // Mandatory audit BEFORE any credential is minted.
  try {
    await recordAdminAction(actor, {
      action: 'impersonation.started',
      entityType: 'impersonation',
      entityId: session.id,
      targetUserId: userId,
      newValue: { mode, expires_at: expiresAt.toISOString() },
      impersonationSessionId: session.id,
      metadata: { reason, target_email: target.email },
    }, req, { required: true })
  } catch {
    await sb.from('impersonation_sessions').update({ ended_at: new Date().toISOString(), end_reason: 'audit_failed' }).eq('id', session.id)
    return NextResponse.json({ ok: false, error: 'Журнал аудита недоступен — вход отклонён' }, { status: 503 })
  }

  // Mint the user's session server-side (the magic link never leaves the server).
  const { data: link, error: linkErr } = await sb.auth.admin.generateLink({ type: 'magiclink', email: target.email })
  const tokenHash = link?.properties?.hashed_token
  if (linkErr || !tokenHash) {
    await sb.from('impersonation_sessions').update({ ended_at: new Date().toISOString(), end_reason: 'link_failed' }).eq('id', session.id)
    return NextResponse.json({ ok: false, error: 'Не удалось создать сессию пользователя' }, { status: 500 })
  }

  // A personal staff session is about to be replaced by the user's: keep the
  // admin in the panel with a short-lived personal staff cookie.
  const jar = cookies()
  if (actor.kind !== 'break_glass') {
    jar.set(STAFF_COOKIE_NAME, await signToken('staff', { sub: actor.id, email: actor.email ?? null }, STAFF_COOKIE_TTL_SECONDS), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: STAFF_COOKIE_TTL_SECONDS,
    })
  }

  const userClient = createServerClient()
  let verify = await userClient.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash })
  if (verify.error) verify = await userClient.auth.verifyOtp({ type: 'email', token_hash: tokenHash })
  if (verify.error || verify.data.user?.id !== userId) {
    await sb.from('impersonation_sessions').update({ ended_at: new Date().toISOString(), end_reason: 'verify_failed' }).eq('id', session.id)
    return NextResponse.json({ ok: false, error: 'Не удалось войти в кабинет пользователя' }, { status: 500 })
  }

  jar.set(IMP_COOKIE_NAME, await signImpersonation({
    sid: session.id,
    uid: userId,
    mode,
    aid: actor.id,
    alabel: actor.email ?? (actor.kind === 'break_glass' ? 'break-glass' : actor.id),
    arole: actor.role,
    tlabel: target.email,
  }, ttlSeconds), IMP_COOKIE_OPTIONS)

  void trackEvent({
    userId,
    name: 'IMPERSONATION_STARTED',
    entityType: 'impersonation',
    entityId: session.id,
    source: 'admin',
    impersonationSessionId: session.id,
    metadata: { mode, admin_role: actor.role },
  })

  return NextResponse.json({ ok: true, sessionId: session.id, expiresAt: expiresAt.toISOString(), redirect: redirect ?? '/client/home' })
}
