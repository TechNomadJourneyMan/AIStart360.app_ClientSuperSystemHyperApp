'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuthStore, type UserRole } from '@/stores/auth.store'
import { Logo } from '@/components/ui/Logo'

export default function RegisterPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [organization, setOrganization] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [role, setRole] = useState<UserRole>('client')
  const [agreeTerms, setAgreeTerms] = useState(false)
  const { register, loginWithGoogle, isLoading, error, clearError, user } = useAuthStore()
  const router = useRouter()

  useEffect(() => {
    if (user) {
      if (user.role === 'client' && user.status === 'pending_approval') {
        router.push('/client/waiting-room')
      } else if (user.role === 'super_admin') {
        router.push('/admin-giga-panel')
      } else if (user.role === 'owner') {
        router.push('/owner/dashboard')
      } else if (user.role === 'expert') {
        router.push('/expert/dashboard')
      } else {
        router.push('/dashboard')
      }
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
    try {
      await register({ name, email, password, role, organization })
      const currentUser = useAuthStore.getState().user
      if (currentUser && role === 'client') {
        await fetch('/api/client/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUser.id,
            email: currentUser.email,
            name: currentUser.name,
            company: organization,
          }),
        })
      }
    } catch {
      // Error handled by store
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0e17] flex">
      {/* Left — Branding */}
      <div className="hidden lg:flex lg:w-[45%] flex-col justify-between p-12 relative overflow-hidden">
        <div className="absolute top-1/3 left-1/3 w-[400px] h-[400px] bg-primary/5 rounded-full blur-[150px]" />

        <div className="relative z-10">
          <Logo className="h-8" />
        </div>

        <div className="relative z-10">
          <h1 className="text-3xl font-headline font-extrabold text-on-surface leading-tight">
            Присоединяйтесь к<br />
            <span className="text-primary">AIStart360</span>
          </h1>
          <p className="text-sm text-on-surface-variant/60 mt-4 max-w-sm leading-relaxed">
            Платформа для роста бизнеса с AI-диагностикой, рыночной аналитикой и стратегическим сопровождением.
          </p>

          {/* Features */}
          <div className="mt-8 space-y-4">
            {[
              { icon: 'radar', title: 'GRI-диагностика', desc: 'Оценка по 6 доменам готовности к росту' },
              { icon: 'query_stats', title: 'Рыночная аналитика', desc: 'TAM/SAM/SOM, тренды, конкуренты' },
              { icon: 'trending_up', title: 'Дорожная карта', desc: 'Точка А → Точка Б с конкретными KPI' },
            ].map((f) => (
              <div key={f.icon} className="flex items-start gap-3">
                <span className="material-symbols-outlined text-primary text-xl mt-0.5">{f.icon}</span>
                <div>
                  <p className="text-sm font-bold text-on-surface/80">{f.title}</p>
                  <p className="text-xs text-on-surface-variant/50">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Stats */}
        <div className="relative z-10 grid grid-cols-3 gap-3">
          {[
            { val: '500+', label: 'клиентов' },
            { val: '27', label: 'отраслей' },
            { val: '94%', label: 'NPS' },
          ].map((s) => (
            <div key={s.label} className="bg-surface-container/30 border border-white/[0.05] rounded-xl p-4 text-center">
              <p className="text-xl font-bold text-primary">{s.val}</p>
              <p className="text-[10px] font-mono text-on-surface-variant/50 uppercase tracking-wider mt-1">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Right — Form */}
      <div className="w-full lg:w-[55%] flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="lg:hidden mb-8">
            <Logo className="h-8" />
          </div>

          {/* Role tabs */}
          <div className="grid grid-cols-2 gap-1 bg-surface-container/40 p-1 rounded-xl mb-6">
            <button onClick={() => setRole('client')}
              className={`h-10 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-all ${
                role === 'client' ? 'bg-surface-container-high text-on-surface shadow-sm' : 'text-on-surface-variant/60 hover:text-on-surface-variant'
              }`}>
              <span className="material-symbols-outlined text-base">business_center</span>
              Клиент / Бизнес
            </button>
            <button onClick={() => setRole('owner')}
              className={`h-10 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-all ${
                role === 'owner' ? 'bg-surface-container-high text-on-surface shadow-sm' : 'text-on-surface-variant/60 hover:text-on-surface-variant'
              }`}>
              <span className="material-symbols-outlined text-base">groups</span>
              Команда
            </button>
          </div>

          <h1 className="text-2xl font-headline font-extrabold text-on-surface mb-1">Подать заявку</h1>
          <p className="text-sm text-on-surface-variant/50 mb-6">
            {role === 'client'
              ? 'Зарегистрируйтесь как клиент для AI-диагностики бизнеса.'
              : 'Присоединяйтесь к команде AIStart360.'}
          </p>

          {error && (
            <div className="mb-4 p-3 bg-error/10 border border-error/20 rounded-xl flex items-start gap-2">
              <span className="material-symbols-outlined text-error text-lg mt-0.5">error</span>
              <p className="text-[13px] text-error font-medium flex-1">{error}</p>
              <button onClick={clearError} className="text-error/60 hover:text-error">
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3.5">
            {/* Name */}
            <div className="space-y-1.5">
              <label className="block text-[10px] font-mono text-on-surface-variant/60 uppercase tracking-widest ml-1">Ваше имя</label>
              <div className="relative group">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 material-symbols-outlined text-on-surface-variant/30 group-focus-within:text-primary transition-colors text-lg">person</span>
                <input type="text" required value={name} onChange={(e) => setName(e.target.value)}
                  className="w-full h-11 bg-surface-container-high/60 border border-white/[0.06] rounded-xl pl-11 pr-4 text-sm text-on-surface focus:outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 transition-all placeholder:text-on-surface-variant/30"
                  placeholder="Иван Иванов" />
              </div>
            </div>

            {/* Email */}
            <div className="space-y-1.5">
              <label className="block text-[10px] font-mono text-on-surface-variant/60 uppercase tracking-widest ml-1">Email</label>
              <div className="relative group">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 material-symbols-outlined text-on-surface-variant/30 group-focus-within:text-primary transition-colors text-lg">mail</span>
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-11 bg-surface-container-high/60 border border-white/[0.06] rounded-xl pl-11 pr-4 text-sm text-on-surface focus:outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 transition-all placeholder:text-on-surface-variant/30"
                  placeholder="info@company.kz" />
              </div>
            </div>

            {/* Company */}
            <div className="space-y-1.5">
              <label className="block text-[10px] font-mono text-on-surface-variant/60 uppercase tracking-widest ml-1">Название компании</label>
              <div className="relative group">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 material-symbols-outlined text-on-surface-variant/30 group-focus-within:text-primary transition-colors text-lg">business</span>
                <input type="text" required={role === 'client'} value={organization} onChange={(e) => setOrganization(e.target.value)}
                  className="w-full h-11 bg-surface-container-high/60 border border-white/[0.06] rounded-xl pl-11 pr-4 text-sm text-on-surface focus:outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 transition-all placeholder:text-on-surface-variant/30"
                  placeholder="ООО TechStart KZ" />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label className="block text-[10px] font-mono text-on-surface-variant/60 uppercase tracking-widest ml-1">Пароль</label>
              <div className="relative group">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 material-symbols-outlined text-on-surface-variant/30 group-focus-within:text-primary transition-colors text-lg">lock</span>
                <input type={showPassword ? 'text' : 'password'} required value={password} onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-11 bg-surface-container-high/60 border border-white/[0.06] rounded-xl pl-11 pr-11 text-sm text-on-surface focus:outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 transition-all placeholder:text-on-surface-variant/30"
                  placeholder="Минимум 8 символов" />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant/30 hover:text-on-surface-variant transition-colors">
                  <span className="material-symbols-outlined text-lg">{showPassword ? 'visibility_off' : 'visibility'}</span>
                </button>
              </div>
            </div>

            {/* Confirm Password */}
            <div className="space-y-1.5">
              <label className="block text-[10px] font-mono text-on-surface-variant/60 uppercase tracking-widest ml-1">Подтверждение пароля</label>
              <div className="relative group">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 material-symbols-outlined text-on-surface-variant/30 group-focus-within:text-primary transition-colors text-lg">lock</span>
                <input type={showPassword ? 'text' : 'password'} required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full h-11 bg-surface-container-high/60 border border-white/[0.06] rounded-xl pl-11 pr-4 text-sm text-on-surface focus:outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 transition-all placeholder:text-on-surface-variant/30"
                  placeholder="Повторите пароль" />
              </div>
            </div>

            {/* Social */}
            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/[0.06]" /></div>
              <div className="relative flex justify-center">
                <span className="px-3 text-[10px] font-mono text-on-surface-variant/40 bg-[#0a0e17] uppercase tracking-widest">или через</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={loginWithGoogle} disabled={isLoading}
                className="h-10 bg-surface-container/50 border border-white/[0.06] rounded-xl flex items-center justify-center gap-2 text-sm text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition-all">
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Google
              </button>
              <button type="button" disabled
                className="h-10 bg-surface-container/50 border border-white/[0.06] rounded-xl flex items-center justify-center gap-2 text-sm text-on-surface-variant/50 cursor-not-allowed">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                </svg>
                LinkedIn
              </button>
            </div>

            {/* Terms */}
            <label className="flex items-start gap-2.5 mt-3 cursor-pointer">
              <input type="checkbox" checked={agreeTerms} onChange={(e) => setAgreeTerms(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-white/[0.1] bg-surface-container-high text-primary focus:ring-primary/20 focus:ring-2" />
              <span className="text-[11px] text-on-surface-variant/60 leading-relaxed">
                Я принимаю{' '}
                <Link href="/terms" className="text-primary/80 hover:text-primary underline">Условия использования</Link>
                {' '}и{' '}
                <Link href="/privacy" className="text-primary/80 hover:text-primary underline">Политику конфиденциальности</Link>
              </span>
            </label>

            {/* Submit */}
            <button type="submit" disabled={isLoading || !agreeTerms}
              className="w-full h-12 mt-2 bg-gradient-to-r from-primary to-emerald-400 text-on-primary font-bold rounded-xl shadow-lg shadow-primary/20 hover:shadow-primary/30 hover:scale-[0.99] active:scale-[0.97] transition-all disabled:opacity-50 flex items-center justify-center gap-2">
              {isLoading ? (
                <span className="w-5 h-5 border-2 border-on-primary/30 border-t-on-primary rounded-full animate-spin" />
              ) : (
                <>
                  <span className="material-symbols-outlined text-lg">play_arrow</span>
                  Подать заявку
                </>
              )}
            </button>

            {/* Info */}
            <div className="flex items-start gap-2 mt-3 p-3 bg-primary/5 border border-primary/10 rounded-xl">
              <span className="material-symbols-outlined text-primary/60 text-lg mt-0.5">info</span>
              <p className="text-[11px] text-on-surface-variant/60 leading-relaxed">
                После регистрации ваша заявка будет рассмотрена администратором в течение 1 рабочего дня. Вы получите уведомление по email.
              </p>
            </div>
          </form>

          {/* Footer */}
          <p className="text-center text-sm text-on-surface-variant/50 mt-6">
            Уже есть аккаунт?{' '}
            <Link href="/login" className="text-primary font-bold hover:underline">Войти</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
