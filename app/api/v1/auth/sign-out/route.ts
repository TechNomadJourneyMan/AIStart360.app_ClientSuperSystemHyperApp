export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { impersonationOfThisSession } from '@/lib/impersonation/guard'
import { endImpersonationInThisBrowser } from '@/lib/impersonation/exit'

/**
 * POST /api/v1/auth/sign-out — «Выйти» в кабинете (SR-06).
 *
 * Решает сервер, потому что cookie impersonation недоступен JS:
 *  - сессия impersonation (cookie или серверная привязка сессии GoTrue) —
 *    завершается ТОЛЬКО она (scope 'local') и закрывается запись
 *    impersonation; сессии клиента на его устройствах не трогаются;
 *  - режим сессии выяснить не удалось — тоже только 'local' (безопасная
 *    сторона: не выкидываем клиента отовсюду из-за сбоя);
 *  - обычная сессия клиента — как раньше: выход со всех устройств (signOut
 *    по умолчанию, scope 'global').
 * → { ok, impersonation, redirect }
 */
export async function POST(req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser().catch(() => ({ data: { user: null } }))
  const state = await impersonationOfThisSession(user?.id ?? null)

  if (state.kind !== 'none') {
    const { found, targetUserId } = await endImpersonationInThisBrowser(req, 'sign_out')
    const redirect = found && targetUserId ? `/admin-giga-panel/users/${targetUserId}` : found ? '/admin-giga-panel' : '/login'
    return NextResponse.json({ ok: true, impersonation: found, redirect })
  }

  if (user) {
    const { error } = await sb.auth.signOut()
    if (error) {
      console.warn('[auth/sign-out]', error.message)
      return NextResponse.json({ ok: false, error: 'Не удалось выйти. Повторите.' }, { status: 500 })
    }
  }
  return NextResponse.json({ ok: true, impersonation: false, redirect: '/login' })
}
