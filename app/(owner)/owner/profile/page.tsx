'use client'

import { useAuthStore } from '@/stores/auth.store'

export default function OwnerProfilePage() {
  const { user } = useAuthStore()

  const fields = [
    { label: 'Имя', value: user?.name ?? '—' },
    { label: 'Email', value: user?.email ?? '—' },
    { label: 'Компания', value: user?.organization ?? '—' },
    { label: 'Должность', value: user?.position ?? '—' },
    { label: 'Роль', value: 'Client (Owner)' },
    { label: 'Аккаунт создан', value: user?.createdAt ? new Date(user.createdAt).toLocaleDateString('ru-RU') : '—' },
  ]

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="font-headline text-2xl font-bold text-on-surface">Профиль</h1>
        <p className="text-sm text-on-surface-variant mt-1">Данные вашего аккаунта на платформе AIStart360</p>
      </div>

      {/* Avatar card */}
      <div className="glass-card rounded-2xl p-6 border border-white/[0.06] flex items-center gap-5">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-secondary/30 to-secondary/10 border border-secondary/20 flex items-center justify-center flex-shrink-0">
          <span className="text-2xl font-bold text-secondary">
            {user?.name?.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase() ?? 'OW'}
          </span>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-on-surface">{user?.name ?? 'Client'}</h2>
          <p className="text-sm text-on-surface-variant">{user?.position ?? 'Собственник'} · {user?.organization ?? 'Компания'}</p>
          <span className="mt-2 inline-flex items-center gap-1.5 text-[10px] font-mono bg-secondary/10 text-secondary border border-secondary/20 rounded-full px-2.5 py-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-secondary" />
            Owner
          </span>
        </div>
      </div>

      {/* Info fields */}
      <div className="glass-card rounded-2xl p-5 border border-white/[0.06]">
        <h3 className="text-sm font-semibold text-on-surface mb-4">Данные аккаунта</h3>
        <div className="space-y-3">
          {fields.map((f) => (
            <div key={f.label} className="flex items-center justify-between py-2.5 border-b border-white/[0.04] last:border-0">
              <span className="text-xs font-mono text-on-surface-variant uppercase tracking-wider">{f.label}</span>
              <span className="text-sm text-on-surface">{f.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* GRI link */}
      <div className="glass-card rounded-2xl p-5 border border-white/[0.06]">
        <h3 className="text-sm font-semibold text-on-surface mb-3">Диагностика</h3>
        <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-secondary text-xl">radar</span>
            <div>
              <p className="text-sm text-on-surface">GRI Диагностика</p>
              <p className="text-xs text-on-surface-variant">Март 2026 · Итоговый балл: 4.59/10</p>
            </div>
          </div>
          <a href="/owner/gri" className="text-xs font-medium text-secondary hover:underline">
            Открыть →
          </a>
        </div>
      </div>
    </div>
  )
}
