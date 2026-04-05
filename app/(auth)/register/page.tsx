'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/client'

const staffSchema = z.object({
  name:         z.string().min(2, 'Минимум 2 символа'),
  email:        z.string().email('Введите корректный email'),
  password:     z.string().min(6, 'Минимум 6 символов'),
  confirm:      z.string(),
  role:         z.enum(['admin', 'expert']),
  organization: z.string().optional(),
  position:     z.string().optional(),
  agree:        z.boolean().refine((v) => v === true, 'Необходимо согласие'),
}).refine((d) => d.password === d.confirm, {
  message: 'Пароли не совпадают',
  path: ['confirm'],
})

const clientSchema = z.object({
  name:     z.string().min(2, 'Минимум 2 символа'),
  email:    z.string().email('Введите корректный email'),
  password: z.string().min(6, 'Минимум 6 символов'),
  confirm:  z.string(),
  company:  z.string().min(2, 'Введите название компании'),
  agree:    z.boolean().refine((v) => v === true, 'Необходимо согласие'),
}).refine((d) => d.password === d.confirm, {
  message: 'Пароли не совпадают',
  path: ['confirm'],
})

type StaffForm  = z.infer<typeof staffSchema>
type ClientForm = z.infer<typeof clientSchema>
type PortalType = 'client' | 'staff'

const INPUT = 'w-full bg-surface-container border border-white/[0.08] rounded-xl pl-11 pr-4 py-3.5 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all'

const AUTH_ERRORS: Record<string, string> = {
  'User already registered':             'Этот email уже зарегистрирован',
  'Password should be at least 6 characters': 'Пароль должен содержать минимум 6 символов',
  'Unable to validate email address: invalid format': 'Некорректный формат email',
}

