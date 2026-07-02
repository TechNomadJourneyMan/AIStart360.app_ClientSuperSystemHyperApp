'use client'

import Link from 'next/link'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/client'

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

function ResetPasswordContent() {
  const params = useSearchParams()
  const router = useRouter()
  const code = params.get('code') ?? ''
  const email = params.get('email') ?? ''

  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isDone, setIsDone] = useState(false)
  // Link validity is decided by an actual recovery SESSION, not by the presence
  // of ?code. Supabase recovery links arrive either as ?code (PKCE — must be
  // exchanged) or as a #hash implicit token (auto-detected by the browser
  // client). Gating on ?code alone rejected valid hash-flow links.
  const [checking, setChecking] = useState(true)
  const [canReset, setCanReset] = useState(false)

  const { register, handleSubmit, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(schema),
  })

  useEffect(() => {
    const supabase = createClient()
    let active = true

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') setCanReset(true)
    })

    ;(async () => {
      // PKCE flow: exchange the ?code for a session.
      if (code) {
        try { await supabase.auth.exchangeCodeForSession(code) } catch { /* fall through to getSession */ }
      }
      const { data: { session } } = await supabase.auth.getSession()
      if (!active) return
      if (session) setCanReset(true)
      setChecking(false)
    })()

    return () => { active = false; sub.subscription.unsubscribe() }
  }, [code])

  const isInvalidLink = !checking && !canReset

  const onSubmit = async (data: Form) => {
    setErrorMessage(null)
    setIsLoading(true)

    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({
      password: data.password,
    })

    setIsLoading(false)

    if (error) {
      setErrorMessage('Не удалось обновить пароль. Попробуйте снова.')
      return
    }

    setIsDone(true)
    setTimeout(() => {
      router.push('/login')
    }, 800)
  }

  if (checking) {
    return (
      <div className="glass-card rounded-2xl p-8 shadow-modal text-center">
        <p className="text-sm text-on-surface-variant">Проверяем ссылку…</p>
      </div>
    )
  }

  if (isInvalidLink) {
    return (
      <div className="glass-card rounded-2xl p-8 shadow-modal text-center">
        <h1 className="font-headline text-2xl font-bold text-on-surface mb-2">Ссылка недействительна</h1>
        <p className="text-sm text-on-surface-variant mb-6">Ссылка недействительна или истекла</p>
        <Link href="/forgot-password" className="text-primary text-sm hover:underline">
          Запросить новую ссылку
        </Link>
      </div>
    )
  }

  if (isDone) {
    return (
      <div className="glass-card rounded-2xl p-8 shadow-modal text-center">
        <h1 className="font-headline text-2xl font-bold text-on-surface mb-2">Пароль обновлен</h1>
        <p className="text-sm text-on-surface-variant mb-6">Сейчас вы будете перенаправлены на страницу входа.</p>
        <Link href="/login" className="text-primary text-sm hover:underline">
          Перейти ко входу
        </Link>
      </div>
    )
  }

  return (
    <div className="glass-card rounded-2xl p-8 shadow-modal">
      <h1 className="font-headline text-2xl font-bold text-on-surface mb-1">Новый пароль</h1>
      <p className="text-sm text-on-surface-variant mb-8">Введите новый пароль для аккаунта {email || 'пользователя'}</p>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <div>
          <label className="block text-xs font-label font-medium text-on-surface-variant mb-2 uppercase tracking-wider">
            Новый пароль
          </label>
          <input
            {...register('password')}
            type="password"
            className="w-full bg-surface-container border border-outline-variant/30 rounded-lg px-4 py-3 text-sm text-on-surface"
          />
          {errors.password && <p className="text-error text-xs mt-1.5">{errors.password.message}</p>}
        </div>

        <div>
          <label className="block text-xs font-label font-medium text-on-surface-variant mb-2 uppercase tracking-wider">
            Повторите пароль
          </label>
          <input
            {...register('confirmPassword')}
            type="password"
            className="w-full bg-surface-container border border-outline-variant/30 rounded-lg px-4 py-3 text-sm text-on-surface"
          />
          {errors.confirmPassword && <p className="text-error text-xs mt-1.5">{errors.confirmPassword.message}</p>}
        </div>

        {errorMessage && <p className="text-error text-xs">{errorMessage}</p>}

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
