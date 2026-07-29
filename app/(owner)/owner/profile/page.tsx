'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuthStore } from '@/stores/auth.store'

interface GriCurrent {
  gri_index?: number
  created_at?: string
}

export default function OwnerProfilePage() {
  const { user } = useAuthStore()
  const [gri, setGri] = useState<GriCurrent | null>(null)
  const [griLoading, setGriLoading] = useState(true)

  // Same source as the owner dashboard — no hardcoded score here.
  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const res = await fetch('/api/v1/gri/assessment', { credentials: 'include' })
        const j = await res.json()
        if (active) setGri(j?.data?.current ?? null)
      } catch {
        if (active) setGri(null)
      } finally {
        if (active) setGriLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const griScore = typeof gri?.gri_index === 'number' ? gri.gri_index : 0
  const hasAssessment = griScore > 0
  const griDate = gri?.created_at
    ? new Date(gri.created_at).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
    : null

  const fields = [
    { label: 'Имя', value: user?.name ?? '—' },
    { label: 'Email', value: user?.email ?? '—' },
    { label: 'Компания', value: user?.organization ?? '—' },
    { label: 'Должность', value: user?.position ?? '—' },
    { label: 'Роль', value: 'Клиент (Owner)' },
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
          <h2 className="text-lg font-semibold text-on-surface">{user?.name ?? 'Клиент'}</h2>
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
              <p className="text-xs text-on-surface-variant">
                {griLoading
                  ? 'Загрузка…'
                  : hasAssessment
                    ? `${griDate ? griDate + ' · ' : ''}Итоговый балл: ${griScore}/10`
                    : 'Диагностика ещё не пройдена'}
              </p>
            </div>
          </div>
          <Link href="/owner/gri" className="text-xs font-medium text-secondary hover:underline">
            {hasAssessment ? 'Открыть →' : 'Пройти →'}
          </Link>
        </div>
      </div>
    </div>
  )
}
