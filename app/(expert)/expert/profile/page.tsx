'use client'

import { useAuthStore } from '@/stores/auth.store'
import { useState } from 'react'

export default function ExpertProfilePage() {
  const { user } = useAuthStore()
  const [editing, setEditing] = useState(false)
  const initials = user?.name?.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase() ?? 'EX'

  return (
    <div className="space-y-8 max-w-3xl">
      <section>
        <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">Expert Portal</p>
        <h1 className="font-headline text-3xl font-extrabold text-on-surface">Мой профиль</h1>
        <p className="text-on-surface-variant mt-2 text-sm">Управление личными данными и настройками</p>
      </section>

      {/* Profile Card */}
      <section className="bg-surface-container-low rounded-2xl border border-white/[0.04] overflow-hidden">
        <div className="bg-gradient-to-r from-primary/10 to-transparent h-24 relative">
          <div className="absolute -bottom-8 left-6">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/40 to-primary/10 border-4 border-[#0e0f14] flex items-center justify-center">
              <span className="text-xl font-headline font-bold text-primary">{initials}</span>
            </div>
          </div>
        </div>
        <div className="pt-12 px-6 pb-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="font-headline text-xl font-bold text-on-surface">{user?.name ?? '—'}</h2>
              <p className="text-sm text-on-surface-variant">{user?.position ?? 'Expert'} · {user?.organization ?? '—'}</p>
            </div>
            <button onClick={() => setEditing(!editing)}
              className="text-xs font-mono text-primary bg-primary/10 border border-primary/20 hover:bg-primary/20 px-4 py-2 rounded-xl transition-colors">
              {editing ? 'Сохранить' : 'Редактировать'}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { label: 'Email',        value: user?.email,        icon: 'mail'     },
              { label: 'Роль',         value: 'Эксперт',          icon: 'badge'    },
              { label: 'Организация',  value: user?.organization, icon: 'business' },
              { label: 'Должность',    value: user?.position,     icon: 'work'     },
              { label: 'Дата регистрации', value: user?.createdAt ? new Date(user.createdAt).toLocaleDateString('ru-RU') : '—', icon: 'calendar_today' },
              { label: 'Последний вход', value: user?.lastLogin ? new Date(user.lastLogin).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }) : '—', icon: 'login' },
            ].map((field) => (
              <div key={field.label} className="flex items-center gap-3 bg-surface-container rounded-xl p-4">
                <span className="material-symbols-outlined text-lg text-primary/50 flex-shrink-0">{field.icon}</span>
                <div className="min-w-0">
                  <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">{field.label}</p>
                  {editing && !['Роль', 'Дата регистрации', 'Последний вход'].includes(field.label) ? (
                    <input defaultValue={field.value ?? ''} className="text-sm text-on-surface bg-transparent border-b border-primary/40 focus:outline-none w-full mt-0.5 pb-0.5" />
                  ) : (
                    <p className="text-sm text-on-surface truncate mt-0.5">{field.value ?? '—'}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Security */}
      <section className="bg-surface-container-low rounded-2xl border border-white/[0.04] overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-white/[0.04]">
          <span className="material-symbols-outlined text-lg text-primary/60">security</span>
          <h2 className="text-sm font-headline font-bold text-on-surface">Безопасность</h2>
        </div>
        <div className="divide-y divide-white/[0.04]">
          {[
            { label: '2FA', value: 'Не настроена', action: 'Включить', danger: false },
            { label: 'Пароль', value: 'Изменить пароль', action: 'Изменить', danger: false },
            { label: 'Сессии', value: '1 активная', action: 'Завершить все', danger: true },
          ].map((item) => (
            <div key={item.label} className="flex items-center justify-between px-6 py-4">
              <div>
                <p className="text-sm text-on-surface">{item.label}</p>
                <p className="text-xs text-on-surface-variant">{item.value}</p>
              </div>
              <button className={`text-xs font-mono px-4 py-2 rounded-xl border transition-colors ${
                item.danger
                  ? 'text-error border-error/20 hover:bg-error/10'
                  : 'text-primary border-primary/20 hover:bg-primary/10'
              }`}>
                {item.action}
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
