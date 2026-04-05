'use client'

import React, { useState, useEffect, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuthStore } from '@/stores/auth.store'
import { Logo } from '@/components/ui/Logo'
import { ThemeSwitcher } from '@/components/ThemeSwitcher'

function LoginContent() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const { login, isLoading, error, clearError, user } = useAuthStore()
  const router = useRouter()
  const searchParams = useSearchParams()
  const from = searchParams.get('from') || '/dashboard'

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
        router.push(from)
      }
    }
  }, [user, from, router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await login(email, password)
    } catch (err) {
      // Error is handled by the store
    }
  }

  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Background blobs for aesthetics */}
      <div className="absolute top-0 left-0 w-full h-full pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-primary/5 rounded-full blur-[120px]" />
      </div>

      <div className="w-full max-w-md bg-surface-container/40 backdrop-blur-xl border border-white/[0.05] p-8 rounded-3xl shadow-2xl relative z-10 transition-all">
        <div className="flex justify-between items-center mb-10">
          <Logo className="h-8" />
          <ThemeSwitcher />
        </div>

        <div className="mb-8">
          <h1 className="text-3xl font-headline font-extrabold text-on-surface mb-2">С возвращением</h1>
          <p className="text-on-surface-variant text-sm">Вход в систему AI-ускорения бизнеса</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-error/10 border border-error/20 rounded-2xl flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
            <span className="material-symbols-outlined text-error text-xl mt-0.5">error</span>
            <div className="flex-1">
              <p className="text-[13px] text-error font-medium leading-tight">{error}</p>
            </div>
            <button
              onClick={clearError}
              className="text-error/60 hover:text-error transition-colors"
            >
              <span className="material-symbols-outlined text-sm">close</span>
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="block text-xs font-mono text-on-surface-variant uppercase tracking-widest ml-1">
              Email
            </label>
            <div className="relative group">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 material-symbols-outlined text-on-surface-variant/40 group-focus-within:text-primary transition-colors text-lg">
                alternate_email
              </span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full h-12 bg-surface-container-high border border-white/[0.05] rounded-2xl pl-12 pr-4 text-on-surface focus:outline-none focus:border-primary/50 focus:ring-4 focus:ring-primary/10 transition-all"
                placeholder="name@company.com"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center ml-1">
              <label className="block text-xs font-mono text-on-surface-variant uppercase tracking-widest">
                Пароль
              </label>
              <Link
                href="/forgot-password"
                className="text-[11px] text-primary/80 hover:text-primary transition-colors hover:underline"
              >
                Забыли пароль?
              </Link>
            </div>
            <div className="relative group">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 material-symbols-outlined text-on-surface-variant/40 group-focus-within:text-primary transition-colors text-lg">
                lock
              </span>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full h-12 bg-surface-container-high border border-white/[0.05] rounded-2xl pl-12 pr-4 text-on-surface focus:outline-none focus:border-primary/50 focus:ring-4 focus:ring-primary/10 transition-all"
                placeholder="••••••••"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full h-12 mt-4 bg-gradient-to-r from-primary to-primary-container text-on-primary font-bold rounded-2xl shadow-lg shadow-primary/20 hover:scale-[0.99] active:scale-[0.97] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 group"
          >
            {isLoading ? (
              <span className="w-5 h-5 border-2 border-on-primary/30 border-t-on-primary rounded-full animate-spin" />
            ) : (
              <>
                Войти в кабинет
                <span className="material-symbols-outlined text-base group-hover:translate-x-1 transition-transform">arrow_forward</span>
              </>
            )}
          </button>
        </form>

        <div className="mt-8 pt-8 border-t border-white/[0.05] text-center">
          <p className="text-sm text-on-surface-variant">
            Нет аккаунта?{' '}
            <Link
              href="/register"
              className="text-primary font-bold hover:underline"
            >
              Создать сейчас
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
    <Suspense fallback={<div className="min-h-screen bg-surface flex items-center justify-center" />}>
      <LoginContent />
    </Suspense>
  )
}
