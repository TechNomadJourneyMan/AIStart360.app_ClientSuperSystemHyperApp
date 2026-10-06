/**
 * /oauth/consent/<request id> — consent screen of the MCP authorization server.
 *
 * Reached from GET /api/oauth/authorize. The request id lives in the PATH so
 * it survives the login and 2FA redirects (both keep only the pathname in
 * `from`). Login → /login, second factor → /2fa, then back here. The
 * decision is posted to /api/oauth/authorize/decision, which re-checks
 * everything (lib/mcp/consent.ts).
 */
import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { AlertTriangle, KeyRound, ShieldCheck, ShieldX } from 'lucide-react'
import { createServerClient } from '@/lib/supabase-server'
import { MFA_COOKIE_NAME } from '@/lib/mfa/step-up'
import { STAFF_ROLE_LABELS } from '@/lib/admin/rbac'
import { consentState } from '@/lib/mcp/consent'
import { SCOPE_DEFS } from '@/lib/mcp/scopes'
import { OAUTH_PATHS } from '@/lib/mcp/urls'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Подключение MCP — AIStart360',
  robots: { index: false, follow: false },
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#070c1f] px-4 py-10 text-slate-200">
      <div className="w-full max-w-lg rounded-2xl border border-white/[0.08] bg-white/[0.03] p-6 shadow-2xl">{children}</div>
    </main>
  )
}

function Notice({ title, text }: { title: string; text: string }) {
  return (
    <Card>
      <div className="flex items-start gap-3">
        <ShieldX className="mt-0.5 h-5 w-5 shrink-0 text-red-300" aria-hidden />
        <div>
          <h1 className="text-base font-semibold text-slate-100">{title}</h1>
          <p className="mt-1 text-sm text-slate-400">{text}</p>
        </div>
      </div>
    </Card>
  )
}

export default async function ConsentPage({ params }: { params: { id: string } }) {
  const self = `${OAUTH_PATHS.consent}/${encodeURIComponent(params.id)}`
  let user = null
  try {
    user = (await createServerClient().auth.getUser()).data.user
  } catch {
    user = null
  }
  const state = await consentState(params.id, user, cookies().get(MFA_COOKIE_NAME)?.value)

  switch (state.kind) {
    case 'login':
      return redirect(`/login?from=${encodeURIComponent(self)}`)
    case 'step_up':
      return redirect(`/2fa?from=${encodeURIComponent(self)}`)
    case 'invalid':
      return <Notice title="Запрос устарел" text="Запрос на подключение истёк или уже обработан. Запустите подключение в приложении заново." />
    case 'enroll':
      return <Notice title="Нужна двухфакторная аутентификация" text="Для подключения MCP включите 2FA: Настройки → Безопасность, затем повторите подключение в приложении." />
    case 'forbidden':
      return <Notice title="Нет доступа" text="Подключение MCP доступно только сотрудникам и экспертам AIStart360 с правами на чтение данных." />
    case 'unavailable':
      return <Notice title="Сервис недоступен" text="Не удалось проверить права. Повторите подключение позже." />
  }

  const { request, principal, grant, withheld, redirectHost, loopback } = state
  const roleText = principal.role.kind === 'staff' ? STAFF_ROLE_LABELS[principal.role.staffRole] : 'Эксперт'
  const appName = request.clientName ?? 'Приложение без названия'

  return (
    <Card>
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-blue-500/30 bg-blue-500/15">
          <KeyRound className="h-5 w-5 text-blue-300" aria-hidden />
        </div>
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-slate-100">Подключение к данным AIStart360</h1>
          <p className="text-xs text-slate-500">MCP · только чтение</p>
        </div>
      </div>

      <p className="mt-5 text-sm text-slate-300">
        Приложение <b className="text-slate-100">«{appName}»</b> запрашивает доступ к данным платформы от вашего имени
        ({principal.email ?? 'ваш аккаунт'}, роль: {roleText}).
      </p>
      <p className="mt-2 text-xs text-slate-400">
        После подтверждения браузер вернётся на адрес <b className="font-mono text-slate-200">{redirectHost}</b>.
      </p>
      {loopback && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>Адрес возврата — ваш компьютер (localhost). Подтверждайте, только если вы сами только что запустили подключение в Claude Code, Claude Desktop или другом MCP-клиенте.</span>
        </div>
      )}

      {grant.length > 0 ? (
        <>
          <h2 className="mt-5 text-xs font-semibold uppercase tracking-wider text-slate-500">Будет разрешено (можно снять лишнее)</h2>
          <ul className="mt-2 space-y-2">
            {grant.map((s) => (
              <li key={s}>
                <label className="flex cursor-pointer items-start gap-2 text-sm">
                  <input type="checkbox" name="scope" value={s} defaultChecked form="mcp-consent" className="mt-1" />
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-hidden />
                  <span>
                    <span className="text-slate-100">{SCOPE_DEFS[s].label}</span>
                    <span className="block text-xs text-slate-500">{SCOPE_DEFS[s].description}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          Ваша роль не даёт ни одного из запрошенных прав — доступ можно только отклонить.
        </p>
      )}
      {withheld.length > 0 && (
        <>
          <h2 className="mt-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Не будет выдано (нет права у вашей роли)</h2>
          <ul className="mt-2 space-y-1 text-xs text-slate-500">
            {withheld.map((s) => <li key={s}>— {SCOPE_DEFS[s].label}</li>)}
          </ul>
        </>
      )}

      <p className="mt-5 text-xs text-slate-500">
        Доступ проверяется при каждом запросе по вашей текущей роли. Отозвать подключение можно в разделе «MCP-доступ»
        или в самом приложении. Токен действует 1 час и продлевается автоматически до 30 дней.
      </p>

      <form id="mcp-consent" method="post" action={OAUTH_PATHS.decision} className="mt-5 flex flex-wrap justify-end gap-2">
        <input type="hidden" name="request_id" value={request.id} />
        <button type="submit" name="decision" value="deny" className="rounded-xl border border-white/[0.1] bg-white/[0.05] px-4 py-2 text-sm text-slate-200 hover:bg-white/[0.09]">
          Отклонить
        </button>
        {grant.length > 0 && (
          <button type="submit" name="decision" value="approve" className="rounded-xl border border-blue-400/40 bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-400">
            Разрешить доступ
          </button>
        )}
      </form>
    </Card>
  )
}
