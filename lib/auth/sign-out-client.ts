/**
 * «Выйти» в кабинете — браузерная сторона (SR-06).
 *
 * Во время impersonation браузер держит сессию КЛИЕНТА, а cookie
 * impersonation недоступен JS. Прямой `supabase.auth.signOut()` (scope
 * 'global' по умолчанию) выкидывал клиента со всех его устройств. Поэтому
 * решает сервер (POST /api/v1/auth/sign-out): во время impersonation —
 * только эта сессия, у обычного клиента — как раньше, все устройства.
 *
 * Если сервер недоступен — завершаем только сессию этого браузера (scope
 * 'local'): так никогда не задеваем чужие устройства.
 *
 * Возвращает адрес, куда вести дальше.
 */
import { createClient } from '@/lib/supabase/client'

export const SIGN_OUT_ENDPOINT = '/api/v1/auth/sign-out'

async function localSignOut(): Promise<void> {
  try {
    await createClient().auth.signOut({ scope: 'local' })
  } catch {
    /* the redirect still leaves the cabinet; middleware re-checks the session */
  }
}

export async function signOutThisBrowser(fallbackRedirect = '/login'): Promise<string> {
  let redirect = fallbackRedirect
  try {
    const res = await fetch(SIGN_OUT_ENDPOINT, { method: 'POST', credentials: 'same-origin' })
    const json = (await res.json().catch(() => null)) as { ok?: boolean; redirect?: string } | null
    if (res.ok && json?.ok && typeof json.redirect === 'string' && json.redirect.startsWith('/') && !json.redirect.startsWith('//')) {
      redirect = json.redirect
    }
  } catch {
    /* fall through: local sign-out below */
  }
  // The server has already ended the session (and cleared its cookies) or
  // could not be reached; either way clear this browser's copy — never global.
  await localSignOut()
  return redirect
}
