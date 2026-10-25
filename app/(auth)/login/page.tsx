'use client'

import { SymbolIcon } from '@/components/ui/SymbolIcon'
import React, { useState, useEffect, useRef, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuthStore } from '@/stores/auth.store'
import { Logo } from '@/components/ui/Logo'
import { safeInternalPath } from '@/lib/safe-redirect'
import { postLoginPath } from '@/lib/role-landing'
import { loginNotice } from '@/lib/auth/login-links'

function LoginContent() {
  const [isHydrated, setIsHydrated] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [demoLoading, setDemoLoading] = useState(false)
  const [demoError, setDemoError] = useState<string | null>(null)
  // Вход по ссылке на почту — работает без переадресации через Supabase.
  const [linkState, setLinkState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [linkError, setLinkError] = useState<string | null>(null)
  const { login, loginWithGoogle, isLoading, error, clearError, user } = useAuthStore()
  // A synchronous lock also covers two submissions in the same render frame.
  const actionPending = useRef(false)
  const busy = !isHydrated || isLoading || demoLoading || linkState === 'sending'
  const router = useRouter()
  const searchParams = useSearchParams()
  // Only honour internal `from` targets — never redirect off-origin.
  const rawFrom = searchParams.get('from')
  const from = safeInternalPath(rawFrom, '/dashboard')
  // Why the user was sent back here (expired email link, blocked account).
  const notice = loginNotice(searchParams)

  // The server-rendered form must not submit natively before its handler is
  // attached. In particular, a native GET would put credentials in the URL.
  useEffect(() => { setIsHydrated(true) }, [])

  useEffect(() => {
    if (user) {
      // Demo session — go to onboarding to capture business + documents.
      const demoPending = typeof window !== 'undefined'
        && sessionStorage.getItem('aistart360_demo_pending') === '1'
      if (demoPending && user.role === 'client') {
        sessionStorage.removeItem('aistart360_demo_pending')
        // Welcome screen: pick тип бизнеса → анкета/файлы/просто посмотреть
        router.push('/client/welcome')
        return
      }
      // FE-06: an explicit same-origin `?from=` wins (e.g. the GIGA panel
      // sends staff to /login?from=/admin-giga-panel); otherwise the single
      // role landing, which also routes staff_roles-only staff to their panel.
      router.push(postLoginPath({ role: user.role, status: user.status, staffRole: user.staffRole, from: rawFrom }))
    }
  }, [user, rawFrom, router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (actionPending.current || busy) return
    actionPending.current = true
    try {
      await login(email, password)
    } catch {
      // Error handled by store
    } finally {
      actionPending.current = false
    }
  }

  const handleDemoAccess = async () => {
    if (actionPending.current || busy) return
    actionPending.current = true
    setDemoError(null)
    setDemoLoading(true)
    clearError?.()
    try {
      const res = await fetch('/api/auth/demo-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
      })
      const ct = res.headers.get('content-type') ?? ''
      if (!ct.includes('application/json')) {
        const txt = await res.text()
        throw new Error(`HTTP ${res.status}: ${txt.slice(0, 160)}`)
      }
      const json = await res.json() as {
        ok: boolean
        email?: string
        password?: string
        userId?: string
        redirect?: string
        detail?: string
        error?: string
      }
      if (!json.ok || !json.email || !json.password) {
        throw new Error(json.detail ?? json.error ?? 'Не удалось создать демо-аккаунт')
      }
      // Reflect credentials in the form (so the user can see / save them).
      setEmail(json.email)
      setPassword(json.password)
      // Mark the session as demo so it lives one session only:
      //   - useEffect routes to /client/onboarding instead of /client/point-a
      //   - logout() in stores/auth.store.ts calls cleanup endpoint to
      //     delete the auth.users row (best-effort).
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('aistart360_demo_pending', '1')
        if (json.userId) sessionStorage.setItem('aistart360_demo_user_id', json.userId)
      }
      // Sign in immediately. The useEffect above handles redirect.
      await login(json.email, json.password)
    } catch (e) {
      setDemoError(e instanceof Error ? e.message : 'Демо-доступ недоступен')
    } finally {
      setDemoLoading(false)
      actionPending.current = false
    }
  }

  const sendLoginLink = async () => {
    if (actionPending.current || busy || linkState === 'sent') return
    setLinkError(null)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setLinkError('Введите адрес электронной почты — на него придёт ссылка для входа.')
      return
    }
    actionPending.current = true
    setLinkState('sending')
    try {
      const res = await fetch('/api/v1/auth/email-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), purpose: 'login', next: from }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Не удалось отправить письмо')
      setLinkState('sent')
    } catch (err) {
      setLinkState('idle')
      setLinkError(err instanceof Error ? err.message : 'Не удалось отправить письмо')
    } finally {
      actionPending.current = false
    }
  }

  const handleGoogleLogin = async () => {
    if (actionPending.current || busy) return
    actionPending.current = true
    try {
      await loginWithGoogle(rawFrom)
    } catch {
      // Error handled by store.
    } finally {
      actionPending.current = false
    }
  }

  return (
    <main className="min-h-screen bg-background text-on-surface">
      <div className="mx-auto flex min-h-screen max-w-7xl">
      {/* Left — Branding */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-8 xl:p-12 relative overflow-hidden">
        {/* Background glow */}
        <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-primary/5 rounded-full blur-[150px]" />

        <div className="relative z-10">
          <Logo className="min-h-11 min-w-11" />
          <p className="text-xs font-mono text-on-surface-variant uppercase tracking-widest mt-2">
            Интеллектуальная платформа для бизнеса
          </p>
        </div>

        <div className="relative z-10 flex flex-col items-center text-center">
          {/* GRI Hexagon */}
          <div className="w-48 h-48 mb-8 relative">
            <svg viewBox="0 0 200 200" className="w-full h-full text-primary" role="img" aria-label="GRI — платформа диагностики">
              <polygon points="100,10 180,55 180,145 100,190 20,145 20,55"
                fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.5" />
              <polygon points="100,30 160,65 160,135 100,170 40,135 40,65"
                fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="1" />
              <polygon points="100,50 140,75 140,125 100,150 60,125 60,75"
                fill="currentColor" fillOpacity="0.05" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1.5" />
              {/* Vertices */}
              {[[100,10],[180,55],[180,145],[100,190],[20,145],[20,55]].map(([cx,cy], i) => (
                <circle key={i} cx={cx} cy={cy} r="4" fill="currentColor" opacity="0.8" />
              ))}
              {/* Center text */}
              <text x="100" y="95" textAnchor="middle" fill="currentColor" fontSize="24" fontWeight="bold">GRI</text>
              <text x="100" y="115" textAnchor="middle" fill="currentColor" fontSize="13" letterSpacing="1">ПЛАТФОРМА</text>
            </svg>
          </div>

          <p className="text-base font-mono text-on-surface-variant tracking-widest uppercase">ИИ и эксперты</p>
          <h2 className="text-2xl font-headline font-extrabold text-primary mt-1">Платформа роста</h2>
          <p className="text-base text-on-surface-variant mt-4 max-w-sm leading-relaxed">
            Платформа диагностики и масштабирования бизнеса нового поколения
          </p>

          {/* Stats badges */}
          <div className="flex flex-wrap justify-center gap-2 mt-6">
            {[['500+', 'диагностик'], ['27', 'отраслей'], ['СНГ и Ближний Восток', '']].map(([val, label], i) => (
              <div key={i} className="px-4 py-2 bg-surface-container/40 border border-white/[0.05] rounded-full">
                <span className="text-xs font-mono text-on-surface-variant">
                  {val}{label ? ` · ${label}` : ''}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Testimonial */}
        <div className="relative z-10 bg-surface-container/30 border border-white/[0.05] rounded-2xl p-5">
          <p className="text-base text-on-surface-variant italic leading-relaxed">
            &ldquo;AIStart360 помогла нам вырасти в 3 раза за 12 месяцев. GRI-диагностика — это не просто отчёт, это навигатор.&rdquo;
          </p>
          <div className="flex items-center gap-3 mt-3">
            <div aria-hidden="true" className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">ВЛ</div>
            <div>
              <p className="text-sm font-bold text-on-surface">Вортекс Лабс</p>
              <p className="text-xs text-on-surface-variant">Раунд А · финансовые технологии</p>
            </div>
          </div>
        </div>
      </div>

      {/* Right — Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center px-4 py-6 sm:p-8 xl:p-12">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="lg:hidden mb-6">
            <Logo className="min-h-11 min-w-11" />
          </div>

          {/* Badge */}
          <div className="flex items-center gap-2 mb-4">
            <span aria-hidden="true" className="w-2 h-2 rounded-full bg-primary" />
            <span className="text-xs font-mono text-primary uppercase tracking-widest">Доступ к платформе</span>
          </div>

          <h1 className="text-2xl font-headline font-extrabold text-on-surface mb-1">Войти в систему</h1>
          <p className="text-base text-on-surface-variant mb-6">Введите свои данные для входа</p>

          {/* Demo access */}
          <button
            type="button"
            onClick={handleDemoAccess}
            disabled={busy}
            aria-busy={demoLoading}
            className="w-full min-h-12 mb-6 px-3 py-2 bg-surface-container/60 border border-white/[0.08] rounded-2xl flex items-center justify-center gap-2 text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition-colors disabled:cursor-not-allowed"
          >
            {demoLoading ? (
              <>
                <span className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <span className="text-sm font-medium">Создаём демо-аккаунт…</span>
              </>
            ) : (
              <>
                <SymbolIcon name="public" className="text-lg text-primary" />
                <span className="text-sm font-medium">Демо-доступ — войти как гость</span>
              </>
            )}
          </button>
          {demoError && (
            <div role="alert" className="relative mb-4 p-4 pr-16 bg-error/10 border border-error/20 rounded-xl flex items-start gap-3">
              <SymbolIcon name="error" className="text-error text-lg mt-1" />
              <p className="text-base text-error flex-1">{demoError}</p>
              <button type="button" onClick={() => setDemoError(null)} aria-label="Закрыть" className="absolute right-2 top-2 min-w-11 min-h-11 flex items-center justify-center rounded-lg text-error hover:bg-error/10">
                <SymbolIcon name="close" className="text-lg" />
              </button>
            </div>
          )}
          {notice && !error && (
            <div role="status" className="mb-4 p-4 bg-surface-container/60 border border-white/[0.08] rounded-xl flex items-start gap-3">
              <SymbolIcon name="info" className="text-primary text-lg mt-0.5" />
              <p className="text-base text-on-surface-variant flex-1">
                {notice}{' '}
                {searchParams.get('error') && (
                  <Link href="/forgot-password" className="inline-flex min-h-11 min-w-11 items-center text-primary hover:underline">Запросить новую ссылку</Link>
                )}
              </p>
            </div>
          )}

          {error && (
            <div id="login-error" role="alert" className="relative mb-4 p-4 pr-16 bg-error/10 border border-error/20 rounded-xl flex items-start gap-3">
              <SymbolIcon name="error" className="text-error text-lg mt-1" />
              <p className="text-base text-error flex-1">{error}</p>
              <button type="button" onClick={clearError} aria-label="Закрыть" className="absolute right-2 top-2 min-w-11 min-h-11 flex items-center justify-center rounded-lg text-error hover:bg-error/10">
                <SymbolIcon name="close" className="text-lg" />
              </button>
            </div>
          )}

          <form method="post" onSubmit={handleSubmit} aria-busy={isLoading} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="login-email" className="block text-sm font-medium text-on-surface-variant">Электронная почта</label>
              <div className="relative group">
                <SymbolIcon name="mail" className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant group-focus-within:text-primary transition-colors text-lg" />
                <input
                  type="email" required disabled={!isHydrated} value={email} onChange={(e) => setEmail(e.target.value)}
                  id="login-email" name="email" autoComplete="username" autoCapitalize="none" spellCheck={false}
                  aria-invalid={!!error} aria-describedby={error ? 'login-error' : undefined}
                  className="w-full h-12 text-base bg-surface-container-high/60 border border-outline rounded-xl pl-12 pr-4 text-on-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 transition-colors placeholder:text-on-surface-variant"
                  placeholder="you@company.kz"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center gap-2">
                <label htmlFor="login-password" className="block text-sm font-medium text-on-surface-variant">Пароль</label>
                <Link href="/forgot-password" className="inline-flex min-h-11 min-w-11 items-center text-sm text-primary hover:underline">Забыли пароль?</Link>
              </div>
              <div className="relative group">
                <SymbolIcon name="lock" className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant group-focus-within:text-primary transition-colors text-lg" />
                <input
                  type={showPassword ? 'text' : 'password'} required disabled={!isHydrated} value={password} onChange={(e) => setPassword(e.target.value)}
                  id="login-password" name="password" autoComplete="current-password"
                  aria-invalid={!!error} aria-describedby={error ? 'login-error' : undefined}
                  className="w-full h-12 text-base bg-surface-container-high/60 border border-outline rounded-xl pl-12 pr-16 text-on-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 transition-colors placeholder:text-on-surface-variant"
                  placeholder="••••••••"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                  aria-pressed={showPassword}
                  className="absolute right-1 top-1/2 -translate-y-1/2 min-h-11 min-w-11 flex items-center justify-center rounded-lg text-on-surface-variant hover:text-primary hover:bg-primary/10 transition-colors">
                  <SymbolIcon name={showPassword ? 'visibility_off' : 'visibility'} className="text-lg" />
                </button>
              </div>
            </div>

            <button
              type="submit" disabled={busy} aria-busy={isLoading}
              className="w-full min-h-12 px-4 py-3 bg-gradient-to-r from-primary to-primary-container text-on-primary font-bold rounded-xl shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-shadow disabled:cursor-not-allowed disabled:shadow-none flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <><span aria-hidden="true" className="w-5 h-5 border-2 border-on-primary/30 border-t-on-primary rounded-full animate-spin" /><span role="status">Входим…</span></>
              ) : (
                <>
                  <SymbolIcon name="login" className="text-lg" />
                  Войти в платформу
                </>
              )}
            </button>
          </form>

          {/* Вход по ссылке на почту */}
          <div className="mt-2 text-center" aria-live="polite">
            {linkState === 'sent' ? (
              <p className="text-base text-primary">Письмо отправлено. Откройте ссылку из него — вход завершится здесь же.</p>
            ) : (
              <button
                type="button"
                onClick={sendLoginLink}
                disabled={busy}
                aria-describedby={linkError ? 'login-link-error' : undefined}
                className="min-h-11 min-w-11 px-2 text-sm text-primary hover:underline disabled:cursor-not-allowed"
              >
                {linkState === 'sending' ? 'Отправляем письмо…' : 'Войти по ссылке на почту'}
              </button>
            )}
            {linkError && <p id="login-link-error" role="alert" className="mt-2 text-base text-error">{linkError}</p>}
          </div>

          {/* Divider */}
          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/[0.06]" /></div>
            <div className="relative flex justify-center">
              <span className="px-4 text-xs font-mono text-on-surface-variant bg-background uppercase tracking-widest">или</span>
            </div>
          </div>

          {/* Social buttons */}
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={handleGoogleLogin} disabled={busy}
              className="min-h-12 min-w-11 bg-surface-container/50 border border-white/[0.06] rounded-xl flex items-center justify-center gap-2 text-sm text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface disabled:cursor-not-allowed transition-colors">
              <svg aria-hidden="true" className="w-4 h-4" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Google
            </button>
            <button type="button" disabled title="Скоро" aria-label="LinkedIn — скоро"
              className="min-h-12 min-w-11 bg-surface-container/30 border border-white/[0.06] rounded-xl flex flex-wrap items-center justify-center gap-x-2 gap-y-0 px-2 py-2 text-sm text-on-surface-variant cursor-not-allowed">
              <svg aria-hidden="true" className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
              </svg>
              LinkedIn
              <span className="text-sm text-on-surface-variant">скоро</span>
            </button>
          </div>

          {/* Footer */}
          <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0 mt-4 text-sm text-on-surface-variant">
            <span>Нет аккаунта?</span>
            <Link href="/register" className="inline-flex min-h-11 min-w-11 items-center text-primary font-bold hover:underline">Зарегистрироваться</Link>
          </div>
        </div>
      </div>
      </div>
    </main>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-background flex items-center justify-center"><p role="status" className="text-base text-on-surface-variant">Загружаем форму входа…</p></main>}>
      <LoginContent />
    </Suspense>
  )
}
