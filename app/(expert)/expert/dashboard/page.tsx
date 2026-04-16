'use client'

import { useAuthStore } from '@/stores/auth.store'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

const EXPERT_KPI = [
  { label: 'GRI Score',      value: '8.4',    delta: '+0.2',    up: true,  icon: 'radar',        color: 'primary' },
  { label: 'Доход (ARR)',    value: '₸28.4М', delta: '+18.2%',  up: true,  icon: 'payments',     color: 'primary' },
  { label: 'Маржа',          value: '38.4%',  delta: '+3.2 пп', up: true,  icon: 'percent',      color: 'primary' },
  { label: 'NPS',            value: '74',     delta: '+6',      up: true,  icon: 'thumb_up',     color: 'primary' },
]

const TASKS = [
  { title: 'Загрузить данные за Q1',       due: '28 Mar 2026', priority: 'high',   done: false },
  { title: 'Пройти GRI-диагностику',       due: '30 Mar 2026', priority: 'high',   done: false },
  { title: 'Согласовать дорожную карту',   due: '02 Apr 2026', priority: 'medium', done: true  },
  { title: 'Ревью отчёта по конкурентам',  due: '05 Apr 2026', priority: 'low',    done: false },
]

const ACTIVITY = [
  { icon: 'description', text: 'Q4 2025 GRI Report загружен',   time: '2 ч назад', type: 'report' },
  { icon: 'edit',        text: 'Обновлены данные профиля',       time: '1 д назад', type: 'update' },
  { icon: 'radar',       text: 'GRI пересчитан: 8.4 (+0.2)',     time: '3 д назад', type: 'gri'    },
  { icon: 'chat',        text: 'Новый комментарий от менеджера', time: '5 д назад', type: 'msg'    },
]

const PRIORITY_COLORS = {
  high:   'text-error bg-error/10 border-error/20',
  medium: 'text-tertiary-container bg-tertiary-container/10 border-tertiary-container/20',
  low:    'text-on-surface-variant bg-surface-container border-white/[0.06]',
}

