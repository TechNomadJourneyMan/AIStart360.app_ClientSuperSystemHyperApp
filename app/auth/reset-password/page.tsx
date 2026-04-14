'use client'

import Link from 'next/link'
import { Suspense, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/client'
import { useTranslations } from 'next-intl'

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
  const supabase = createClient()
  const t = useTranslations()

  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isDone, setIsDone] = useState(false)

  const { register, handleSubmit, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(schema),
  })

  const isInvalidLink = useMemo(() => !code, [code])

  const onSubmit = async (data: Form) => {
    setErrorMessage(null)
    setIsLoading(true)

    const { error } = await supabase.auth.updateUser({
      password: data.password,
    })

    setIsLoading(false)

    if (error) {
      setErrorMessage(t('auth.updateFailed'))
      return
    }

    setIsDone(true)
    setTimeout(() => {
      router.push('/login')
    }, 800)
  }

  if (isInvalidLink) {
    return (
      <div className="glass-card rounded-2xl p-8 shadow-modal text-center">
        <h1 className="font-headline text-2xl font-bold text-on-surface mb-2">{t('auth.invalidLink')}</h1>
        <p className="text-sm text-on-surface-variant mb-6">{t('auth.linkExpiredOrInvalid')}</p>
        <Link href="/forgot-password" className="text-primary text-sm hover:underline">
          {t('auth.requestNewLink')}
        </Link>
      </div>
    )
  }

  if (isDone) {
    return (
      <div className="glass-card rounded-2xl p-8 shadow-modal text-center">
        <h1 className="font-headline text-2xl font-bold text-on-surface mb-2">{t('auth.passwordUpdated')}</h1>
        <p className="text-sm text-on-surface-variant mb-6">{t('auth.redirectToLogin')}</p>
        <Link href="/login" className="text-primary text-sm hover:underline">
          {t('auth.goToLogin')}
        </Link>
      </div>
    )
  }

  return (
    <div className="glass-card rounded-2xl p-8 shadow-modal">
      <h1 className="font-headline text-2xl font-bold text-on-surface mb-1">{t('auth.newPassword')}</h1>
      <p className="text-sm text-on-surface-variant mb-8">{t('auth.enterNewPasswordFor')} {email || t('auth.userFallback')}</p>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <div>
          <label className="block text-xs font-label font-medium text-on-surface-variant mb-2 uppercase tracking-wider">
            {t('auth.newPasswordLabel')}
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
            {t('auth.repeatPassword')}
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
          {isLoading ? t('auth.savingPassword') : t('auth.updatePassword')}
        </button>
      </form>
    </div>
  )
}

function ResetPasswordFallback() {
  const t = useTranslations()
  return <div className="glass-card rounded-2xl p-8 shadow-modal">{t('auth.loadingText')}</div>
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<ResetPasswordFallback />}>
      <ResetPasswordContent />
    </Suspense>
  )
}
