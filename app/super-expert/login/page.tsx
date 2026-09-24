'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Eye, EyeOff, Lock, Mail, MailCheck, ShieldCheck } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { SUPER_EXPERT_BASE } from '@/lib/admin/nav'

/**
 * Отдельный вход в кабинет SuperExpert.
 *
 * Это НЕ вторая система аутентификации: вход тот же самый, Supabase
 * email+пароль. Отличие — после входа мы сразу спрашиваем сервер, какие у
 * этого человека права (`/api/giga-admin/me`), и пускаем дальше, только если
 * роль действительно даёт работу с пользователями. Иначе сессия закрывается и
 * человек видит отказ — никакой «скрытой» панели по прямой ссылке.
 *
 * Вход по ссылке на почту обязателен, а не «приятное дополнение»: у сотрудника
 * может вообще не быть пароля (аккаунт заведён через Google), а Google-вход
 * на проекте сломан из-за чужого Site URL в Supabase. Без этой кнопки такой
 * человек в свой кабинет не попадёт. Ссылка ведёт сразу в /super-expert.
 */

/** Право, без которого кабинет SuperExpert бессмысленен. */
const REQUIRED = ['users.view', 'dashboard.view']

export default function SuperExpertLoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [linkState, setLinkState] = useState<'idle' | 'sending' | 'sent'>('idle')

  // ?denied=1 — сюда приводит middleware тех, у кого нет роли персонала
  // (в том числе экспертов бывшего портала /expert).
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('denied') === '1') {
      setError('У этой учётной записи нет доступа к кабинету эксперта. Портал /expert закрыт — попросите администратора выдать вам роль SuperExpert.')
    }
  }, [])

  // Вход по одноразовой ссылке: письмо шлём мы сами (см. /api/v1/auth/email-link),
  // поэтому настройки Supabase на него не влияют. Ответ сервера намеренно
  // одинаков для существующего и несуществующего адреса — не раскрываем базу.
  const sendLink = async () => {
    setError('')
    if (!email.trim()) { setError('Введите рабочий email — на него придёт ссылка.'); return }
    setLinkState('sending')
    try {
      const res = await fetch('/api/v1/auth/email-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), purpose: 'login', next: SUPER_EXPERT_BASE }),
      })
      if (res.status === 429) {
        setError('Слишком много запросов. Попробуйте через несколько минут.')
        setLinkState('idle')
        return
      }
      setLinkState('sent')
    } catch {
      setError('Ошибка соединения')
      setLinkState('idle')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const supabase = createClient()
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (signInError) {
        setError('Неверный email или пароль')
        return
      }

      // Роль и права читает сервер — фронтенд им не распоряжается.
      const res = await fetch('/api/giga-admin/me', { cache: 'no-store' })
      const body = (await res.json().catch(() => null)) as { ok?: boolean; data?: { permissions?: string[] } } | null
      const permissions = body?.data?.permissions ?? []
      const allowed = res.ok && REQUIRED.every((p) => permissions.includes(p))

      if (!allowed) {
        await supabase.auth.signOut()
        setError('Доступ запрещён: у этой учётной записи нет прав SuperExpert.')
        return
      }
      window.location.href = SUPER_EXPERT_BASE
    } catch {
      setError('Ошибка соединения')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center"
      style={{ background: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(59,130,246,0.08) 0%, transparent 60%), #04081a' }}
    >
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.03]"
        style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
          backgroundSize: '60px 60px',
        }}
      />

      <div className="relative z-10 w-full max-w-sm px-4">
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-8 backdrop-blur-xl">
          <div className="mb-8 flex flex-col items-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl border border-blue-500/30 bg-blue-500/20">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-icon-blue.svg" alt="AIStart360" className="h-8 w-8" />
            </div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-blue-400">SuperExpert</p>
            <p className="text-center text-sm text-slate-500">Кабинет работы с пользователями</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <label className="block">
              <span className="sr-only">Email</span>
              <div className="relative">
                <Mail size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
                <input
                  type="email"
                  required
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Рабочий email"
                  className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] py-3 pl-10 pr-3 text-sm text-slate-200 placeholder:text-slate-600 focus:border-blue-500/40 focus:outline-none"
                />
              </div>
            </label>

            <label className="block">
              <span className="sr-only">Пароль</span>
              <div className="relative">
                <Lock size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Пароль"
                  className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] py-3 pl-10 pr-10 text-sm text-slate-200 placeholder:text-slate-600 focus:border-blue-500/40 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>

            {error && (
              <p role="alert" className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-500 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-400 disabled:opacity-60"
            >
              <ShieldCheck size={15} />
              {loading ? 'Проверяем доступ…' : 'Войти в кабинет'}
            </button>
          </form>

          <div className="mt-5 border-t border-white/[0.07] pt-5">
            {linkState === 'sent' ? (
              <p className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2.5 text-xs text-emerald-200">
                Если аккаунт с таким адресом существует, мы отправили письмо со ссылкой для входа. Ссылка действует час и срабатывает один раз.
              </p>
            ) : (
              <button
                type="button"
                onClick={() => void sendLink()}
                disabled={linkState === 'sending'}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/[0.1] bg-white/[0.04] py-2.5 text-xs font-medium text-slate-300 transition-colors hover:bg-white/[0.07] disabled:opacity-60"
              >
                <MailCheck size={14} />
                {linkState === 'sending' ? 'Отправляем…' : 'Войти по ссылке на почту'}
              </button>
            )}
            <p className="mt-2 text-center text-[11px] text-slate-600">
              Нет пароля (вход через Google)? Используйте ссылку на почту.
            </p>
          </div>

          <p className="mt-4 text-center text-[11px] text-slate-600">
            Забыли пароль? <Link href="/forgot-password" className="text-blue-300 hover:underline">Восстановить</Link>
          </p>
        </div>
        <p className="mt-4 text-center text-[11px] text-slate-600">
          Это рабочий кабинет персонала. Клиентский вход — <Link href="/login" className="text-blue-300 hover:underline">здесь</Link>.
        </p>
      </div>
    </div>
  )
}
