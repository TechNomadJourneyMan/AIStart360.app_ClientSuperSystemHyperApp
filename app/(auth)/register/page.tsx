'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuthStore, type UserRole } from '@/stores/auth.store'
import { Logo } from '@/components/ui/Logo'
import { ThemeSwitcher } from '@/components/ThemeSwitcher'

export default function RegisterPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<UserRole>('client')
  const [organization, setOrganization] = useState('')
  const { register, isLoading, error, clearError, user } = useAuthStore()
  const router = useRouter()

  useEffect(() => {
    if (user) {
      if (user.role === 'client') {
        router.push('/client/onboarding')
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
    try {
      // 1. Core Supabase Registration
      await register({ name, email, password, role, organization })
      
      // 2. Fetch the created user from store (it was set inside register)
      const currentUser = useAuthStore.getState().user
      
      // 3. If client, trigger the approval flow API
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
    } catch (err) {
      // Error is handled by the store
    }
  }

  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Background blobs for aesthetics */}
      <div className="absolute top-0 left-0 w-full h-full pointer-events-none">
        <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] bg-primary/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/5 rounded-full blur-[120px]" />
      </div>

      <div className="w-full max-w-md bg-surface-container/40 backdrop-blur-xl border border-white/[0.05] p-8 rounded-3xl shadow-2xl relative z-10 transition-all">
        <div className="flex justify-between items-center mb-10">
          <Logo className="h-8" />
          <ThemeSwitcher />
        </div>

        <div className="mb-8">
          <h1 className="text-3xl font-headline font-extrabold text-on-surface mb-2">Начать рост</h1>
          <p className="text-on-surface-variant text-sm">Создайте аккаунт в системе AI-ускорения</p>
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
              Ваше имя
            </label>
            <div className="relative group">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 material-symbols-outlined text-on-surface-variant/40 group-focus-within:text-primary transition-colors text-lg">
                person
              </span>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full h-12 bg-surface-container-high border border-white/[0.05] rounded-2xl pl-12 pr-4 text-on-surface focus:outline-none focus:border-primary/50 focus:ring-4 focus:ring-primary/10 transition-all"
                placeholder="Иван Иванов"
              />
            </div>
          </div>

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
            <label className="block text-xs font-mono text-on-surface-variant uppercase tracking-widest ml-1">
              Пароль
            </label>
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
                placeholder="Минимум 8 знаков"
              />
            </div>
          </div>

          {/* Organization/Company field — added for client approval flow */}
          <div className="space-y-2">
            <label className="block text-xs font-mono text-on-surface-variant uppercase tracking-widest ml-1">
              Организация
            </label>
            <div className="relative group">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 material-symbols-outlined text-on-surface-variant/40 group-focus-within:text-primary transition-colors text-lg">
                business
              </span>
              <input
                type="text"
                required={role === 'client'}
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
                className="w-full h-12 bg-surface-container-high border border-white/[0.05] rounded-2xl pl-12 pr-4 text-on-surface focus:outline-none focus:border-primary/50 focus:ring-4 focus:ring-primary/10 transition-all"
                placeholder="Название вашей компании"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-mono text-on-surface-variant uppercase tracking-widest ml-1">
              Ваша роль
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setRole('client')}
                className={`h-11 rounded-2xl text-[13px] font-bold transition-all border ${
                  role === 'client'
                    ? 'bg-primary/10 border-primary text-primary shadow-sm shadow-primary/10'
                    : 'bg-surface-container-high border-white/[0.05] text-on-surface-variant hover:border-white/[0.1] hover:text-on-surface'
                }`}
              >
                Я Клиент
              </button>
              <button
                type="button"
                onClick={() => setRole('owner')}
                className={`h-11 rounded-2xl text-[13px] font-bold transition-all border ${
                  role === 'owner'
                    ? 'bg-primary/10 border-primary text-primary shadow-sm shadow-primary/10'
                    : 'bg-surface-container-high border-white/[0.05] text-on-surface-variant hover:border-white/[0.1] hover:text-on-surface'
                }`}
              >
                Я Владелец
              </button>
            </div>
            <p className="text-[10px] text-on-surface-variant/70 leading-relaxed mt-1 px-1">
              {role === 'client' 
                ? 'Для активации кабинета потребуется подтверждение администратором.' 
                : 'Ваш кабинет будет активирован сразу после регистрации.'}
            </p>
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
                Создать аккаунт
                <span className="material-symbols-outlined text-base group-hover:translate-x-1 transition-transform arrow_forward">arrow_forward</span>
              </>
            )}
          </button>
        </form>

        <div className="mt-8 pt-8 border-t border-white/[0.05] text-center">
          <p className="text-sm text-on-surface-variant">
            Уже есть аккаунт?{' '}
            <Link
              href="/login"
              className="text-primary font-bold hover:underline"
            >
              Войти
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
