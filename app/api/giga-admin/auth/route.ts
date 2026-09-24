export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { STAFF_COOKIE_NAME } from '@/lib/admin/giga-actor'
import { createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { logAudit } from '@/lib/audit'
import { MAX_PASSWORD_LENGTH, ownerEmail, verifyOwnerPassword } from '@/lib/admin/owner-password'

/** Cookie старого аварийного входа (удалён) — только стираем у тех, у кого он остался. */
const LEGACY_GIGA_COOKIE_NAME = 'aistart360_giga'

/**
 * POST /api/giga-admin/auth { email, password } — вход владельца в ГИГА-Панель.
 *
 * Аварийный вход по общему паролю удалён. Войти может только владелец
 * (GIGA_OWNER_EMAIL); пароль сверяется с хешем из окружения
 * (GIGA_OWNER_PASSWORD_HASH) и в БД не хранится. После проверки создаётся
 * обычная личная сессия Supabase этого аккаунта (одноразовый токен
 * генерируется и погашается на сервере, наружу не уходит) — дальше
 * действуют все проверки личной сессии: статус, роль, 2FA.
 */
const bodySchema = z.object({
  email: z.string().trim().max(200),
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
})

const INVALID = () => NextResponse.json({ error: 'Неверный email или пароль' }, { status: 401 })

function clientIp(req: NextRequest): string {
  const v = (req.headers.get('x-forwarded-for')?.split(',')[0] || req.headers.get('x-real-ip') || 'unknown').trim()
  return v.length > 0 && v.length <= 64 ? v : 'unknown'
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req)
  if (await isRateLimitedKey(ip, 'giga-owner-login', { max: 8, windowMs: 10 * 60_000 })) {
    return NextResponse.json({ error: 'Слишком много попыток. Попробуйте позже.' }, { status: 429 })
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Неверный запрос' }, { status: 400 })

  const hash = process.env.GIGA_OWNER_PASSWORD_HASH
  if (!hash) return NextResponse.json({ error: 'Вход не настроен: нет GIGA_OWNER_PASSWORD_HASH' }, { status: 503 })

  const email = parsed.data.email.toLowerCase()
  // Always run the hash check so a wrong email and a wrong password take the same time.
  const passwordOk = verifyOwnerPassword(parsed.data.password, hash)
  if (email !== ownerEmail() || !passwordOk) {
    await logAudit({
      entityType: 'system', entityId: 'giga_panel', action: 'admin.login_failed',
      performedBy: 'giga:anonymous', diff: { after: { method: 'owner_password' } }, ipAddress: ip,
    })
    return INVALID()
  }

  const sb = createServiceClient()
  const { data: profile } = await sb.from('profiles').select('id, role, status').ilike('email', email).maybeSingle()
  const p = profile as { id: string; role: string; status: string } | null
  if (!p || p.role !== 'super_admin' || p.status !== 'approved') {
    return NextResponse.json({ error: 'У аккаунта нет доступа Super Admin' }, { status: 403 })
  }

  const { data: link, error: linkErr } = await sb.auth.admin.generateLink({ type: 'magiclink', email })
  const tokenHash = link?.properties?.hashed_token
  if (linkErr || !tokenHash) return NextResponse.json({ error: 'Не удалось создать сессию' }, { status: 500 })

  const client = createServerClient()
  let verify = await client.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash })
  if (verify.error) verify = await client.auth.verifyOtp({ type: 'email', token_hash: tokenHash })
  if (verify.error || verify.data.user?.id !== p.id) {
    return NextResponse.json({ error: 'Не удалось создать сессию' }, { status: 500 })
  }

  await logAudit({
    entityType: 'system', entityId: 'giga_panel', action: 'admin.login',
    performedBy: p.id, diff: { after: { method: 'owner_password' } }, ipAddress: ip,
  })
  const res = NextResponse.json({ ok: true })
  res.cookies.set(LEGACY_GIGA_COOKIE_NAME, '', { path: '/', maxAge: 0 }) // старый break-glass cookie
  return res
}

/** DELETE /api/giga-admin/auth — выход из панели: сессия Supabase и служебные cookie. */
export async function DELETE(req: NextRequest) {
  const client = createServerClient()
  const { data: { user } } = await client.auth.getUser().catch(() => ({ data: { user: null } }))
  await client.auth.signOut().catch(() => undefined)
  const res = NextResponse.json({ ok: true })
  res.cookies.set(LEGACY_GIGA_COOKIE_NAME, '', { path: '/', maxAge: 0 })
  res.cookies.set(STAFF_COOKIE_NAME, '', { path: '/', maxAge: 0 })
  await logAudit({
    entityType: 'system', entityId: 'giga_panel', action: 'admin.logout',
    performedBy: user?.id ?? 'giga:anonymous', diff: { after: { method: 'owner_password' } }, ipAddress: clientIp(req),
  })
  return res
}
