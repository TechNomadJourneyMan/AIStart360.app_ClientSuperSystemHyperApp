'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth.store'
import { roleLandingPath } from '@/lib/role-landing'
import { SymbolIcon } from '@/components/ui/SymbolIcon'
import { GoogleMark, LinkedInMark } from '@/components/auth-home/LoginForm'

const INPUT_CLASS =
  'w-full h-12 text-base bg-surface-container-high/60 border border-outline rounded-xl pl-12 text-on-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 transition-colors placeholder:text-on-surface-variant'
const LABEL_CLASS = 'block text-sm font-medium text-on-surface-variant'
const ICON_CLASS =
  'absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant group-focus-within:text-primary transition-colors text-lg'

/**
 * Форма регистрации клиента — общая для /register и главной (/).
 *
 * Вынесена из app/(auth)/register/page.tsx без изменения логики: проверки
 * паролей и согласия, `register({ role: 'client' })`, заявка через
 * /api/client/register и переход по `roleLandingPath` (новый клиент — в
 * комнату ожидания). Разметка подтянута до уровня формы входа: подписи
 * связаны с полями, autoComplete, шрифт полей 16px (без зума на iOS).
 *
 * `footer` заменяет строку «Уже есть аккаунт? Войти».
 */
export function RegisterForm({ footer }: { footer?: React.ReactNode }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [organization, setOrganization] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [agreeTerms, setAgreeTerms] = useState(false)
  const { register, loginWithGoogle, isLoading, error, clearError, user } = useAuthStore()
  const router = useRouter()

  useEffect(() => {
    if (user) {
      // FE-06: single source for role→home. A just-registered client is not yet
      // approved, so roleLandingPath lands them in the waiting room.
      router.push(roleLandingPath(user.role, user.status))
    }
  }, [user, router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password !== confirmPassword) {
      useAuthStore.setState({ error: 'Пароли не совпадают' })
      return
    }
    if (!agreeTerms) {
      useAuthStore.setState({ error: 'Необходимо принять условия использования' })
      return
    }
    if (password.length < 8) {
      useAuthStore.setState({ error: 'Пароль должен быть не менее 8 символов' })
      return
    }
    try {
      // Self-registration is for clients only. AIStart360 employees get access
      // from a Super Admin in the GIGA panel (staff roles), not through a sign-up tab.
      await register({ name, email, password, role: 'client', organization })
      const currentUser = useAuthStore.getState().user
      if (currentUser) {
        try {
          const res = await fetch('/api/client/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: currentUser.id,
              email: currentUser.email,
              name: currentUser.name,
              company: organization,
            }),
          })
          if (!res.ok) {
            console.warn('[register] /api/client/register returned', res.status, '— user created, admin request may be pending reconciliation')
          }
        } catch (clientRegErr) {
          // Non-blocking: Supabase auth user is created, waiting-room will work.
          // Giga Panel reconciliation will catch the missing AdminRequest.
          console.warn('[register] /api/client/register failed:', clientRegErr)
        }
      }
    } catch {
      // Error handled by store
    }
  }

  const describedBy = error ? 'register-error' : undefined

  return (
    <>
      {error && (
        <div id="register-error" role="alert" className="relative mb-4 p-4 pr-16 bg-error/10 border border-error/20 rounded-xl flex items-start gap-3">
          <SymbolIcon name="error" className="text-error text-lg mt-1" />
          <p className="text-base text-error flex-1">{error}</p>
          <button type="button" onClick={clearError} aria-label="Закрыть" className="absolute right-2 top-2 min-w-11 min-h-11 flex items-center justify-center rounded-lg text-error hover:bg-error/10">
            <SymbolIcon name="close" className="text-lg" />
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} aria-busy={isLoading} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="register-name" className={LABEL_CLASS}>Ваше имя</label>
          <div className="relative group">
            <SymbolIcon name="person" className={ICON_CLASS} />
            <input id="register-name" name="name" type="text" required autoComplete="name"
              value={name} onChange={(e) => setName(e.target.value)}
              aria-describedby={describedBy} className={`${INPUT_CLASS} pr-4`} placeholder="Иван Иванов" />
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="register-email" className={LABEL_CLASS}>Электронная почта</label>
          <div className="relative group">
            <SymbolIcon name="mail" className={ICON_CLASS} />
            <input id="register-email" name="email" type="email" required autoComplete="email"
              autoCapitalize="none" spellCheck={false}
              value={email} onChange={(e) => setEmail(e.target.value)}
              aria-describedby={describedBy} className={`${INPUT_CLASS} pr-4`} placeholder="info@company.kz" />
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="register-organization" className={LABEL_CLASS}>Название компании</label>
          <div className="relative group">
            <SymbolIcon name="business_center" className={ICON_CLASS} />
            <input id="register-organization" name="organization" type="text" required autoComplete="organization"
              value={organization} onChange={(e) => setOrganization(e.target.value)}
              aria-describedby={describedBy} className={`${INPUT_CLASS} pr-4`} placeholder="ООО TechStart KZ" />
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="register-password" className={LABEL_CLASS}>Пароль</label>
          <div className="relative group">
            <SymbolIcon name="lock" className={ICON_CLASS} />
            <input id="register-password" name="password" type={showPassword ? 'text' : 'password'} required
              autoComplete="new-password"
              value={password} onChange={(e) => setPassword(e.target.value)}
              aria-describedby={describedBy} className={`${INPUT_CLASS} pr-16`} placeholder="Минимум 8 символов" />
            <button type="button" onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
              aria-pressed={showPassword}
              className="absolute right-1 top-1/2 -translate-y-1/2 min-h-11 min-w-11 flex items-center justify-center rounded-lg text-on-surface-variant hover:text-primary hover:bg-primary/10 transition-colors">
              <SymbolIcon name={showPassword ? 'visibility_off' : 'visibility'} className="text-lg" />
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="register-confirm" className={LABEL_CLASS}>Подтверждение пароля</label>
          <div className="relative group">
            <SymbolIcon name="lock" className={ICON_CLASS} />
            <input id="register-confirm" name="confirmPassword" type={showPassword ? 'text' : 'password'} required
              autoComplete="new-password"
              value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
              aria-describedby={describedBy} className={`${INPUT_CLASS} pr-4`} placeholder="Повторите пароль" />
          </div>
        </div>

        {/* Social */}
        <div className="my-4 flex items-center gap-4" aria-hidden="true">
          <span className="h-px flex-1 bg-white/[0.06]" />
          <span className="text-xs font-mono text-on-surface-variant uppercase tracking-widest">или через</span>
          <span className="h-px flex-1 bg-white/[0.06]" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button type="button" onClick={() => loginWithGoogle()} disabled={isLoading}
            className="min-h-12 min-w-11 bg-surface-container/50 border border-white/[0.06] rounded-xl flex items-center justify-center gap-2 text-sm text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface disabled:cursor-not-allowed transition-colors">
            <GoogleMark />
            Google
          </button>
          <button type="button" disabled title="Скоро" aria-label="LinkedIn — скоро"
            className="min-h-12 min-w-11 bg-surface-container/30 border border-white/[0.06] rounded-xl flex flex-wrap items-center justify-center gap-x-2 gap-y-0 px-2 py-2 text-sm text-on-surface-variant cursor-not-allowed">
            <LinkedInMark />
            LinkedIn
            <span className="text-sm text-on-surface-variant">скоро</span>
          </button>
        </div>

        {/* Terms */}
        <div className="flex items-start gap-3 pt-1">
          <input id="register-terms" name="terms" type="checkbox" checked={agreeTerms} onChange={(e) => setAgreeTerms(e.target.checked)}
            className="mt-1 h-5 w-5 shrink-0 rounded border-outline bg-surface-container-high text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2" />
          <label htmlFor="register-terms" className="text-sm text-on-surface-variant leading-relaxed cursor-pointer">
            Я принимаю{' '}
            <Link href="/terms" className="text-primary underline hover:no-underline">Условия использования</Link>
            {' '}и{' '}
            <Link href="/privacy" className="text-primary underline hover:no-underline">Политику конфиденциальности</Link>
          </label>
        </div>

        {/* Submit */}
        <button type="submit" disabled={isLoading || !agreeTerms} aria-busy={isLoading}
          className="w-full min-h-12 px-4 py-3 bg-gradient-to-r from-primary to-primary-container text-on-primary font-bold rounded-xl shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-shadow disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none flex items-center justify-center gap-2">
          {isLoading ? (
            <><span aria-hidden="true" className="w-5 h-5 border-2 border-on-primary/30 border-t-on-primary rounded-full animate-spin" /><span role="status">Отправляем заявку…</span></>
          ) : (
            <>
              <SymbolIcon name="play_arrow" className="text-lg" />
              Подать заявку
            </>
          )}
        </button>

        {/* Info */}
        <div className="flex items-start gap-3 p-4 bg-primary/5 border border-primary/10 rounded-xl">
          <SymbolIcon name="info" className="text-primary text-lg mt-0.5" />
          <p className="text-sm text-on-surface-variant leading-relaxed">
            После регистрации ваша заявка будет рассмотрена администратором в течение 1 рабочего дня. Вы получите уведомление по email.
          </p>
        </div>
      </form>

      {footer ?? (
        <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0 mt-4 text-sm text-on-surface-variant">
          <span>Уже есть аккаунт?</span>
          <Link href="/login" className="inline-flex min-h-11 min-w-11 items-center text-primary font-bold hover:underline">Войти</Link>
        </div>
      )}
    </>
  )
}
