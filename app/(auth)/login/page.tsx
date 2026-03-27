'use client'

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuthStore } from '@/stores/auth.store'

const schema = z.object({
  email:    z.string().email('Введите корректный email'),
  password: z.string().min(6, 'Минимум 6 символов'),
  remember: z.boolean().optional(),
})
type Form = z.infer<typeof schema>

const DEMO_ACCOUNTS = [
  { label: 'Клиент', email: 'client@aistart360.kz',  hint: 'client123', role: 'client' },
  { label: 'Expert', email: 'expert@aistart360.kz', hint: 'expert123', role: 'expert' },
  { label: 'Owner',  email: 'owner@aistart360.kz',  hint: 'owner123',  role: 'owner'  },
]

function LoginContent() {
  const router       = useRouter()
  const params       = useSearchParams()
  const from         = params.get('from') ?? '/dashboard'
  const { login, isLoading, error, clearError } = useAuthStore()

  const [showPass, setShowPass] = useState(false)

  const { register, handleSubmit, setValue, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(schema),
  })

  const onSubmit = async (data: Form) => {
    clearError()
    try {
      await login(data.email, data.password)
      // After login, role cookie is set by AuthProvider — redirect accordingly
      const role = useAuthStore.getState().role
      if (role === 'client') {
        router.replace('/waiting-room')
      } else if (role === 'admin') {
        router.replace(from.startsWith('/expert') || from.startsWith('/owner') ? '/dashboard' : from)
      } else if (role === 'owner') {
        router.replace('/owner/dashboard')
      } else {
        router.replace('/expert/dashboard')
      }
    } catch {
      // error shown via store.error
    }
  }

  const fillDemo = (email: string, password: string) => {
    setValue('email', email)
    setValue('password', password)
    clearError()
  }

  return (
    <div className="min-h-screen flex bg-[#0A0B0F]">

      {/* ── LEFT PANEL (desktop only) ── */}
      <div className="hidden lg:flex lg:w-[52%] relative overflow-hidden bg-[#0d0f14] flex-col justify-between p-12">
        {/* Background grid */}
        <div className="absolute inset-0 opacity-[0.03]"
          style={{ backgroundImage: 'linear-gradient(rgba(110,255,192,.6) 1px,transparent 1px),linear-gradient(90deg,rgba(110,255,192,.6) 1px,transparent 1px)', backgroundSize: '40px 40px' }} />

        {/* Animated glow orb */}
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full bg-primary/5 blur-[120px] pointer-events-none" />

        {/* Logo */}
        <div>
          <Image src="/logo.svg" alt="AIStart360" width={160} height={30} priority />
          <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-[0.3em] mt-2">
            Institutional Grade Intelligence
          </p>
        </div>

        {/* Center content */}
        <div className="relative z-10">
          {/* Radar SVG */}
          <div className="relative w-64 h-64 mx-auto mb-8">
            <svg viewBox="0 0 200 200" className="w-full h-full opacity-60">
              {[20,40,60,80].map((r) => (
                <circle key={r} cx="100" cy="100" r={r} fill="none" stroke="rgba(110,255,192,0.15)" strokeWidth="1" />
              ))}
              {[0,45,90,135].map((angle) => {
                const rad = (angle * Math.PI) / 180
                return (
                  <line key={angle}
                    x1={100 + 80 * Math.cos(rad)} y1={100 + 80 * Math.sin(rad)}
                    x2={100 - 80 * Math.cos(rad)} y2={100 - 80 * Math.sin(rad)}
                    stroke="rgba(110,255,192,0.1)" strokeWidth="1"
                  />
                )
              })}
              <polygon
                points="100,30 155,72 138,138 62,138 45,72"
                fill="rgba(110,255,192,0.08)" stroke="#6effc0" strokeWidth="1.5"
              />
              {[[100,30],[155,72],[138,138],[62,138],[45,72]].map(([cx,cy], i) => (
                <circle key={i} cx={cx} cy={cy} r="4" fill="#6effc0" />
              ))}
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <p className="text-2xl font-mono font-bold text-primary">GRI</p>
                <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">Платформа</p>
              </div>
            </div>
          </div>

          <h2 className="font-headline text-3xl font-extrabold text-on-surface text-center mb-4">
            AI & EXPERTS<br />
            <span className="text-gradient">GROWTH PLATFORM</span>
          </h2>
          <p className="text-sm text-on-surface-variant text-center max-w-xs mx-auto">
            Платформа диагностики и масштабирования бизнеса нового поколения
          </p>

          {/* Stats pills */}
          <div className="flex justify-center gap-3 mt-8 flex-wrap">
            {['500+ диагностик', '27 отраслей', 'СНГ · MENA'].map((s) => (
              <span key={s} className="text-[10px] font-mono bg-white/[0.06] border border-white/[0.08] text-on-surface-variant px-3 py-1.5 rounded-full">
                {s}
              </span>
            ))}
          </div>
        </div>

        {/* Bottom testimonial */}
        <div className="glass-card rounded-2xl p-5 border border-primary/10">
          <p className="text-sm text-on-surface-variant leading-relaxed">
            "AIStart360 помогла нам вырасти в 3x за 12 месяцев. GRI-диагностика — это не просто отчёт, это навигатор."
          </p>
          <div className="flex items-center gap-3 mt-4">
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">VS</div>
            <div>
              <p className="text-xs font-medium text-on-surface">Vortex Labs</p>
              <p className="text-[10px] text-on-surface-variant">Series A · FinTech</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── RIGHT PANEL — Auth Form ── */}
      <div className="flex-1 flex items-center justify-center px-5 py-8 lg:p-12 overflow-x-hidden">
        <div className="w-full max-w-[400px]">

          {/* Mobile logo */}
          <div className="flex items-center gap-2 mb-6 lg:hidden">
            <Image src="/logo-icon.svg" alt="AIStart360" width={28} height={28} />
            <span className="font-headline text-base font-bold text-on-surface">AIStart360</span>
          </div>

          {/* Badge */}
          <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-full px-3 py-1 mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            <span className="text-[10px] font-mono text-primary uppercase tracking-wider">Institutional Access</span>
          </div>

          <h1 className="font-headline text-2xl sm:text-3xl font-extrabold text-on-surface mb-1.5">
            Войти в систему
          </h1>
          <p className="text-sm text-on-surface-variant mb-6">
            Введите свои данные для входа
          </p>

          {/* Demo accounts — horizontal scroll on narrow screens */}
          <div className="mb-5">
            <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-2">
              Demo аккаунты
            </p>
            <div className="grid grid-cols-3 gap-2">
              {DEMO_ACCOUNTS.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  onClick={() => fillDemo(a.email, a.hint)}
                  className="text-xs font-mono bg-surface-container hover:bg-surface-container-high border border-white/[0.06] hover:border-primary/30 text-on-surface-variant hover:text-primary px-2.5 py-2 rounded-xl transition-all text-left min-w-0"
                >
                  <span className={`text-[10px] uppercase tracking-wider block mb-0.5 ${a.role === 'client' ? 'text-primary' : 'text-secondary'}`}>
                    {a.label}
                  </span>
                  <span className="text-[10px] opacity-70 block truncate">{a.email}</span>
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {/* Email */}
            <div>
              <label className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
                Email
              </label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant/40 text-xl">mail</span>
                <input
                  {...register('email')}
                  type="email"
                  placeholder="you@company.kz"
                  autoComplete="email"
                  className="w-full bg-surface-container border border-white/[0.08] rounded-xl pl-11 pr-4 py-3.5 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
                />
              </div>
              {errors.email && <p className="text-error text-xs mt-1.5">{errors.email.message}</p>}
            </div>

            {/* Password */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="text-xs font-mono text-on-surface-variant uppercase tracking-wider">Пароль</label>
                <Link href="/forgot-password" className="text-xs text-primary/70 hover:text-primary transition-colors">
                  Забыли пароль?
                </Link>
              </div>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant/40 text-xl">lock</span>
                <input
                  {...register('password')}
                  type={showPass ? 'text' : 'password'}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="w-full bg-surface-container border border-white/[0.08] rounded-xl pl-11 pr-11 py-3.5 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant/40 hover:text-on-surface-variant transition-colors"
                >
                  <span className="material-symbols-outlined text-xl">{showPass ? 'visibility_off' : 'visibility'}</span>
                </button>
              </div>
              {errors.password && <p className="text-error text-xs mt-1.5">{errors.password.message}</p>}
            </div>

            {/* Global error */}
            {error && (
              <div className="flex items-center gap-2 bg-error/10 border border-error/20 rounded-xl px-4 py-3">
                <span className="material-symbols-outlined text-error text-lg flex-shrink-0">error</span>
                <p className="text-error text-sm">{error}</p>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-primary to-[#00e29e] text-[#003824] font-bold text-sm shadow-lg hover:shadow-primary/20 hover:scale-[0.99] active:scale-[0.97] transition-all duration-150 disabled:opacity-60 disabled:pointer-events-none flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <span className="w-4 h-4 border-2 border-[#003824]/30 border-t-[#003824] rounded-full animate-spin" />
                  Входим...
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-lg">login</span>
                  Войти в платформу
                </>
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px bg-white/[0.06]" />
            <span className="text-xs text-on-surface-variant">или</span>
            <div className="flex-1 h-px bg-white/[0.06]" />
          </div>

          {/* SSO */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { name: 'Google', icon: '...' },
            ].map((sso) => (
              <button key={sso.name} className="flex items-center justify-center gap-2 py-3 rounded-xl border border-white/[0.08] bg-surface-container hover:bg-surface-container-high text-on-surface text-sm transition-colors">
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Google
              </button>
            ))}
            <button className="flex items-center justify-center gap-2 py-3 rounded-xl border border-white/[0.08] bg-surface-container hover:bg-surface-container-high text-on-surface text-sm transition-colors">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M21.4 0H2.6C1.2 0 0 1.2 0 2.6v18.8C0 22.8 1.2 24 2.6 24h18.8c1.4 0 2.6-1.2 2.6-2.6V2.6C24 1.2 22.8 0 21.4 0zM7.1 20.5H3.6V9h3.6v11.5zM5.3 7.5c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm15.2 13H17V15c0-1.3 0-3-1.8-3s-2.1 1.4-2.1 2.9v5.6H9.5V9h3.4v1.6c.5-.9 1.6-1.8 3.3-1.8 3.5 0 4.2 2.3 4.2 5.3v6.4z"/>
              </svg>
              LinkedIn
            </button>
          </div>

          <p className="text-center text-xs text-on-surface-variant mt-8">
            Нет аккаунта?{' '}
            <Link href="/register" className="text-primary hover:underline font-medium">
              Зарегистрироваться
            </Link>
          </p>

          {/* System status */}
          <div className="flex items-center justify-center gap-4 mt-6">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              <span className="text-[10px] font-mono text-primary/70">System Online</span>
            </div>
            <span className="text-on-surface-variant/20">·</span>
            <span className="text-[10px] font-mono text-on-surface-variant/40">ISO 27001</span>
            <span className="text-on-surface-variant/20">·</span>
            <span className="text-[10px] font-mono text-on-surface-variant/40">v2.0</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0A0B0F]" />}>
      <LoginContent />
    </Suspense>
  )
}
