'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { SystemHealth } from '@/components/dashboard/SystemHealth'
import { PendingClientsTable } from '@/components/dashboard/admin/PendingClientsTable'
import { AdminClientsList } from '@/components/dashboard/admin/AdminClientsList'

// Navigation cards — counts are filled from live data (sectionCounts), never hardcoded.
const CONTENT_SECTIONS = [
  { label: 'GRI-диагностика', href: '/gri',        icon: 'radar',           color: 'primary',   desc: 'Воркшопы и анализ по 7 блокам',     unit: 'оценок'      },
  { label: 'Рынок',           href: '/market',      icon: 'public',          color: 'primary',   desc: 'Рыночные исследования и тренды',     unit: 'срезов'      },
  { label: 'Метрики',         href: '/metrics',     icon: 'monitoring',      color: 'secondary', desc: 'KPI-система роста',                  unit: 'метрик'      },
  { label: 'Аналитика',       href: '/analytics',   icon: 'bar_chart',       color: 'primary',   desc: 'Финансовая аналитика и тренды',      unit: ''            },
  { label: 'Точка А',         href: '/point-a',     icon: 'my_location',     color: 'primary',   desc: 'Диагностика текущего состояния',     unit: 'диагностик' },
  { label: 'Точка Б',         href: '/point-b',     icon: 'flag',            color: 'secondary', desc: 'Целевые показатели и дорожные карты', unit: 'планов'     },
  { label: 'Инсайты',         href: '/insights',    icon: 'lightbulb',       color: 'primary',   desc: 'AI-инсайты и сигналы по платформе',  unit: 'инсайтов'   },
  { label: 'Конкуренты',      href: '/competitors', icon: 'compare_arrows',  color: 'secondary', desc: 'Конкурентная разведка по клиентам',  unit: ''            },
  { label: 'Отчёты',          href: '/reports',     icon: 'description',     color: 'primary',   desc: 'Загруженные документы и отчёты',     unit: 'файлов'     },
  { label: 'Команда',         href: '/team',        icon: 'group',           color: 'secondary', desc: 'Управление командой экспертов',      unit: 'экспертов'  },
  { label: 'Клиенты',         href: '/clients',     icon: 'business_center', color: 'primary',   desc: 'Полная база клиентов платформы',     unit: 'компаний'   },
  { label: 'Пользователи',    href: '/users',       icon: 'manage_accounts', color: 'primary',   desc: 'Управление доступами и ролями',      unit: 'аккаунтов'  },
]

