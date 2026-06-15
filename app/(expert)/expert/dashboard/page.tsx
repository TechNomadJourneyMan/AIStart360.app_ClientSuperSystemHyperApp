'use client'

// Expert dashboard — real-data version.
// Pulls /api/expert/clients + aggregates to show live KPIs (total clients,
// comments written, avg GRI, clients needing attention) + recent activity
// derived from the clients list. No hardcoded demo constants — if data is
// empty, shows honest empty state rather than fake 8.4 / ₸28.4М / fake tasks.

import { useAuthStore } from '@/stores/auth.store'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

interface ExpertClient {
  id: string
  fullName: string | null
  email: string | null
  companyName: string | null
  industry: string | null
  stage: string | null
  overallScore: number | null
  healthIndex: number | null
  commentsCount: number
  calculatedAt: string | null
  createdAt: string | null
}

export default function ExpertDashboardPage() {
  const { user, isInitialized } = useAuthStore()
  const router = useRouter()

  const [clients, setClients] = useState<ExpertClient[]>([])
  const [loadingClients, setLoadingClients] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isInitialized && !user) router.replace('/login')
  }, [user, isInitialized, router])

  useEffect(() => {
    if (!isInitialized || !user) return
    let cancelled = false
    ;(async () => {
      setLoadingClients(true)
      try {
        const res = await fetch('/api/expert/clients')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as { data?: ExpertClient[] }
        if (!cancelled) setClients(json.data ?? [])
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Ошибка')
      } finally {
        if (!cancelled) setLoadingClients(false)
      }
    })()
    return () => { cancelled = true }
  }, [isInitialized, user])

  // ── Derived aggregates ────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total = clients.length
    const totalComments = clients.reduce((s, c) => s + (c.commentsCount ?? 0), 0)
    const withScore = clients.filter((c) => typeof c.overallScore === 'number')
    const avgScore =
      withScore.length > 0
        ? withScore.reduce((s, c) => s + (c.overallScore ?? 0), 0) / withScore.length
        : null
    const attention = clients.filter(
      (c) => typeof c.overallScore === 'number' && (c.overallScore ?? 0) < 40,
    ).length
    return { total, totalComments, avgScore, attention }
  }, [clients])

  const recentlyActive = useMemo(() => {
    return [...clients]
      .sort((a, b) => {
        const aT = new Date(a.calculatedAt ?? a.createdAt ?? 0).getTime()
        const bT = new Date(b.calculatedAt ?? b.createdAt ?? 0).getTime()
        return bT - aT
      })
      .slice(0, 5)
  }, [clients])

  if (!isInitialized) {
    return <DashboardSkeleton />
  }

  const initials = user?.name?.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() ?? 'EX'

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="flex flex-col md:flex-row justify-between items-start gap-6">
        <div>
          <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">
            Expert Portal
          </p>
          <h1 className="font-headline text-3xl lg:text-4xl font-extrabold text-on-surface leading-tight">
            Добро пожаловать,{' '}
            <span className="text-gradient">{user?.name?.split(' ')[0]}</span>
          </h1>
          <p className="text-on-surface-variant mt-2 text-sm max-w-lg">
            {user?.organization ?? 'Expert'} · {user?.position ?? 'Expert'}
          </p>
        </div>

        <div className="flex items-center gap-4 bg-surface-container-low rounded-2xl border border-white/[0.04] p-4">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary/30 to-primary/10 border-2 border-primary/20 flex items-center justify-center">
            <span className="text-lg font-headline font-bold text-primary">{initials}</span>
          </div>
          <div>
            <p className="text-sm font-medium text-on-surface">{user?.name}</p>
            <p className="text-xs text-on-surface-variant">{user?.email}</p>
            <div className="flex items-center gap-1.5 mt-2">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              <span className="text-[10px] font-mono text-primary/70">Эксперт онлайн</span>
            </div>
          </div>
        </div>
      </section>

      {/* KPI Cards — real data */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Всего клиентов"
          value={stats.total.toString()}
          icon="business_center"
          loading={loadingClients}
          href="/expert/clients"
        />
        <KpiCard
          label="Средний GRI"
          value={stats.avgScore !== null ? stats.avgScore.toFixed(1) : '—'}
          icon="radar"
          subtitle={stats.avgScore === null ? 'нет оценок' : `по ${clients.filter(c => typeof c.overallScore === 'number').length} клиентам`}
          loading={loadingClients}
        />
        <KpiCard
          label="Мои комментарии"
          value={stats.totalComments.toString()}
          icon="forum"
          subtitle={stats.totalComments === 0 ? 'пока не оставлено' : 'по всем клиентам'}
          loading={loadingClients}
        />
        <KpiCard
          label="Требуют внимания"
          value={stats.attention.toString()}
          icon="warning"
          subtitle="GRI < 40"
          tone={stats.attention > 0 ? 'error' : 'default'}
          loading={loadingClients}
        />
      </section>

      {/* Recent clients */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-surface-container-low rounded-2xl border border-white/[0.04] p-6">
          <div className="flex justify-between items-center mb-5">
            <h2 className="font-headline text-lg font-bold text-on-surface">Недавние клиенты</h2>
            <Link
              href="/expert/clients"
              className="text-xs text-primary hover:underline inline-flex items-center gap-1"
            >
              Все клиенты
              <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
            </Link>
          </div>

          {loadingClients ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-16 rounded-xl bg-surface-container animate-pulse" />
              ))}
            </div>
          ) : error ? (
            <div className="rounded-xl bg-error/5 border border-error/20 p-4 text-sm text-error">
              Ошибка загрузки клиентов: {error}
            </div>
          ) : recentlyActive.length === 0 ? (
            <div className="rounded-xl border border-white/[0.04] border-dashed py-12 text-center">
              <span className="material-symbols-outlined text-3xl text-on-surface-variant/40 mb-2">
                person_off
              </span>
              <p className="text-sm text-on-surface-variant">
                Пока нет ни одного клиента
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {recentlyActive.map((c) => (
                <Link
                  key={c.id}
                  href={`/expert/clients/${c.id}`}
                  className="flex items-center gap-3 p-3 rounded-xl border border-white/[0.04] bg-surface-container hover:border-primary/20 hover:bg-primary/5 transition-all"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-on-surface truncate">
                      {c.companyName ?? c.fullName ?? c.email ?? 'Клиент'}
                    </p>
                    <p className="text-xs text-on-surface-variant truncate">
                      {c.industry || 'нет данных'}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {typeof c.overallScore === 'number' && (
                      <div className="text-right">
                        <p className="text-sm font-mono font-bold text-on-surface leading-none">
                          {c.overallScore.toFixed(0)}
                        </p>
                        <p className="text-[10px] text-on-surface-variant">GRI</p>
                      </div>
                    )}
                    {c.commentsCount > 0 && (
                      <span className="text-[10px] font-mono text-primary bg-primary/10 border border-primary/20 px-2 py-1 rounded-full inline-flex items-center gap-1">
                        <span className="material-symbols-outlined text-[11px]">forum</span>
                        {c.commentsCount}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6">
          <h2 className="font-headline text-lg font-bold text-on-surface mb-5">Быстрые действия</h2>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Клиенты',      icon: 'business_center', href: '/expert/clients' },
              { label: 'GRI',          icon: 'radar',           href: '/expert/gri' },
              { label: 'Мой профиль',  icon: 'account_circle',  href: '/expert/profile' },
              { label: 'Инсайты',      icon: 'lightbulb',       href: '/expert/insights' },
            ].map((action) => (
              <Link
                key={action.label}
                href={action.href}
                className="flex flex-col items-center gap-3 p-4 rounded-xl bg-surface-container border border-white/[0.04] hover:border-primary/30 hover:bg-primary/5 transition-all text-center"
              >
                <span className="material-symbols-outlined text-xl text-on-surface-variant">
                  {action.icon}
                </span>
                <span className="text-xs text-on-surface-variant">{action.label}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string
  value: string
  icon: string
  subtitle?: string
  tone?: 'default' | 'error'
  loading?: boolean
  href?: string
}

function KpiCard({ label, value, icon, subtitle, tone = 'default', loading, href }: KpiCardProps) {
  const valueClass = tone === 'error' ? 'text-error' : 'text-on-surface'
  const body = (
    <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] hover:border-primary/20 p-5 transition-colors group h-full">
      <div className="flex items-start justify-between mb-3">
        <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">{label}</p>
        <span className="material-symbols-outlined text-base text-primary/40 group-hover:text-primary/70 transition-colors">
          {icon}
        </span>
      </div>
      {loading ? (
        <div className="h-7 w-20 bg-surface-container animate-pulse rounded" />
      ) : (
        <p className={`text-2xl font-mono font-bold ${valueClass}`}>{value}</p>
      )}
      {subtitle && !loading && (
        <p className="text-[10px] text-on-surface-variant mt-1">{subtitle}</p>
      )}
    </div>
  )
  return href ? <Link href={href}>{body}</Link> : body
}

// ── Skeleton loading state ──────────────────────────────────────────────────

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
            </div>
          </div>
        </section>
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5 space-y-3">
              <SkeletonBlock className="h-2.5 w-16" />
              <SkeletonBlock className="h-7 w-24" />
            </div>
          ))}
        </section>
      </div>
    </>
  )
}
