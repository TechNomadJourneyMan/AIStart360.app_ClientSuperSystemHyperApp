'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

import { useAuthStore } from '@/stores/auth.store'

const UNAVAILABLE_KPI = [
  { label: 'GRI Score', icon: 'radar' },
  { label: 'Доход (ARR)', icon: 'payments' },
  { label: 'Маржа', icon: 'percent' },
  { label: 'NPS', icon: 'thumb_up' },
]

const QUICK_ACTIONS = [
  { label: 'Отчёты', icon: 'description', href: '/expert/reports' },
  { label: 'GRI', icon: 'radar', href: '/expert/gri' },
  { label: 'Мой профиль', icon: 'account_circle', href: '/expert/profile' },
  { label: 'Инсайты', icon: 'lightbulb', href: '/expert/insights' },
]

export default function ExpertDashboardPage() {
  const { user, isInitialized } = useAuthStore()
  const router = useRouter()

  useEffect(() => {
    if (isInitialized && !user) router.replace('/login')
  }, [user, isInitialized, router])

  if (!isInitialized) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
      </div>
    )
  }

  if (!user) return null

  const initials =
    user.name
      ?.split(' ')
      .map((namePart) => namePart[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() ?? 'EX'

  return (
    <div className="space-y-8">
      <section className="flex flex-col items-start justify-between gap-6 md:flex-row">
        <div>
          <p className="mb-3 text-xs font-mono uppercase tracking-[0.2em] text-primary/70">
            Expert Portal
          </p>
          <h1 className="font-headline text-3xl font-extrabold leading-tight text-on-surface lg:text-4xl">
            Добро пожаловать,{' '}
            <span className="text-gradient">{user.name?.split(' ')[0] ?? 'эксперт'}</span>
          </h1>
          <p className="mt-2 max-w-lg text-sm text-on-surface-variant">
            {[user.organization, user.position].filter(Boolean).join(' · ') || 'Профиль эксперта'}
          </p>
        </div>

        <div className="flex max-w-full items-center gap-4 rounded-2xl border border-white/[0.04] bg-surface-container-low p-4">
          <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-xl border-2 border-primary/20 bg-gradient-to-br from-primary/30 to-primary/10">
            <span className="font-headline text-lg font-bold text-primary">{initials}</span>
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-on-surface">{user.name ?? 'Эксперт'}</p>
            <p className="truncate text-xs text-on-surface-variant">{user.email ?? 'Email не указан'}</p>
            <p className="mt-2 text-[10px] font-mono text-primary/70">Эксперт</p>
          </div>
        </div>
      </section>

      <div
        id="expert-dashboard-data-status"
        role="status"
        className="flex items-start gap-3 rounded-2xl border border-tertiary-container/25 bg-tertiary-container/5 px-4 py-3"
      >
        <span className="material-symbols-outlined mt-0.5 text-lg text-tertiary-container">
          database_off
        </span>
        <div>
          <p className="text-sm font-medium text-on-surface">Аналитические данные не подключены</p>
          <p className="mt-1 text-xs text-on-surface-variant">
            KPI, GRI, задачи и журнал активности появятся после подключения источника данных.
            До этого значения не подменяются демонстрационными примерами.
          </p>
        </div>
      </div>

      <section aria-labelledby="expert-kpi-title">
        <h2 id="expert-kpi-title" className="sr-only">
          Ключевые показатели
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {UNAVAILABLE_KPI.map((kpi) => (
            <div
              key={kpi.label}
              aria-describedby="expert-dashboard-data-status"
              className="rounded-2xl border border-white/[0.04] bg-surface-container-low p-5"
            >
              <div className="mb-3 flex items-start justify-between gap-2">
                <p className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant">
                  {kpi.label}
                </p>
                <span className="material-symbols-outlined text-base text-on-surface-variant/40">
                  {kpi.icon}
                </span>
              </div>
              <p className="mb-1 text-2xl font-mono font-bold text-on-surface">—</p>
              <p className="text-[10px] text-on-surface-variant">Нет данных</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col items-center justify-center rounded-2xl border border-white/[0.04] bg-surface-container-low p-6 text-center">
          <p className="mb-6 text-[10px] font-mono uppercase tracking-widest text-on-surface-variant">
            GRI Score
          </p>
          <div className="mb-4 flex h-36 w-36 items-center justify-center rounded-full border-8 border-white/[0.06]">
            <span className="text-3xl font-mono font-bold text-on-surface-variant">—</span>
          </div>
          <p className="text-xs text-on-surface-variant">Расчёт ещё не подключён</p>
          <Link href="/expert/gri" className="mt-4 text-xs font-mono text-primary hover:underline">
            О статусе GRI →
          </Link>
        </div>

        <div className="rounded-2xl border border-white/[0.04] bg-surface-container-low p-6 lg:col-span-2">
          <h2 className="font-headline text-lg font-bold text-on-surface">Задачи</h2>
          <div className="flex min-h-52 flex-col items-center justify-center px-4 py-8 text-center">
            <span className="material-symbols-outlined mb-3 text-4xl text-on-surface-variant/20">
              task_alt
            </span>
            <p className="text-sm font-medium text-on-surface">Список задач не подключён</p>
            <p className="mt-1 max-w-sm text-xs text-on-surface-variant">
              Здесь будут отображаться только задачи из рабочего источника.
            </p>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/[0.04] bg-surface-container-low p-6">
          <h2 className="font-headline text-lg font-bold text-on-surface">Последняя активность</h2>
          <div className="flex min-h-44 flex-col items-center justify-center px-4 py-8 text-center">
            <span className="material-symbols-outlined mb-3 text-4xl text-on-surface-variant/20">
              history
            </span>
            <p className="text-sm font-medium text-on-surface">История пока недоступна</p>
            <p className="mt-1 text-xs text-on-surface-variant">
              События появятся после подключения журнала активности.
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-white/[0.04] bg-surface-container-low p-6">
          <h2 className="mb-5 font-headline text-lg font-bold text-on-surface">Разделы</h2>
          <div className="grid grid-cols-2 gap-3">
            {QUICK_ACTIONS.map((action) => (
              <Link
                key={action.label}
                href={action.href}
                className="group flex flex-col items-center gap-3 rounded-xl border border-white/[0.04] bg-surface-container p-4 text-center transition-all hover:border-primary/30 hover:bg-primary/5"
              >
                <span className="material-symbols-outlined text-xl text-on-surface-variant transition-colors group-hover:text-primary">
                  {action.icon}
                </span>
                <span className="text-xs text-on-surface-variant transition-colors group-hover:text-on-surface">
                  {action.label}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