export default function RegisterPage() {
  const router = useRouter()

  const [portalType, setPortalType] = useState<PortalType>('client')
  const [showPass, setShowPass]     = useState(false)
  const [step, setStep]             = useState<1 | 2>(1)

  const [staffLoading, setStaffLoading] = useState(false)
  const [staffError,   setStaffError]   = useState<string | null>(null)

  const [clientLoading, setClientLoading] = useState(false)
  const [clientError,   setClientError]   = useState<string | null>(null)

  const sf = useForm<StaffForm>({
    resolver: zodResolver(staffSchema),
    defaultValues: { role: 'expert' },
  })
  const selectedRole = sf.watch('role')

  const cf = useForm<ClientForm>({ resolver: zodResolver(clientSchema) })

  const goStep2 = async () => {
    const ok = await sf.trigger(['name', 'email', 'password', 'confirm'])
    if (ok) setStep(2)
  }

  const onStaffSubmit = async (data: StaffForm) => {
    setStaffLoading(true)
    setStaffError(null)

    const supabase = createClient()
    const { data: authData, error: signUpError } = await supabase.auth.signUp({
      email:    data.email,
      password: data.password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: {
          full_name:    data.name,
          role:         data.role,
          organization: data.organization ?? '',
          position:     data.position ?? '',
        },
      },
    })

    if (signUpError) {
      setStaffError(AUTH_ERRORS[signUpError.message] ?? signUpError.message)
      setStaffLoading(false)
      return
    }

    // Persist role cookie for middleware while Supabase session propagates
    if (authData.user) {
      document.cookie = `aistart360_role=${data.role}; path=/; max-age=${60 * 60 * 24 * 7}`
      document.cookie = `aistart360_user_id=${authData.user.id.toString()}; path=/; max-age=${60 * 60 * 24 * 7}`
    }

    router.replace(data.role === 'admin' ? '/dashboard' : '/expert/dashboard')
  }

  const onClientSubmit = async (data: ClientForm) => {
    setClientLoading(true)
    setClientError(null)

    const supabase = createClient()
    const { data: authData, error: signUpError } = await supabase.auth.signUp({
      email:    data.email,
      password: data.password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: {
          full_name: data.name,
          company:   data.company,
          role:      'client',
        },
      },
    })

    if (signUpError) {
      setClientError(AUTH_ERRORS[signUpError.message] ?? signUpError.message)
      setClientLoading(false)
      return
    }

    if (!authData.user) {
      setClientError('Не удалось создать аккаунт')
      setClientLoading(false)
      return
    }

    const userId = authData.user.id.toString()

    // Create profile, company, and admin request via server API
    await fetch('/api/client/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        email: data.email,
        name: data.name,
        company: data.company,
      }),
    })

    router.replace('/client/waiting-room')
  }

  const switchPortal = (t: PortalType) => {
    setPortalType(t)
    setStep(1)
    sf.clearErrors()
    cf.clearErrors()
    setClientError(null)
    setStaffError(null)
  }

  return (
    <div className="min-h-screen flex bg-[#0A0B0F]">

      {/* LEFT PANEL */}
      <div className="hidden lg:flex lg:w-[44%] relative overflow-hidden bg-[#0d0f14] flex-col justify-between p-12">
        <div className="absolute inset-0 opacity-[0.025]"
          style={{ backgroundImage: 'linear-gradient(rgba(110,255,192,.6) 1px,transparent 1px),linear-gradient(90deg,rgba(110,255,192,.6) 1px,transparent 1px)', backgroundSize: '40px 40px' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 rounded-full bg-primary/4 blur-[100px] pointer-events-none" />

        <Image src="/logo.svg" alt="AIStart360" width={160} height={30} priority />

        <div className="relative z-10 space-y-6">
          <h2 className="font-headline text-3xl font-extrabold text-on-surface">
            Присоединяйтесь к<br />
            <span className="text-gradient">AIStart360</span>
          </h2>
          <p className="text-sm text-on-surface-variant leading-relaxed max-w-xs">
            Платформа для роста бизнеса с AI-диагностикой, рыночной аналитикой и стратегическим сопровождением.
          </p>

          <div className="space-y-4">
            {[
              { icon: 'radar',      title: 'GRI-диагностика',    desc: 'Оценка по 6 доменам готовности к росту' },
              { icon: 'show_chart', title: 'Рыночная аналитика', desc: 'TAM/SAM/SOM, тренды, конкуренты'       },
              { icon: 'route',      title: 'Дорожная карта',     desc: 'Точка А → Точка Б с конкретными KPI'  },
            ].map((f) => (
              <div key={f.icon} className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="material-symbols-outlined text-base text-primary">{f.icon}</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-on-surface">{f.title}</p>
                  <p className="text-xs text-on-surface-variant">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-card rounded-2xl p-5 border border-primary/10">
          <div className="flex gap-3">
            {['500+', '27', '94%'].map((v, i) => (
              <div key={i} className="flex-1 text-center">
                <p className="text-lg font-mono font-bold text-primary">{v}</p>
                <p className="text-[9px] font-mono text-on-surface-variant uppercase tracking-widest mt-0.5">
                  {['клиентов', 'отраслей', 'NPS'][i]}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* RIGHT PANEL */}
      <div className="flex-1 flex items-center justify-center px-5 py-8 lg:p-12 overflow-y-auto overflow-x-hidden">
        <div className="w-full max-w-[420px]">

          {/* Mobile logo */}
          <div className="flex items-center gap-2 mb-6 lg:hidden">
            <Image src="/logo-icon.svg" alt="AIStart360" width={32} height={32} />
            <span className="font-headline text-lg font-bold text-on-surface">AIStart360</span>
          </div>

          {/* Portal type toggle */}
          <div className="flex bg-surface-container rounded-xl p-1 mb-7 gap-1">
            {([
              { key: 'client' as PortalType, label: 'Клиент / Бизнес', icon: 'business_center' },
              { key: 'staff'  as PortalType, label: 'Команда',         icon: 'admin_panel_settings' },
            ]).map((t) => (
              <button key={t.key} type="button" onClick={() => switchPortal(t.key)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-medium transition-all ${
                  portalType === t.key ? 'bg-surface-container-high text-on-surface' : 'text-on-surface-variant hover:text-on-surface'
                }`}>
                <span className="material-symbols-outlined text-sm">{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>

          {/* ── CLIENT FORM ─────────────────────────────────── */}
          {portalType === 'client' && (
            <>
              <h1 className="font-headline text-2xl font-extrabold text-on-surface mb-1">Подать заявку</h1>
              <p className="text-sm text-on-surface-variant mb-7">Зарегистрируйтесь как клиент для AI-диагностики бизнеса</p>

              <form onSubmit={cf.handleSubmit(onClientSubmit)} className="space-y-4">
                <div>
                  <label className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">Ваше имя</label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant/40 text-xl">person</span>
                    <input {...cf.register('name')} placeholder="Иван Иванов" className={INPUT} />
                  </div>
                  {cf.formState.errors.name && <p className="text-error text-xs mt-1.5">{cf.formState.errors.name.message}</p>}
                </div>

                <div>
                  <label className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">Email</label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant/40 text-xl">mail</span>
                    <input {...cf.register('email')} type="email" placeholder="you@company.kz" className={INPUT} />
                  </div>
                  {cf.formState.errors.email && <p className="text-error text-xs mt-1.5">{cf.formState.errors.email.message}</p>}
                </div>

                <div>
                  <label className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">Название компании</label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant/40 text-xl">business</span>
                    <input {...cf.register('company')} placeholder="ООО TechStart KZ" className={INPUT} />
                  </div>
                  {cf.formState.errors.company && <p className="text-error text-xs mt-1.5">{cf.formState.errors.company.message}</p>}
                </div>

                <div>
                  <label className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">Пароль</label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant/40 text-xl">lock</span>
                    <input {...cf.register('password')} type={showPass ? 'text' : 'password'} placeholder="Минимум 6 символов"
                      className="w-full bg-surface-container border border-white/[0.08] rounded-xl pl-11 pr-11 py-3.5 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
                    <button type="button" onClick={() => setShowPass(v => !v)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant/40 hover:text-on-surface-variant transition-colors">
                      <span className="material-symbols-outlined text-xl">{showPass ? 'visibility_off' : 'visibility'}</span>
                    </button>
                  </div>
                  {cf.formState.errors.password && <p className="text-error text-xs mt-1.5">{cf.formState.errors.password.message}</p>}
                </div>

                <div>
                  <label className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">Подтверждение пароля</label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant/40 text-xl">lock_reset</span>
                    <input {...cf.register('confirm')} type="password" placeholder="Повторите пароль" className={INPUT} />
                  </div>
                  {cf.formState.errors.confirm && <p className="text-error text-xs mt-1.5">{cf.formState.errors.confirm.message}</p>}
                </div>

                {/* SSO */}
                <div className="flex items-center gap-3 my-2">
                  <div className="flex-1 h-px bg-white/[0.06]" />
                  <span className="text-xs text-on-surface-variant font-mono uppercase tracking-widest">или через</span>
                  <div className="flex-1 h-px bg-white/[0.06]" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={async () => {
                      const supabase = createClient()
                      await supabase.auth.signInWithOAuth({
                        provider: 'google',
                        options: { redirectTo: `${window.location.origin}/auth/callback` },
                      })
                    }}
                    className="flex items-center justify-center gap-2 py-3 rounded-xl border border-white/[0.08] bg-surface-container hover:bg-surface-container-high text-on-surface text-sm transition-colors"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    Google
                  </button>
                  <button type="button" disabled
                    className="flex items-center justify-center gap-2 py-3 rounded-xl border border-white/[0.08] bg-surface-container text-on-surface text-sm opacity-50 cursor-not-allowed"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M21.4 0H2.6C1.2 0 0 1.2 0 2.6v18.8C0 22.8 1.2 24 2.6 24h18.8c1.4 0 2.6-1.2 2.6-2.6V2.6C24 1.2 22.8 0 21.4 0zM7.1 20.5H3.6V9h3.6v11.5zM5.3 7.5c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm15.2 13H17V15c0-1.3 0-3-1.8-3s-2.1 1.4-2.1 2.9v5.6H9.5V9h3.4v1.6c.5-.9 1.6-1.8 3.3-1.8 3.5 0 4.2 2.3 4.2 5.3v6.4z"/>
                    </svg>
                    LinkedIn
                  </button>
                </div>

                <label className="flex items-start gap-3 cursor-pointer group">
                  <input {...cf.register('agree')} type="checkbox" className="mt-0.5 w-4 h-4 rounded accent-primary flex-shrink-0 cursor-pointer" />
                  <span className="text-xs text-on-surface-variant leading-relaxed group-hover:text-on-surface transition-colors">
                    Я принимаю{' '}
                    <a href="#" className="text-primary hover:underline">Условия использования</a>
                    {' '}и{' '}
                    <a href="#" className="text-primary hover:underline">Политику конфиденциальности</a>
                  </span>
                </label>
                {cf.formState.errors.agree && <p className="text-error text-xs">{cf.formState.errors.agree.message}</p>}

                {clientError && (
                  <div className="flex items-center gap-2 bg-error/10 border border-error/20 rounded-xl px-4 py-3">
                    <span className="material-symbols-outlined text-error text-lg flex-shrink-0">error</span>
                    <p className="text-error text-sm">{clientError}</p>
                  </div>
                )}

                <button type="submit" disabled={clientLoading}
                  className="w-full py-3.5 rounded-xl bg-gradient-to-r from-primary to-[#00e29e] text-[#003824] font-bold text-sm flex items-center justify-center gap-2 hover:scale-[0.99] transition-all disabled:opacity-60">
                  {clientLoading
                    ? <><span className="w-4 h-4 border-2 border-[#003824]/30 border-t-[#003824] rounded-full animate-spin" />Отправляем заявку...</>
                    : <><span className="material-symbols-outlined text-lg">send</span>Подать заявку</>
                  }
                </button>

                <div className="bg-surface-container rounded-xl p-4 flex gap-3">
                  <span className="material-symbols-outlined text-primary/60 text-lg flex-shrink-0 mt-0.5">info</span>
                  <p className="text-xs text-on-surface-variant leading-relaxed">
                    После регистрации ваша заявка будет рассмотрена администратором в течение 1 рабочего дня. Вы получите уведомление по email.
                  </p>
                </div>
              </form>
            </>
          )}

          {/* ── STAFF FORM ──────────────────────────────────── */}
          {portalType === 'staff' && (
            <>
              {/* Step indicator */}
              <div className="flex items-center gap-3 mb-8">
                {[1, 2].map((s) => (
                  <div key={s} className="flex items-center gap-2">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-mono font-bold transition-all ${
                      step === s ? 'bg-primary text-[#003824]' : step > s ? 'bg-primary/30 text-primary' : 'bg-surface-container text-on-surface-variant'
                    }`}>
                      {step > s ? <span className="material-symbols-outlined text-sm">check</span> : s}
                    </div>
                    {s < 2 && <div className={`h-px w-8 transition-colors ${step > s ? 'bg-primary' : 'bg-surface-container-high'}`} />}
                  </div>
                ))}
                <span className="text-xs text-on-surface-variant font-mono ml-2">
                  {step === 1 ? 'Аккаунт' : 'Профиль'}
                </span>
              </div>

              <h1 className="font-headline text-2xl font-extrabold text-on-surface mb-1">
                {step === 1 ? 'Создать аккаунт' : 'Данные профиля'}
              </h1>
              <p className="text-sm text-on-surface-variant mb-7">
                {step === 1 ? 'Шаг 1 из 2 — основные данные' : 'Шаг 2 из 2 — ваша роль и организация'}
              </p>

              <form onSubmit={sf.handleSubmit(onStaffSubmit)} className="space-y-4">
                {step === 1 && (
                  <>
                    <div>
                      <label className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">Полное имя</label>
                      <div className="relative">
                        <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant/40 text-xl">person</span>
                        <input {...sf.register('name')} placeholder="Иван Иванов" className={INPUT} />
                      </div>
                      {sf.formState.errors.name && <p className="text-error text-xs mt-1.5">{sf.formState.errors.name.message}</p>}
                    </div>

                    <div>
                      <label className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">Email</label>
                      <div className="relative">
                        <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant/40 text-xl">mail</span>
                        <input {...sf.register('email')} type="email" placeholder="you@company.kz" className={INPUT} />
                      </div>
                      {sf.formState.errors.email && <p className="text-error text-xs mt-1.5">{sf.formState.errors.email.message}</p>}
                    </div>

                    <div>
                      <label className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">Пароль</label>
                      <div className="relative">
                        <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant/40 text-xl">lock</span>
                        <input {...sf.register('password')} type={showPass ? 'text' : 'password'} placeholder="Минимум 6 символов"
                          className="w-full bg-surface-container border border-white/[0.08] rounded-xl pl-11 pr-11 py-3.5 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
                        <button type="button" onClick={() => setShowPass(v => !v)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant/40 hover:text-on-surface-variant transition-colors">
                          <span className="material-symbols-outlined text-xl">{showPass ? 'visibility_off' : 'visibility'}</span>
                        </button>
                      </div>
                      {sf.formState.errors.password && <p className="text-error text-xs mt-1.5">{sf.formState.errors.password.message}</p>}
                    </div>

                    <div>
                      <label className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">Подтверждение пароля</label>
                      <div className="relative">
                        <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant/40 text-xl">lock_reset</span>
                        <input {...sf.register('confirm')} type="password" placeholder="Повторите пароль" className={INPUT} />
                      </div>
                      {sf.formState.errors.confirm && <p className="text-error text-xs mt-1.5">{sf.formState.errors.confirm.message}</p>}
                    </div>

                    <button type="button" onClick={goStep2}
                      className="w-full py-3.5 rounded-xl bg-gradient-to-r from-primary to-[#00e29e] text-[#003824] font-bold text-sm flex items-center justify-center gap-2 hover:scale-[0.99] transition-all">
                      Далее
                      <span className="material-symbols-outlined text-lg">arrow_forward</span>
                    </button>
                  </>
                )}

                {step === 2 && (
                  <>
                    <div>
                      <label className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-3">Ваша роль</label>
                      <div className="grid grid-cols-2 gap-3">
                        {([
                          { value: 'admin',  label: 'Администратор', icon: 'admin_panel_settings', desc: 'Полный доступ к системе' },
                          { value: 'expert', label: 'Эксперт',       icon: 'psychology',           desc: 'Доступ к своей панели'  },
                        ] as const).map((r) => (
                          <label key={r.value} className={`relative cursor-pointer rounded-xl border p-4 transition-all ${
                            selectedRole === r.value
                              ? 'border-primary/50 bg-primary/10'
                              : 'border-white/[0.08] bg-surface-container hover:border-white/[0.16]'
                          }`}>
                            <input {...sf.register('role')} type="radio" value={r.value} className="absolute opacity-0" />
                            <span className={`material-symbols-outlined text-xl block mb-2 ${selectedRole === r.value ? 'text-primary' : 'text-on-surface-variant'}`}>{r.icon}</span>
                            <p className={`text-sm font-medium ${selectedRole === r.value ? 'text-primary' : 'text-on-surface'}`}>{r.label}</p>
                            <p className="text-[10px] text-on-surface-variant mt-0.5">{r.desc}</p>
                            {selectedRole === r.value && (
                              <span className="absolute top-2.5 right-2.5 material-symbols-outlined text-sm text-primary">check_circle</span>
                            )}
                          </label>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">Организация</label>
                      <div className="relative">
                        <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant/40 text-xl">business</span>
                        <input {...sf.register('organization')} placeholder="ООО Компания (необязательно)" className={INPUT} />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">Должность</label>
                      <div className="relative">
                        <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant/40 text-xl">badge</span>
                        <input {...sf.register('position')} placeholder="CEO, Manager, Analyst..." className={INPUT} />
                      </div>
                    </div>

                    <label className="flex items-start gap-3 cursor-pointer group">
                      <input {...sf.register('agree')} type="checkbox" className="mt-0.5 w-4 h-4 rounded accent-primary flex-shrink-0 cursor-pointer" />
                      <span className="text-xs text-on-surface-variant leading-relaxed group-hover:text-on-surface transition-colors">
                        Я принимаю{' '}
                        <a href="#" className="text-primary hover:underline">Условия использования</a>
                        {' '}и{' '}
                        <a href="#" className="text-primary hover:underline">Политику конфиденциальности</a>
                      </span>
                    </label>
                    {sf.formState.errors.agree && <p className="text-error text-xs">{sf.formState.errors.agree.message}</p>}

                    {staffError && (
                      <div className="flex items-center gap-2 bg-error/10 border border-error/20 rounded-xl px-4 py-3">
                        <span className="material-symbols-outlined text-error text-lg flex-shrink-0">error</span>
                        <p className="text-error text-sm">{staffError}</p>
                      </div>
                    )}

                    <div className="flex gap-3">
                      <button type="button" onClick={() => setStep(1)}
                        className="flex-1 py-3.5 rounded-xl border border-white/[0.08] text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all text-sm font-medium">
                        Назад
                      </button>
                      <button type="submit" disabled={staffLoading}
                        className="flex-1 py-3.5 rounded-xl bg-gradient-to-r from-primary to-[#00e29e] text-[#003824] font-bold text-sm flex items-center justify-center gap-2 hover:scale-[0.99] transition-all disabled:opacity-60">
                        {staffLoading
                          ? <><span className="w-4 h-4 border-2 border-[#003824]/30 border-t-[#003824] rounded-full animate-spin" />Регистрируем...</>
                          : <><span className="material-symbols-outlined text-lg">person_add</span>Создать аккаунт</>
                        }
                      </button>
                    </div>
                  </>
                )}
              </form>
            </>
          )}

          <p className="text-center text-xs text-on-surface-variant mt-8">
            Уже есть аккаунт?{' '}
            <Link href="/login" className="text-primary hover:underline font-medium">Войти</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