export default function ExpertDashboardPage() {
  const { user, isInitialized } = useAuthStore()
  const router = useRouter()

  useEffect(() => {
    if (isInitialized && !user) router.replace('/login')
  }, [user, isInitialized, router])

  if (!isInitialized) {
    return <DashboardSkeleton />
  }

  const initials = user?.name?.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase() ?? 'EX'

  return (
    <div className="space-y-8">
      {/* Welcome hero */}
      <section className="flex flex-col md:flex-row justify-between items-start gap-6">
        <div>
          <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">
            Expert Portal · Q1 2026
          </p>
          <h1 className="font-headline text-3xl lg:text-4xl font-extrabold text-on-surface leading-tight">
            Добро пожаловать,{' '}
            <span className="text-gradient">{user?.name?.split(' ')[0]}</span>
          </h1>
          <p className="text-on-surface-variant mt-2 text-sm max-w-lg">
            {user?.organization ?? 'Expert'} · {user?.position ?? 'Expert'} · Последнее обновление данных: 3 дня назад
          </p>
        </div>

        {/* Avatar + status */}
        <div className="flex items-center gap-4 bg-surface-container-low rounded-2xl border border-white/[0.04] p-4">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary/30 to-primary/10 border-2 border-primary/20 flex items-center justify-center">
            <span className="text-lg font-headline font-bold text-primary">{initials}</span>
          </div>
          <div>
            <p className="text-sm font-medium text-on-surface">{user?.name}</p>
            <p className="text-xs text-on-surface-variant">{user?.email}</p>
            <div className="flex items-center gap-1.5 mt-2">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              <span className="text-[10px] font-mono text-primary/70">Эксперт</span>
            </div>
          </div>
        </div>
      </section>

      {/* KPI Cards */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {EXPERT_KPI.map((kpi) => (
          <div key={kpi.label}
            className="bg-surface-container-low rounded-2xl border border-white/[0.04] hover:border-primary/20 p-5 transition-colors group">
            <div className="flex items-start justify-between mb-3">
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">{kpi.label}</p>
              <span className="material-symbols-outlined text-base text-primary/40 group-hover:text-primary/70 transition-colors">{kpi.icon}</span>
            </div>
            <p className="text-2xl font-mono font-bold text-on-surface mb-2">{kpi.value}</p>
            <div className="flex items-center gap-1">
              <span className={`material-symbols-outlined text-xs ${kpi.up ? 'text-primary' : 'text-error'}`}>
                {kpi.up ? 'trending_up' : 'trending_down'}
              </span>
              <span className={`text-xs font-mono ${kpi.up ? 'text-primary' : 'text-error'}`}>{kpi.delta}</span>
            </div>
          </div>
        ))}
      </section>

      {/* GRI Score visual + Tasks */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* GRI Dial */}
        <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6 flex flex-col items-center justify-center">
          <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-6">GRI Score</p>
          <div className="relative w-36 h-36 mb-4">
            <svg viewBox="0 0 160 160" className="w-full h-full -rotate-90">
              <circle cx="80" cy="80" r="64" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
              <circle cx="80" cy="80" r="64" fill="none" stroke="#6effc0" strokeWidth="8" strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 64 * 0.84} ${2 * Math.PI * 64}`} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-mono font-bold text-on-surface">8.4</span>
              <span className="text-[9px] font-mono text-on-surface-variant">/ 10</span>
            </div>
          </div>
          <span className="text-xs font-mono text-primary bg-primary/10 border border-primary/20 px-3 py-1 rounded-full">Strong</span>
          <p className="text-xs text-on-surface-variant mt-3 text-center">Уровень готовности к росту</p>
          <a href="/expert/gri" className="mt-4 text-xs font-mono text-primary hover:underline">Подробный анализ →</a>
        </div>

        {/* Tasks */}
        <div className="lg:col-span-2 bg-surface-container-low rounded-2xl border border-white/[0.04] p-6">
          <div className="flex justify-between items-center mb-5">
            <h2 className="font-headline text-lg font-bold text-on-surface">Задачи</h2>
            <span className="text-xs font-mono text-error bg-error/10 border border-error/20 px-3 py-1 rounded-full">
              {TASKS.filter(t => !t.done).length} активных
            </span>
          </div>
          <div className="space-y-3">
            {TASKS.map((task, i) => (
              <div key={i} className={`flex items-center gap-4 p-3.5 rounded-xl border transition-colors ${
                task.done ? 'opacity-50 border-white/[0.04] bg-surface-container/50' : 'border-white/[0.04] bg-surface-container hover:border-primary/20'
              }`}>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                  task.done ? 'bg-primary border-primary' : 'border-outline'
                }`}>
                  {task.done && <span className="material-symbols-outlined text-[12px] text-on-primary">check</span>}
                </div>
                <p className={`flex-1 text-sm ${task.done ? 'line-through text-on-surface-variant' : 'text-on-surface'}`}>
                  {task.title}
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-on-surface-variant">{task.due}</span>
                  <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-full border ${PRIORITY_COLORS[task.priority as keyof typeof PRIORITY_COLORS]}`}>
                    {task.priority}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Activity */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6">
          <h2 className="font-headline text-lg font-bold text-on-surface mb-5">Последняя активность</h2>
          <div className="space-y-4">
            {ACTIVITY.map((act, i) => (
              <div key={i} className="flex items-center gap-4">
                <div className="w-9 h-9 rounded-xl bg-surface-container flex items-center justify-center flex-shrink-0">
                  <span className="material-symbols-outlined text-base text-on-surface-variant">{act.icon}</span>
                </div>
                <div className="flex-1">
                  <p className="text-sm text-on-surface">{act.text}</p>
                </div>
                <span className="text-[10px] font-mono text-on-surface-variant flex-shrink-0">{act.time}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Quick actions */}
        <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6">
          <h2 className="font-headline text-lg font-bold text-on-surface mb-5">Быстрые действия</h2>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Загрузить данные', icon: 'upload_file',    href: '/expert/reports' },
              { label: 'Смотреть GRI',     icon: 'radar',          href: '/expert/gri'     },
              { label: 'Мой профиль',      icon: 'account_circle', href: '/expert/profile' },
              { label: 'Инсайты',          icon: 'lightbulb',      href: '/expert/insights'},
            ].map((action) => (
              <a key={action.label} href={action.href}
                className="flex flex-col items-center gap-3 p-4 rounded-xl bg-surface-container border border-white/[0.04] hover:border-primary/30 hover:bg-primary/5 transition-all group text-center">
                <span className="material-symbols-outlined text-xl text-on-surface-variant group-hover:text-primary transition-colors">{action.icon}</span>
                <span className="text-xs text-on-surface-variant group-hover:text-on-surface transition-colors">{action.label}</span>
              </a>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

// ── Skeleton loading state ──────────────────────────────────────────────────
// Shown while auth/user data is being fetched. Mirrors the layout of the real
// dashboard so the transition is smooth instead of a jarring "snap-in".

function SkeletonBlock({ className = '' }: { className?: string }) {
  return (
    <div
      className={`animate-pulse bg-gradient-to-r from-surface-container via-surface-container-high to-surface-container bg-[length:200%_100%] rounded-lg ${className}`}
      style={{ animation: 'shimmer 1.6s ease-in-out infinite' }}
    />
  )
}

function DashboardSkeleton() {
  return (
    <>
      <style jsx global>{`
        @keyframes shimmer {
          0%   { background-position: -100% 0; }
          100% { background-position:  100% 0; }
        }
      `}</style>

      <div className="space-y-8">
        {/* Hero */}
        <section className="flex flex-col md:flex-row justify-between items-start gap-6">
          <div className="flex-1 space-y-3">
            <SkeletonBlock className="h-3 w-36" />
            <SkeletonBlock className="h-10 w-80 max-w-full" />
            <SkeletonBlock className="h-3 w-60" />
          </div>
          <div className="flex items-center gap-4 bg-surface-container-low rounded-2xl border border-white/[0.04] p-4 min-w-[240px]">
            <SkeletonBlock className="w-14 h-14 rounded-xl" />
            <div className="flex-1 space-y-2">
              <SkeletonBlock className="h-3 w-24" />
              <SkeletonBlock className="h-2.5 w-32" />
              <SkeletonBlock className="h-2.5 w-16" />
            </div>
          </div>
        </section>

        {/* KPI cards */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5 space-y-3"
            >
              <div className="flex items-start justify-between">
                <SkeletonBlock className="h-2.5 w-16" />
                <SkeletonBlock className="h-4 w-4 rounded" />
              </div>
              <SkeletonBlock className="h-7 w-24" />
              <SkeletonBlock className="h-2.5 w-12" />
            </div>
          ))}
        </section>

        {/* GRI + Tasks */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6 flex flex-col items-center gap-4">
            <SkeletonBlock className="h-2.5 w-20" />
            <SkeletonBlock className="w-36 h-36 rounded-full" />
            <SkeletonBlock className="h-5 w-16 rounded-full" />
            <SkeletonBlock className="h-2.5 w-32" />
          </div>
          <div className="lg:col-span-2 bg-surface-container-low rounded-2xl border border-white/[0.04] p-6 space-y-4">
            <div className="flex justify-between items-center">
              <SkeletonBlock className="h-5 w-20" />
              <SkeletonBlock className="h-5 w-24 rounded-full" />
            </div>
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-4 p-3.5 rounded-xl border border-white/[0.04] bg-surface-container"
              >
                <SkeletonBlock className="w-5 h-5 rounded-full" />
                <SkeletonBlock className="flex-1 h-3" />
                <SkeletonBlock className="h-2.5 w-16" />
                <SkeletonBlock className="h-4 w-12 rounded-full" />
              </div>
            ))}
          </div>
        </section>

        {/* Activity + Quick actions */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6 space-y-4">
            <SkeletonBlock className="h-5 w-40" />
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <SkeletonBlock className="w-9 h-9 rounded-xl" />
                <SkeletonBlock className="flex-1 h-3" />
                <SkeletonBlock className="h-2.5 w-14" />
              </div>
            ))}
          </div>
          <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6 space-y-4">
            <SkeletonBlock className="h-5 w-32" />
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="flex flex-col items-center gap-3 p-4 rounded-xl bg-surface-container border border-white/[0.04]"
                >
                  <SkeletonBlock className="h-5 w-5 rounded" />
                  <SkeletonBlock className="h-2.5 w-20" />
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </>
  )
}
