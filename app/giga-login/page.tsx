'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Eye, EyeOff, Lock, UserRound } from 'lucide-react'

export default function GigaPanelLoginPage() {
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/giga-admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })

      if (res.ok) {
        // The password is never persisted client-side. The browser's own
        // password manager (hidden username field below) handles "remember".
        window.location.href = '/admin-giga-panel'
      } else if (res.status === 429) {
        setError('Слишком много попыток. Попробуйте позже.')
      } else if (res.status >= 500) {
        setError('Аварийный вход временно недоступен. Используйте личный аккаунт.')
      } else {
        setError('Неверный пароль')
      }
    } catch {
      setError('Ошибка соединения')
    } finally {
      setLoading(false)
    }
  }

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
            className="group mb-6 flex w-full items-center gap-3 rounded-xl border border-blue-500/30 bg-blue-500/20 px-4 py-3 text-left transition-all hover:border-blue-400/50 hover:bg-blue-500/30"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-400/15 text-blue-300">
              <UserRound size={18} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-blue-200">
                Войти через личный аккаунт
              </span>
              <span className="block text-[11px] leading-relaxed text-slate-500 group-hover:text-slate-400">
                Основной безопасный способ входа
              </span>
            </span>
          </Link>

          <div className="mb-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-white/[0.07]" />
            <span className="text-[10px] uppercase tracking-[0.16em] text-slate-600">
              Аварийный доступ
            </span>
            <span className="h-px flex-1 bg-white/[0.07]" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-4" autoComplete="on">
            {/* Hidden username field helps the browser password manager
                associate the saved credential with this form */}
            <input
              type="text"
              name="username"
              value="giga-admin"
              readOnly
              hidden
              autoComplete="username"
            />

            <div className="relative">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
                <Lock size={15} />
              </div>
              <input
                id="giga-password"
                type={showPassword ? 'text' : 'password'}
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Пароль администратора"
                className="w-full bg-white/[0.05] border border-white/[0.08] rounded-xl
                  pl-9 pr-10 py-3 text-sm text-slate-200 placeholder:text-slate-600
                  focus:outline-none focus:border-blue-500/50 focus:bg-white/[0.07]
                  transition-all"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>

            {error && (
              <p className="text-red-400 text-xs text-center">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !password}
              className="w-full py-3 rounded-xl bg-blue-500/20 border border-blue-500/30
                text-blue-300 text-sm font-medium
                hover:bg-blue-500/30 hover:border-blue-500/50
                disabled:opacity-40 disabled:cursor-not-allowed
                transition-all duration-200"
            >
              {loading ? 'Проверка...' : 'Войти'}
            </button>

            <p className="text-[10px] text-slate-600 text-center leading-relaxed">
              Общий пароль предназначен только для восстановления доступа.
              Для постоянной работы используйте личный аккаунт.
            </p>
          </form>
        </div>
      </div>
    </div>
  )
}
