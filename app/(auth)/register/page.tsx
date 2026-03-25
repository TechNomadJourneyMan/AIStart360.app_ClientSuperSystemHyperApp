'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuthStore } from '@/stores/auth.store'

const schema = z.object({
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

type Form = z.infer<typeof schema>

export default function RegisterPage() {
  const router = useRouter()
  const { register: registerUser, isLoading, error, clearError } = useAuthStore()
  const [showPass, setShowPass] = useState(false)
  const [step, setStep] = useState<1 | 2>(1)

  const { register, handleSubmit, watch, trigger, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { role: 'expert' },
  })

  const selectedRole = watch('role')

  const goStep2 = async () => {
    const ok = await trigger(['name', 'email', 'password', 'confirm'])
    if (ok) setStep(2)
  }

  const onSubmit = async (data: Form) => {
    clearError()
    try {
      await registerUser({
        name: data.name,
        email: data.email,
        password: data.password,
        role: data.role,
        organization: data.organization,
        position: data.position,
      })
      router.replace(data.role === 'admin' ? '/dashboard' : '/expert/dashboard')
    } catch { /* error shown via store */ }
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

      {/* RIGHT PANEL — Form */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12 overflow-y-auto">
        <div className="w-full max-w-[420px]">

          {/* Mobile logo */}
          <div className="flex items-center gap-2 mb-8 lg:hidden">
            <Image src="/logo-icon.svg" alt="AIStart360" width={32} height={32} />
            <span className="font-headline text-lg font-bold text-on-surface">AIStart360</span>
          </div>

          {/* Step indicator */}
          <div className="flex items-center gap-3 mb-8">
            {[1,2].map((s) => (
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

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">

            {/* STEP 1 */}
            {step === 1 && (
              <>
                {/* Name */}
                <div>
                  <label className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">Полное имя</label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant/40 text-xl">person</span>
                    <input
                      {...register('name')}
                      placeholder="Иван Иванов"
                      className="w-full bg-surface-container border border-white/[0.08] rounded-xl pl-11 pr-4 py-3.5 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
                    />
                  </div>
                  {errors.name && <p className="text-error text-xs mt-1.5">{errors.name.message}</p>}
                </div>

                {/* Email */}
                <div>
                  <label className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">Email</label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant/40 text-xl">mail</span>
                    <input
                      {...register('email')}
                      type="email"
                      placeholder="you@company.kz"
                      className="w-full bg-surface-container border border-white/[0.08] rounded-xl pl-11 pr-4 py-3.5 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
                    />
                  </div>
                  {errors.email && <p className="text-error text-xs mt-1.5">{errors.email.message}</p>}
                </div>

                {/* Password */}
                <div>
                  <label className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">Пароль</label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant/40 text-xl">lock</span>
                    <input
                      {...register('password')}
                      type={showPass ? 'text' : 'password'}
                      placeholder="Минимум 6 символов"
                      className="w-full bg-surface-container border border-white/[0.08] rounded-xl pl-11 pr-11 py-3.5 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
                    />
                    <button type="button" onClick={() => setShowPass(v => !v)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant/40 hover:text-on-surface-variant transition-colors">
                      <span className="material-symbols-outlined text-xl">{showPass ? 'visibility_off' : 'visibility'}</span>
                    </button>
                  </div>
                  {errors.password && <p className="text-error text-xs mt-1.5">{errors.password.message}</p>}
                </div>

                {/* Confirm */}
                <div>
                  <label className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">Подтверждение пароля</label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant/40 text-xl">lock_reset</span>
                    <input
                      {...register('confirm')}
                      type="password"
                      placeholder="Повторите пароль"
                      className="w-full bg-surface-container border border-white/[0.08] rounded-xl pl-11 pr-4 py-3.5 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
                    />
                  </div>
                  {errors.confirm && <p className="text-error text-xs mt-1.5">{errors.confirm.message}</p>}
                </div>

                <button type="button" onClick={goStep2}
                  className="w-full py-3.5 rounded-xl bg-gradient-to-r from-primary to-[#00e29e] text-[#003824] font-bold text-sm flex items-center justify-center gap-2 hover:scale-[0.99] transition-all">
                  Далее
                  <span className="material-symbols-outlined text-lg">arrow_forward</span>
                </button>
              </>
            )}

            {/* STEP 2 */}
            {step === 2 && (
              <>
                {/* Role selector */}
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
                        <input {...register('role')} type="radio" value={r.value} className="absolute opacity-0" />
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

                {/* Organization */}
                <div>
                  <label className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">Организация</label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant/40 text-xl">business</span>
                    <input
                      {...register('organization')}
                      placeholder="ООО Компания (необязательно)"
                      className="w-full bg-surface-container border border-white/[0.08] rounded-xl pl-11 pr-4 py-3.5 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
                    />
                  </div>
                </div>

                {/* Position */}
                <div>
                  <label className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">Должность</label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant/40 text-xl">badge</span>
                    <input
                      {...register('position')}
                      placeholder="CEO, Manager, Analyst..."
                      className="w-full bg-surface-container border border-white/[0.08] rounded-xl pl-11 pr-4 py-3.5 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
                    />
                  </div>
                </div>

                {/* Agree */}
                <label className="flex items-start gap-3 cursor-pointer group">
                  <input {...register('agree')} type="checkbox"
                    className="mt-0.5 w-4 h-4 rounded accent-primary flex-shrink-0 cursor-pointer" />
                  <span className="text-xs text-on-surface-variant leading-relaxed group-hover:text-on-surface transition-colors">
                    Я принимаю{' '}
                    <a href="#" className="text-primary hover:underline">Условия использования</a>
                    {' '}и{' '}
                    <a href="#" className="text-primary hover:underline">Политику конфиденциальности</a>
                  </span>
                </label>
                {errors.agree && <p className="text-error text-xs">{errors.agree.message}</p>}

                {/* Error */}
                {error && (
                  <div className="flex items-center gap-2 bg-error/10 border border-error/20 rounded-xl px-4 py-3">
                    <span className="material-symbols-outlined text-error text-lg flex-shrink-0">error</span>
                    <p className="text-error text-sm">{error}</p>
                  </div>
                )}

                <div className="flex gap-3">
                  <button type="button" onClick={() => setStep(1)}
                    className="flex-1 py-3.5 rounded-xl border border-white/[0.08] text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all text-sm font-medium">
                    Назад
                  </button>
                  <button type="submit" disabled={isLoading}
                    className="flex-1 py-3.5 rounded-xl bg-gradient-to-r from-primary to-[#00e29e] text-[#003824] font-bold text-sm flex items-center justify-center gap-2 hover:scale-[0.99] transition-all disabled:opacity-60">
                    {isLoading
                      ? <><span className="w-4 h-4 border-2 border-[#003824]/30 border-t-[#003824] rounded-full animate-spin" />Регистрируем...</>
                      : <><span className="material-symbols-outlined text-lg">person_add</span>Создать аккаунт</>
                    }
                  </button>
                </div>
              </>
            )}
          </form>

          <p className="text-center text-xs text-on-surface-variant mt-8">
            Уже есть аккаунт?{' '}
            <Link href="/login" className="text-primary hover:underline font-medium">Войти</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
