/**
 * POST /api/oauth/authorize/decision — the person's answer on the consent
 * screen (form fields `request_id`, `decision` = approve | deny, `scope` = the
 * scopes left ticked; approving with none ticked is a denial).
 *
 * Everything the consent page checked is checked again here (session, role,
 * second factor, pending request); the request is single use. The browser is
 * then sent to the client's redirect URI with `code` (or `error`), `state`
 * and the RFC 9207 `iss`. A cross-site form post is refused (CSRF).
 */
import type { NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { MFA_COOKIE_NAME } from '@/lib/mfa/step-up'
import { authorizationRedirect, consentState } from '@/lib/mcp/consent'
import { decideAuthRequest } from '@/lib/mcp/oauth'
import { intersectScopes } from '@/lib/mcp/scopes'
import { oauthHtmlPage } from '@/lib/mcp/pages'
import { OAUTH_PATHS, publicOrigin } from '@/lib/mcp/urls'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function sameOrigin(req: NextRequest, origin: string): boolean {
  if (req.headers.get('sec-fetch-site') === 'cross-site') return false
  const o = req.headers.get('origin')
  if (!o) return false
  try {
    return new URL(o).origin.toLowerCase() === origin
  } catch {
    return false
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const origin = publicOrigin(req.headers, req.url)
  if (!sameOrigin(req, origin)) return oauthHtmlPage('Запрос отклонён', 'Решение можно принять только на странице подтверждения доступа.', 403)

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return oauthHtmlPage('Некорректный запрос', 'Форма подтверждения повреждена.', 400)
  }
  const requestId = String(form.get('request_id') ?? '')
  const decision = String(form.get('decision') ?? '')
  if (decision !== 'approve' && decision !== 'deny') return oauthHtmlPage('Некорректный запрос', 'Неизвестное решение.', 400)

  let user = null
  try {
    user = (await createServerClient().auth.getUser()).data.user
  } catch {
    user = null
  }
  const state = await consentState(requestId, user, req.cookies.get(MFA_COOKIE_NAME)?.value)
  switch (state.kind) {
    case 'ready':
      break
    case 'login':
    case 'step_up':
      // Session or second factor lapsed while the page was open: back to the consent screen.
      return Response.redirect(`${origin}${OAUTH_PATHS.consent}/${requestId}`, 303)
    case 'invalid':
      return oauthHtmlPage('Запрос устарел', 'Запрос на подключение истёк или уже обработан. Запустите подключение в приложении заново.', 400)
    case 'enroll':
      return oauthHtmlPage('Нужна двухфакторная аутентификация', 'Включите 2FA: Настройки → Безопасность, затем повторите подключение.', 403)
    case 'forbidden':
      return oauthHtmlPage('Нет доступа', 'Подключение MCP доступно только сотрудникам и экспертам AIStart360.', 403)
    case 'unavailable':
      return oauthHtmlPage('Сервис недоступен', 'Не удалось проверить права. Повторите позже.', 503)
  }

  // The person may untick scopes on the consent screen; nothing outside the grant can be added.
  const chosen = intersectScopes(state.grant, form.getAll('scope').map(String))
  const approve = decision === 'approve' && chosen.length > 0
  let result
  try {
    result = await decideAuthRequest(state.request.id, state.principal.userId, approve, chosen)
  } catch {
    return oauthHtmlPage('Сервис недоступен', 'Не удалось сохранить решение. Повторите подключение.', 503)
  }
  if (!result.ok) return oauthHtmlPage('Запрос устарел', 'Запрос на подключение уже обработан. Запустите подключение в приложении заново.', 400)
  const target = result.code
    ? authorizationRedirect(result.redirectUri, { code: result.code, state: result.state, iss: origin })
    : authorizationRedirect(result.redirectUri, { error: 'access_denied', error_description: 'The user denied access', state: result.state, iss: origin })
  return new Response(null, { status: 303, headers: { Location: target, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })
}
