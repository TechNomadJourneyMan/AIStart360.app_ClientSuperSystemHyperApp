import Link from 'next/link'
import { UserRound } from 'lucide-react'

/**
 * Entry page of the GIGA panel. The shared-password («break-glass») form was
 * removed: staff sign in with their personal account (+ 2FA) and come back to
 * the panel through `?from=`. Middleware sends an already admitted super_admin
 * straight to the panel.
 */
export default function GigaPanelLoginPage() {
  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{
        background:
          'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(59,130,246,0.08) 0%, transparent 60%), #04081a',
      }}
    >
      <div
        className="fixed inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
          backgroundSize: '60px 60px',
        }}
      />

      <div className="relative z-10 w-full max-w-sm px-4">
        <div className="rounded-2xl bg-white/[0.04] border border-white/[0.08] backdrop-blur-xl p-8">
          <div className="flex flex-col items-center mb-8">
            <div className="w-12 h-12 rounded-2xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center mb-4 overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-icon-blue.svg" alt="AIStart360" className="w-8 h-8" />
            </div>
            <p className="text-xs font-semibold text-blue-400 tracking-[0.2em] uppercase mb-1">
              ГИГА-Панель
            </p>
            <p className="text-slate-500 text-sm text-center">
              Системный уровень доступа
            </p>
          </div>

          <Link
            href="/login?from=/admin-giga-panel"
            className="group mb-5 flex w-full items-center gap-3 rounded-xl border border-blue-500/30 bg-blue-500/20 px-4 py-3 text-left transition-all hover:border-blue-400/50 hover:bg-blue-500/30"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-400/15 text-blue-300">
              <UserRound size={18} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-blue-200">
                Войти через личный аккаунт
              </span>
              <span className="block text-[11px] leading-relaxed text-slate-500 group-hover:text-slate-400">
                Email и пароль, затем второй фактор (2FA)
              </span>
            </span>
          </Link>

          <p className="text-[11px] text-slate-500 text-center leading-relaxed">
            Вход в панель — только через личный аккаунт сотрудника AIStart360
            с двухфакторной аутентификацией. Нет доступа — обратитесь к Super Admin.
          </p>
        </div>
      </div>
    </div>
  )
}
