'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/client'

const schema = z.object({
  email: z.string().email('Введите корректный email'),
})

type Form = z.infer<typeof schema>

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [requestError, setRequestError] = useState<string | null>(null)
  const { register, handleSubmit, getValues, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(schema),
  })

  const onSubmit = async (data: Form) => {
    setRequestError(null)
    setIsLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.resetPasswordForEmail(data.email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    })
    setIsLoading(false)

    if (error) {
      setRequestError('Не удалось отправить письмо. Попробуйте снова.')
      return
    }

    setSent(true)
  }

  if (sent) {
    return (
      <div className="glass-card rounded-2xl p-8 shadow-modal text-center">
        <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
          <span className="material-symbols-outlined text-primary text-3xl">mark_email_read</span>
        </div>
        <h2 className="font-headline text-xl font-bold text-on-surface mb-2">Письмо отправлено</h2>
        <p className="text-sm text-on-surface-variant mb-6">
          Мы отправили ссылку для восстановления на{' '}
          <span className="text-primary font-mono">{getValues('email')}</span>
        </p>
        <Link
          href="/login"
          className="text-sm text-primary hover:underline"
        >
          ← Вернуться ко входу
        </Link>
      </div>
    )
  }

  return (
    <div className="glass-card rounded-2xl p-8 shadow-modal">
      <Link href="/login" className="inline-flex items-center gap-1 text-xs text-on-surface-variant hover:text-on-surface mb-6 transition-colors">
        <span className="material-symbols-outlined text-sm">arrow_back</span>
        Назад
      </Link>

      <h1 className="font-headline text-2xl font-bold text-on-surface mb-1">Восстановление пароля</h1>
      <p className="text-sm text-on-surface-variant mb-8">
        Введите email и мы пришлём ссылку для сброса пароля.
      </p>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <div>
          <label className="block text-xs font-label font-medium text-on-surface-variant mb-2 uppercase tracking-wider">
            Email
          </label>
          <div className="relative">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50 text-xl">mail</span>
            <input
              {...register('email')}
              type="email"
              placeholder="you@company.com"
              className="w-full bg-surface-container border border-outline-variant/30 rounded-lg pl-10 pr-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
            />
          </div>
          {errors.email && (
            <p className="text-error text-xs mt-1.5">{errors.email.message}</p>
          )}
        </div>

        {requestError && (
          <p className="text-error text-xs">{requestError}</p>
        )}

        <button
          type="submit"
          disabled={isLoading}
          className="w-full py-3 rounded-lg bg-gradient-to-br from-primary to-primary-container text-on-primary font-semibold text-sm hover:scale-[0.98] active:scale-95 transition-all duration-150 disabled:opacity-60 disabled:pointer-events-none flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <><span className="w-4 h-4 border-2 border-on-primary/30 border-t-on-primary rounded-full animate-spin" />Отправляем...</>
          ) : (
            'Отправить ссылку'
          )}
        </button>
      </form>
    </div>
  )
}
