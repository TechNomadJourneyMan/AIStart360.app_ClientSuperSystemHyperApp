'use client'

import Link from 'next/link'
import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth.store'
import { roleLandingPath } from '@/lib/role-landing'
import { resetPasswordErrorMessage } from './errors'

// Avoid static prerender: the Supabase browser client requires env vars that
// are not present at build time. Forcing dynamic rendering prevents the
// "@supabase/ssr: Your project's URL and API key are required" crash.
export const dynamic = 'force-dynamic'

const schema = z.object({
  password: z.string().min(8, 'Пароль минимум 8 символов'),
  confirmPassword: z.string().min(8, 'Подтверждение пароля обязательно'),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Пароли не совпадают',
  path: ['confirmPassword'],
})

type Form = z.infer<typeof schema>

/**
 * Новый пароль после ссылки восстановления или приглашения.
 *
 * Основной путь: письмо → /auth/confirm → POST /auth/verify, который ставит
 * сессию в cookie и приводит сюда — страница видит уже вошедшего человека.
 * Для старых писем остаются ?code (PKCE-обмен) и #access_token (неявный поток,
 * подхватывается браузерным клиентом Supabase).
 */
function ResetPasswordContent() {
  const params = useSearchParams()
  const code = params.get('code') ?? ''

  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isDone, setIsDone] = useState(false)
  const [checking, setChecking] = useState(true)
  const [canReset, setCanReset] = useState(false)
  const [accountEmail, setAccountEmail] = useState<string | null>(null)

  const { register, handleSubmit, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(schema),
  })

  useEffect(() => {
    const supabase = createClient()
    let active = true

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        setCanReset(true)
        if (session?.user?.email) setAccountEmail(session.user.email)
      }
    })

    ;(async () => {
      // Old PKCE links: exchange the ?code for a session.
      if (code) {
        try { await supabase.auth.exchangeCodeForSession(code) } catch { /* fall through to getUser */ }
      }
      // getUser() asks the Auth server — a stale cookie does not count as a session.
      const { data: { user } } = await supabase.auth.getUser()
      if (!active) return
      if (user) {
        setCanReset(true)
        setAccountEmail(user.email ?? null)
      }
      setChecking(false)
    })()

    return () => { active = false; sub.subscription.unsubscribe() }
  }, [code])

  const onSubmit = async (data: Form) => {
    setErrorMessage(null)
    setIsLoading(true)

    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password: data.password })

    if (error) {
      setIsLoading(false)
      const mapped = resetPasswordErrorMessage(error)
      if (mapped.expired) {
        setCanReset(false)
        return
      }
      setErrorMessage(mapped.message)
      return
    }

    setIsDone(true)
    // Сессия уже есть — ведём в свой кабинет по роли (персонал — в свою панель).
    // Полная загрузка страницы: middleware заново проверит доступ и, если
    // включена 2FA, спросит второй фактор.
    let dest = '/login'
    try {
      await useAuthStore.getState().init()
      const u = useAuthStore.getState().user
      if (u) dest = roleLandingPath(u.role, u.status, u.staffRole)
    } catch { /* '/login' — middleware сам уведёт вошедшего по роли */ }
    setTimeout(() => window.location.assign(dest), 1200)
  }

  if (checking) {
    return (
      <div className="glass-card rounded-2xl p-8 shadow-modal text-center">
        <p className="text-sm text-on-surface-variant">Проверяем ссылку…</p>
      </div>
    )
  }

  if (!canReset) {
    return (
      <div className="glass-card rounded-2xl p-8 shadow-modal text-center">
        <h1 className="font-headline text-2xl font-bold text-on-surface mb-2">Ссылка устарела</h1>
        <p className="text-sm text-on-surface-variant mb-6">
          Ссылка недействительна или уже была использована. Запросите новую — письмо придёт за минуту.
        </p>
        <Link href="/forgot-password" className="text-primary text-sm hover:underline">
          Запросить новую ссылку
        </Link>
      </div>
    )
  }

  if (isDone) {
    return (
      <div className="glass-card rounded-2xl p-8 shadow-modal text-center" role="status">
        <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
          <span className="material-symbols-outlined text-primary text-3xl" aria-hidden>check_circle</span>
        </div>
        <h1 className="font-headline text-2xl font-bold text-on-surface mb-2">Пароль обновлён</h1>
        <p className="text-sm text-on-surface-variant">Открываем ваш кабинет…</p>
      </div>
    )
  }

  return (
    <div className="glass-card rounded-2xl p-8 shadow-modal">
      <h1 className="font-headline text-2xl font-bold text-on-surface mb-1">Новый пароль</h1>
      <p className="text-sm text-on-surface-variant mb-8">
        {accountEmail ? (
          <>Придумайте новый пароль для <span className="text-primary font-mono break-all">{accountEmail}</span></>
        ) : (
          'Придумайте новый пароль для входа в AIStart360'
        )}
      </p>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        {/* Подсказка менеджеру паролей, для какого аккаунта сохранять пароль. */}
        {accountEmail && <input type="email" name="username" autoComplete="username" value={accountEmail} readOnly hidden />}
        <div>
          <label htmlFor="new-password" className="block text-xs font-label font-medium text-on-surface-variant mb-2 uppercase tracking-wider">
            Новый пароль
          </label>
          <input
            id="new-password"
            {...register('password')}
            type="password"
            autoComplete="new-password"
            className="w-full bg-surface-container border border-outline-variant/30 rounded-lg px-4 py-3 text-base sm:text-sm text-on-surface"
          />
          {errors.password && <p className="text-error text-xs mt-1.5">{errors.password.message}</p>}
        </div>

        <div>
          <label htmlFor="confirm-password" className="block text-xs font-label font-medium text-on-surface-variant mb-2 uppercase tracking-wider">
            Повторите пароль
          </label>
          <input
            id="confirm-password"
            {...register('confirmPassword')}
            type="password"
            autoComplete="new-password"
            className="w-full bg-surface-container border border-outline-variant/30 rounded-lg px-4 py-3 text-base sm:text-sm text-on-surface"
          />
          {errors.confirmPassword && <p className="text-error text-xs mt-1.5">{errors.confirmPassword.message}</p>}
        </div>

        {errorMessage && <p role="alert" className="text-error text-xs">{errorMessage}</p>}

        <button
          type="submit"
          disabled={isLoading}
          className="w-full py-3 rounded-lg bg-gradient-to-br from-primary to-primary-container text-on-primary font-semibold text-sm disabled:opacity-60"
        >
          {isLoading ? 'Сохраняем...' : 'Обновить пароль'}
        </button>
      </form>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="glass-card rounded-2xl p-8 shadow-modal">Загрузка...</div>}>
      <ResetPasswordContent />
    </Suspense>
  )
}