interface OverviewData {
  stats: {
    clients: number; experts: number; admins: number; owners: number
    totalUsers: number; companies: number; diagnostics: number
    griAssessments: number; griAvg: number | null
    documents: number; metrics: number; marketSnapshots: number
    pointB: number; pointAInsights: number; pendingRequests: number
  }
  sectionCounts: Record<string, number>
  griDistribution: { label: string; count: number; pct: number; color: string }[]
  requestsByStatus: Record<string, number>
  activity: { icon: string; title: string; event: string; time: string; color: string }[]
}

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState('overview')
  const [data, setData] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/admin/overview', { cache: 'no-store' })
        const json = (await res.json()) as { ok: boolean; data?: OverviewData; error?: string }
        if (cancelled) return
        if (!res.ok || !json.ok) setError(json.error || `Ошибка ${res.status}`)
        else setData(json.data ?? null)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Ошибка сети')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const s = data?.stats
  const num = (v: number | null | undefined): string => (v == null ? '—' : String(v))
  const sectionCount = (href: string): number | null => data?.sectionCounts?.[href] ?? null

  const STAT_TILES = [
    { label: 'Всего клиентов',   value: num(s?.clients),        sub: `${num(s?.companies)} компаний`,        icon: 'groups',          color: 'text-primary'    },
    { label: 'Сред. GRI Score',  value: s?.griAvg != null ? s.griAvg.toFixed(1) : '—', sub: `${num(s?.griAssessments)} оценок`, icon: 'monitoring', color: 'text-primary' },
    { label: 'Пользователей',    value: num(s?.totalUsers),     sub: `${num(s?.experts)} экспертов`,         icon: 'manage_accounts', color: 'text-on-surface' },
    { label: 'Диагностик',       value: num(s?.diagnostics),    sub: `${num(s?.pendingRequests)} заявок в работе`, icon: 'my_location', color: 'text-primary' },
  ]

  return (
    <div className="space-y-8 min-h-screen pb-20">
      {/* Header with Tab Switcher */}
      <section className="sticky top-0 z-20 bg-surface/80 backdrop-blur-xl -mx-4 px-4 py-4 border-b border-white/5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="font-headline text-2xl font-black text-on-surface tracking-tight uppercase">Platform Command</h1>
            <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-[0.2em] mt-1 opacity-60">
              {loading ? 'Загрузка данных…' : error ? 'Ошибка загрузки' : 'Status: Operational'}
            </p>
          </div>

          <div className="flex bg-surface-container-high p-1 rounded-2xl border border-white/5 self-start">
            <button
              onClick={() => setActiveTab('overview')}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-bold transition-all duration-300 ${
                activeTab === 'overview'
                  ? 'bg-primary text-on-primary shadow-lg shadow-primary/20'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-white/5'
              }`}
            >
              <span className="material-symbols-outlined text-base">dashboard</span>
              ОБЗОР
            </button>
            <button
              onClick={() => setActiveTab('clients')}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-bold transition-all duration-300 ${
                activeTab === 'clients'
                  ? 'bg-primary text-on-primary shadow-lg shadow-primary/20'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-white/5'
              }`}
            >
              <span className="material-symbols-outlined text-base">groups</span>
              КЛИЕНТЫ
            </button>
          </div>
        </div>
      </section>

      {error && (
        <div className="bg-error/[0.05] border border-error/20 rounded-2xl px-5 py-3 text-sm text-error">
          Не удалось загрузить данные обзора: {error}
        </div>
      )}

      <div className="animate-in fade-in transition-all duration-500">
        {activeTab === 'overview' ? (
          <div className="space-y-8">
            {/* Stats Grid — real data */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {STAT_TILES.map((t) => (
                <div key={t.label} className="bg-surface-container-low rounded-2xl border border-white/5 p-4 hover:border-primary/20 transition-all group">
                  <span className={`material-symbols-outlined text-base mb-2 font-light opacity-50 group-hover:opacity-100 ${t.color}`}>{t.icon}</span>
                  <p className={`text-2xl font-mono font-black ${t.color}`}>{loading ? '…' : t.value}</p>
                  <p className="text-[10px] font-mono text-on-surface-variant uppercase mt-1">{t.label}</p>
                  <p className="text-[9px] font-mono text-on-surface-variant/50 mt-0.5">{t.sub}</p>
                </div>
              ))}
            </div>

            <SystemHealth />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                <div className="bg-surface-container-low rounded-3xl border border-white/5 p-6">
                  <div className="flex items-center justify-between mb-8">
                    <h2 className="text-xl font-black text-on-surface tracking-tighter">МОДУЛИ ПЛАТФОРМЫ</h2>
                    <Link href="/clients" className="text-[10px] font-mono text-primary bg-primary/10 px-3 py-1 rounded-full hover:bg-primary/20 transition-colors uppercase font-bold">Base Access ↗</Link>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {CONTENT_SECTIONS.map((sec) => {
                      const c = sectionCount(sec.href)
                      return (
                        <Link key={sec.href} href={sec.href} className="flex flex-col h-full bg-surface-container rounded-2xl border border-white/5 p-4 hover:bg-primary/5 hover:border-primary/30 transition-all group">
                          <span className={`material-symbols-outlined text-xl mb-3 ${sec.color === 'primary' ? 'text-primary' : 'text-secondary'}`}>{sec.icon}</span>
                          <p className="text-xs font-black text-on-surface group-hover:text-primary transition-colors leading-tight">{sec.label.toUpperCase()}</p>
                          <p className="text-[9px] text-on-surface-variant mt-auto opacity-60 font-mono">
                            {c != null ? `${c} ${sec.unit}`.trim() : sec.desc}
                          </p>
                        </Link>
                      )
                    })}
                  </div>
                </div>
              </div>

              <div className="bg-surface-container-low rounded-3xl border border-white/5 p-6">
                <h2 className="text-xl font-black text-on-surface tracking-tighter mb-8 uppercase">Live Intel</h2>
                <div className="space-y-6 relative overflow-hidden">
                  {loading ? (
                    <p className="text-xs text-on-surface-variant/60">Загрузка…</p>
                  ) : (data?.activity?.length ?? 0) === 0 ? (
                    <p className="text-xs text-on-surface-variant/60">Пока нет активности. События появятся после действий в системе.</p>
                  ) : (
                    data!.activity.map((act, i) => (
                      <div key={i} className="flex items-start gap-4 relative z-10">
                        <div className="w-8 h-8 rounded-full bg-surface-container-high flex items-center justify-center flex-shrink-0">
                          <span className={`material-symbols-outlined text-sm ${act.color}`}>{act.icon}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-on-surface truncate">{act.title}</p>
                          <p className="text-[10px] text-on-surface-variant leading-relaxed mt-1">{act.event}</p>
                        </div>
                        <span className="text-[9px] font-mono text-on-surface-variant opacity-40">{act.time}</span>
                      </div>
                    ))
                  )}
                </div>
                <Link href="/users" className="block text-center w-full mt-8 py-3 bg-white/5 hover:bg-white/10 rounded-2xl text-[10px] font-bold text-on-surface-variant tracking-widest transition-all">
                  VIEW ALL ACTIVITY
                </Link>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-10 animate-in slide-in-from-bottom-5 duration-500">
            <section>
              <PendingClientsTable />
            </section>

            <section>
              <div className="bg-surface-container-low rounded-[32px] border border-white/5 p-1 overflow-hidden">
                <div className="px-8 pt-8 pb-4 flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-black text-on-surface tracking-tighter uppercase">База клиентов</h2>
                    <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-[0.2em] mt-1 opacity-60">
                      {num(s?.companies)} компаний · {num(s?.clients)} клиентов
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button className="w-10 h-10 rounded-full bg-surface-container-high border border-white/5 flex items-center justify-center text-on-surface hover:bg-primary hover:text-on-primary transition-all shadow-xl">
                      <span className="material-symbols-outlined text-lg">search</span>
                    </button>
                    <Link href="/users" className="px-6 py-2.5 rounded-full bg-primary text-on-primary text-[10px] font-black tracking-widest shadow-lg shadow-primary/20 hover:scale-[0.98] active:scale-95 transition-all flex items-center">
                      УПРАВЛЕНИЕ ДОСТУПОМ
                    </Link>
                  </div>
                </div>
                <AdminClientsList />
              </div>
            </section>

            <section className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-20">
              <div className="bg-surface-container-low rounded-3xl border border-white/5 p-8">
                <h2 className="text-sm font-black text-on-surface tracking-widest uppercase mb-6 opacity-60 font-mono">Распределение GRI</h2>
                {(data?.griDistribution?.reduce((a, b) => a + b.count, 0) ?? 0) === 0 ? (
                  <p className="text-xs text-on-surface-variant/60">Появится после прохождения клиентами GRI-диагностики.</p>
                ) : (
                  <div className="space-y-4">
                    {data!.griDistribution.map((d) => (
                      <div key={d.label}>
                        <div className="flex justify-between text-[10px] font-mono mb-2 uppercase">
                          <span className="text-on-surface-variant">{d.label}</span>
                          <span className="text-on-surface font-bold">{d.count} · {d.pct}%</span>
                        </div>
                        <div className="h-1 bg-surface-container-high rounded-full overflow-hidden">
                          <div className={`h-full ${d.color} shadow-[0_0_8px_rgba(110,255,192,0.4)]`} style={{ width: `${d.pct}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="bg-surface-container-low rounded-3xl border border-white/5 p-8 flex flex-col justify-center text-center">
                <span className="material-symbols-outlined text-4xl text-primary mb-4 opacity-50">insights</span>
                <h3 className="text-lg font-black text-on-surface leading-tight px-6">Сводка платформы</h3>
                <p className="text-xs text-on-surface-variant mt-4 opacity-70">
                  {num(s?.companies)} компаний · {num(s?.diagnostics)} диагностик · {num(s?.griAssessments)} GRI-оценок
                  {s?.griAvg != null ? ` · средний GRI ${s.griAvg.toFixed(1)}` : ''}
                </p>
                <Link href="/analytics" className="mt-8 text-[10px] font-black text-primary hover:underline uppercase tracking-widest">
                  Открыть аналитику →
                </Link>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
