'use client'

import React, { useState, useEffect, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuthStore } from '@/stores/auth.store'
import { Logo } from '@/components/ui/Logo'

function LoginContent() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const { login, loginWithGoogle, isLoading, error, clearError, user } = useAuthStore()
  const router = useRouter()
  const searchParams = useSearchParams()
  const from = searchParams.get('from') || '/dashboard'

  useEffect(() => {
    if (user) {
      if (user.role === 'client' && user.status === 'pending_approval') {
        router.push('/client/waiting-room')
      } else if (user.role === 'client' && user.status === 'approved') {
        router.push('/client/point-a')
      } else if (user.role === 'super_admin') {
        router.push('/admin-giga-panel')
      } else if (user.role === 'owner') {
        router.push('/owner/dashboard')
      } else if (user.role === 'expert') {
        router.push('/expert/dashboard')
      } else {
        router.push(from)
      }
    }
  }, [user, from, router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await login(email, password)
    } catch {
      // Error handled by store
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0e17] flex">
      {/* Left — Branding */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 relative overflow-hidden">
        {/* Background glow */}
        <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-primary/5 rounded-full blur-[150px]" />

        <div className="relative z-10">
          <Logo className="h-8" />
          <p className="text-[10px] font-mono text-on-surface-variant/50 uppercase tracking-[0.3em] mt-1">
            Institutional Grade Intelligence
          </p>
        </div>

        <div className="relative z-10 flex flex-col items-center text-center">
          {/* GRI Hexagon */}
          <div className="w-48 h-48 mb-8 relative">
            <svg viewBox="0 0 200 200" className="w-full h-full">
              <polygon points="100,10 180,55 180,145 100,190 20,145 20,55"
                fill="none" stroke="rgba(52,211,153,0.3)" strokeWidth="1.5" />
              <polygon points="100,30 160,65 160,135 100,170 40,135 40,65"
                fill="none" stroke="rgba(52,211,153,0.15)" strokeWidth="1" />
              <polygon points="100,50 140,75 140,125 100,150 60,125 60,75"
                fill="rgba(52,211,153,0.05)" stroke="rgba(52,211,153,0.4)" strokeWidth="1.5" />
              {/* Vertices */}
              {[[100,10],[180,55],[180,145],[100,190],[20,145],[20,55]].map(([cx,cy], i) => (
                <circle key={i} cx={cx} cy={cy} r="4" fill="#34d399" opacity="0.8" />
              ))}
              {/* Center text */}
              <text x="100" y="95" textAnchor="middle" fill="#34d399" fontSize="24" fontWeight="bold">GRI</text>
              <text x="100" y="115" textAnchor="middle" fill="#34d399" fontSize="9" letterSpacing="3" opacity="0.7">ПЛАТФОРМА</text>
            </svg>
          </div>

          <h2 className="text-lg font-mono text-on-surface-variant/70 tracking-widest uppercase">AI & Experts</h2>
          <h1 className="text-2xl font-headline font-extrabold text-primary mt-1">Growth Platform</h1>
          <p className="text-sm text-on-surface-variant/60 mt-4 max-w-xs leading-relaxed">
            Платформа диагностики и масштабирования бизнеса нового поколения
          </p>

          {/* Stats badges */}
          <div className="flex gap-3 mt-6">
            {[['500+', 'диагностик'], ['27', 'отраслей'], ['СНГ + MENA', '']].map(([val, label], i) => (
              <div key={i} className="px-4 py-2 bg-surface-container/40 border border-white/[0.05] rounded-full">
                <span className="text-xs font-mono text-on-surface-variant/70">
                  {val}{label ? ` · ${label}` : ''}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Testimonial */}
        <div className="relative z-10 bg-surface-container/30 border border-white/[0.05] rounded-2xl p-5">
          <p className="text-sm text-on-surface-variant/70 italic leading-relaxed">
            &ldquo;AIStart360 помогла нам вырасти в 3x за 12 месяцев. GRI-диагностика — это не просто отчёт, это навигатор.&rdquo;
          </p>
          <div className="flex items-center gap-3 mt-3">
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">VS</div>
            <div>
              <p className="text-xs font-bold text-on-surface/80">Vortex Labs</p>
              <p className="text-[10px] text-on-surface-variant/50">Series A · FinTech</p>
            </div>
          </div>
        </div>
      </div>

      {/* Right — Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="lg:hidden mb-8">
            <Logo className="h-8" />
          </div>

          {/* Badge */}
          <div className="flex items-center gap-2 mb-6">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <span className="text-[10px] font-mono text-primary/80 uppercase tracking-[0.2em]">Institutional Access</span>
          </div>

          <h1 className="text-2xl font-headline font-extrabold text-on-surface mb-1">Войти в систему</h1>
          <p className="text-sm text-on-surface-variant/60 mb-8">Введите свои данные для входа</p>

          {/* Demo access */}
          <button
            type="button"
            onClick={() => { setEmail('admin@aistart360.kz'); setPassword('admin123') }}
            className="w-full h-12 mb-6 bg-surface-container/60 border border-white/[0.08] rounded-2xl flex items-center justify-center gap-2 text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition-all"
          >
            <span className="material-symbols-outlined text-lg text-primary">public</span>
            <span className="text-sm font-medium">Демо-доступ</span>
          </button>

          {error && (
            <div className="mb-4 p-3 bg-error/10 border border-error/20 rounded-xl flex items-start gap-2">
              <span className="material-symbols-outlined text-error text-lg mt-0.5">error</span>
              <p className="text-[13px] text-error font-medium flex-1">{error}</p>
              <button onClick={clearError} className="text-error/60 hover:text-error">
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-[10px] font-mono text-on-surface-variant/60 uppercase tracking-widest ml-1">Email</label>
              <div className="relative group">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 material-symbols-outlined text-on-surface-variant/30 group-focus-within:text-primary transition-colors text-lg">mail</span>
                <input
                  type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-12 bg-surface-container-high/60 border border-white/[0.06] rounded-xl pl-12 pr-4 text-on-surface focus:outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 transition-all placeholder:text-on-surface-variant/30"
                  placeholder="you@company.kz"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between items-center ml-1">
                <label className="block text-[10px] font-mono text-on-surface-variant/60 uppercase tracking-widest">Пароль</label>
                <Link href="/forgot-password" className="text-[11px] text-primary/70 hover:text-primary transition-colors">Забыли пароль?</Link>
              </div>
              <div className="relative group">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 material-symbols-outlined text-on-surface-variant/30 group-focus-within:text-primary transition-colors text-lg">lock</span>
                <input
                  type={showPassword ? 'text' : 'password'} required value={password} onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-12 bg-surface-container-high/60 border border-white/[0.06] rounded-xl pl-12 pr-12 text-on-surface focus:outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 transition-all placeholder:text-on-surface-variant/30"
                  placeholder="••••••••"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-on-surface-variant/30 hover:text-on-surface-variant transition-colors">
                  <span className="material-symbols-outlined text-lg">{showPassword ? 'visibility_off' : 'visibility'}</span>
                </button>
              </div>
            </div>

            <button
              type="submit" disabled={isLoading}
              className="w-full h-12 mt-2 bg-gradient-to-r from-primary to-emerald-400 text-on-primary font-bold rounded-xl shadow-lg shadow-primary/20 hover:shadow-primary/30 hover:scale-[0.99] active:scale-[0.97] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <span className="w-5 h-5 border-2 border-on-primary/30 border-t-on-primary rounded-full animate-spin" />
              ) : (
                <>
                  <span className="material-symbols-outlined text-lg">login</span>
                  Войти в платформу
                </>
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/[0.06]" /></div>
            <div className="relative flex justify-center">
              <span className="px-4 text-[10px] font-mono text-on-surface-variant/40 bg-[#0a0e17] uppercase tracking-widest">или</span>
            </div>
          </div>

          {/* Social buttons */}
          <div className="grid grid-cols-2 gap-3">
            <button onClick={loginWithGoogle} disabled={isLoading}
              className="h-11 bg-surface-container/50 border border-white/[0.06] rounded-xl flex items-center justify-center gap-2 text-sm text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition-all">
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Google
            </button>
            <button disabled
              className="h-11 bg-surface-container/50 border border-white/[0.06] rounded-xl flex items-center justify-center gap-2 text-sm text-on-surface-variant/50 cursor-not-allowed">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
              </svg>
              LinkedIn
            </button>
          </div>

          {/* Footer */}
          <p className="text-center text-sm text-on-surface-variant/50 mt-8">
            Нет аккаунта?{' '}
            <Link href="/register" className="text-primary font-bold hover:underline">Зарегистрироваться</Link>
          </p>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0a0e17] flex items-center justify-center" />}>
      <LoginContent />
    </Suspense>
  )
}
