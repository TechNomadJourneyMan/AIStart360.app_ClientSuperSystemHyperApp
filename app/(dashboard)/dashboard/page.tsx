import type { Metadata } from 'next'
import Link from 'next/link'
import { KpiCardsGrid } from '@/components/dashboard/KpiCardsGrid'
import { GriDiagramWidget } from '@/components/dashboard/GriDiagramWidget'
import { GoalsBar } from '@/components/dashboard/GoalsBar'
import { WidgetGrid } from '@/components/dashboard/WidgetGrid'
import { getDashboardData } from '@/lib/get-dashboard-data'
import { auth } from '@/lib/auth'
import { createServerClient } from '@/lib/supabase-server'
import type { AlertCardProps } from '@/components/dashboard/AlertCard'

export const metadata: Metadata = { title: 'Дэшборд' }

export default async function DashboardPage() {
  const session = await auth()
  const data = getDashboardData(session?.user?.email)

  // ── Real data from Supabase ────────────────────────────────────
  let financialSnap: Record<string, unknown> | null = null
  try {
    const supabase = createServerClient()
    const { data: snap } = await supabase
      .from('financial_snapshots')
      .select('*')
      .order('recorded_at', { ascending: false })
      .limit(1)
      .single()
    financialSnap = snap ?? null
  } catch {
    // fall through to mock
  }

  // Средний чек = revenue / clients (guard against zero)
  const avgCheckVal =
    financialSnap && Number(financialSnap.clients_count) > 0
      ? Number(financialSnap.revenue_kzt) / Number(financialSnap.clients_count)
      : null

  const kpiData = financialSnap
    ? [
        { label: 'Доход',       value: `₸${Number(financialSnap.revenue_kzt).toFixed(1)}М`,  trend: `${Number(financialSnap.revenue_change) > 0 ? '+' : ''}${Number(financialSnap.revenue_change).toFixed(1)}%`,  trendUp: Number(financialSnap.revenue_change) >= 0,  sublabel: 'vs прошлый квартал',    icon: 'payments',     href: '/analytics', numericValue: Number(financialSnap.revenue_kzt),   goalCategory: 'revenue'   },
        { label: 'Маржа',       value: `${Number(financialSnap.margin_pct).toFixed(1)}%`,     trend: `${Number(financialSnap.margin_change) > 0 ? '+' : ''}${Number(financialSnap.margin_change).toFixed(1)} пп`,  trendUp: Number(financialSnap.margin_change) >= 0,   sublabel: 'чистая маржинальность', icon: 'percent',      href: '/metrics',   numericValue: Number(financialSnap.margin_pct),    goalCategory: 'margin'    },
        { label: 'Клиенты',     value: String(financialSnap.clients_count),                   trend: `${Number(financialSnap.clients_change) > 0 ? '+' : ''}${financialSnap.clients_change}`,                      trendUp: Number(financialSnap.clients_change) >= 0,  sublabel: 'активных клиентов',     icon: 'groups',       href: '/clients',   numericValue: Number(financialSnap.clients_count), goalCategory: 'clients'   },
        { label: 'Средний чек', value: avgCheckVal ? `₸${avgCheckVal.toFixed(2)}М` : '—',    trend: '—', trendUp: true, sublabel: 'на клиента',                                                                                                                              icon: 'receipt_long', href: '/metrics',   numericValue: avgCheckVal ?? 0,                    goalCategory: 'avg_check' },
      ]
    : data.KPI

  const currentPeriod = (financialSnap?.period as string) ?? 'Q1 2026'

  // GRI data — all 7 domains (from mock until gri_reports added to Supabase)
  const dbGriScore = null
  const griDomains = [
    { label: 'Продукт и спрос',           score: 4.7 },
    { label: 'Доверие и позиционирование',score: 5.2 },
    { label: 'Бизнес-модель',             score: 7.4 },
    { label: 'Финансовая устойчивость',   score: 5.0 },
    { label: 'Операции',                  score: 2.1 },
    { label: 'Команда',                   score: 2.5 },
    { label: 'Готовность основателя',     score: 6.7 },
  ]

  const griTotalScore = griDomains.reduce((s, d) => s + d.score, 0) / griDomains.length

  const griData = griDomains.map(({ label, score }, i) => {
    const colors = ['#6effc0', '#00e29e', '#47ffb8', '#bcc7de']
    return { label, pct: Math.round((score / 10) * 100), color: colors[i % colors.length] }
  })

  const metricsData = [
    { name: 'Выручка (ARR)', value: financialSnap ? `₸${(Number(financialSnap.revenue_kzt) * 12).toFixed(0)}М` : '$2.4B', up: true  as boolean | null },
    { name: 'R&D Бюджет',    value: '35%',   up: null  as boolean | null },
    { name: 'Доля рынка',    value: '68%',   up: true  as boolean | null },
    { name: 'NPS (B2B)',     value: '91',    up: true  as boolean | null },
  ]

  return (
    <div className="space-y-6">

      {/* ─── Hero ─────────────────────────────────────────────── */}
      <section>
        <div className="mb-4">
          <p className="text-[11px] font-mono text-primary/60 uppercase tracking-[0.2em] mb-2">
            {currentPeriod.replace('-', ' ')} · Текущий период
          </p>
          <h1 className="font-headline text-3xl lg:text-4xl font-extrabold text-on-surface leading-tight">
            Ускоряем рост бизнеса до{' '}
            <span className="text-gradient">$2M в год</span>
          </h1>
          <p className="text-on-surface-variant mt-2 text-sm max-w-xl leading-relaxed lg:line-clamp-2">
            Система выхода на стабильную скорость роста $2M/год на основе AI-трансформации и сопровождения топ-экспертов
          </p>
        </div>

        {/* Goals bar */}
        <div className="mb-5">
          <GoalsBar />
        </div>

        {/* KPIs + GRI diagram */}
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
          {/* KPI 2×2 — click opens chart modal */}
          <div className="xl:col-span-2">
            <KpiCardsGrid />
          </div>

          {/* GRI Diagram Widget */}
          <div className="xl:col-span-3">
            <GriDiagramWidget
              domains={griDomains}
              totalScore={griTotalScore}
              orgName="Demo Company KZ"
            />
          </div>
        </div>
      </section>

      {/* ─── Customizable Widget Grid ─────────────────────────── */}
      <WidgetGrid
        alerts={data.ALERTS as AlertCardProps[]}
        activity={data.ACTIVITY}
        gri={griData}
        metrics={metricsData}
        criticalCount={data.ALERTS.filter((a: any) => a.severity === 'critical').length}
        userId={session?.user?.email ?? undefined}
      />

      {/* ─── Platform + GTM ───────────────────────────────────── */}
      <section>
        <div className="flex items-end justify-between border-b border-outline-variant/10 pb-4 mb-5">
          <div>
            <h2 className="font-headline text-base font-bold text-on-surface">О платформе AIStart360</h2>
            <p className="text-[11px] text-on-surface-variant mt-1">Система акселерации бизнеса до $2M ARR</p>
          </div>
          <div className="flex items-center gap-3">
            <a href="https://aistart360.app" target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs font-mono text-primary hover:underline">
              <span className="material-symbols-outlined text-sm">open_in_new</span>
              aistart360.app
            </a>
            <a href="https://in.aistart360.app" target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs font-mono text-secondary hover:underline">
              <span className="material-symbols-outlined text-sm">cell_tower</span>
              GRI Pulse
            </a>
          </div>
        </div>

        <div className="relative rounded-2xl overflow-hidden border border-primary/15 bg-gradient-to-r from-primary/[0.08] via-primary/[0.04] to-transparent p-6 mb-5">
          <div className="absolute right-6 top-1/2 -translate-y-1/2 opacity-[0.07]">
            <span className="material-symbols-outlined text-[88px] text-primary">rocket_launch</span>
          </div>
          <p className="text-[10px] font-mono text-primary/60 uppercase tracking-[0.2em] mb-2">Миссия платформы</p>
          <h3 className="font-headline text-xl font-bold text-on-surface mb-2 max-w-xl">
            Стабильный рост до $2M/год на основе AI-трансформации и экспертной поддержки
          </h3>
          <p className="text-sm text-on-surface-variant max-w-2xl">
            AIStart360 помогает B2B-компаниям систематизировать рост — от операционного хаоса к масштабируемой системе.
          </p>
          <div className="flex gap-6 mt-5">
            {[
              { label: 'CAC Payback',    value: '1–2 мес' },
              { label: 'MoM Growth',     value: '≥15%'    },
              { label: 'LTV/CAC',        value: 'x3+'     },
              { label: 'Repeat Revenue', value: '40–60%'  },
            ].map(s => (
              <div key={s.label}>
                <p className="text-lg font-mono font-bold text-primary">{s.value}</p>
                <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">{s.label}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="mb-5">
          <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-4">8-Блочный GTM-Фреймворк</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { n: '01', label: 'Рынок и тренды',        icon: 'public',                  href: '/market'    },
              { n: '02', label: 'Персоны клиентов',       icon: 'group',                   href: '/clients'   },
              { n: '03', label: 'Ценностное предложение', icon: 'star',                    href: '/point-a'   },
              { n: '04', label: 'Система офферов',        icon: 'layers',                  href: '/point-b'   },
              { n: '05', label: 'Каналы привлечения',     icon: 'hub',                     href: '/market'    },
              { n: '06', label: 'Воронка продаж',         icon: 'filter_alt',              href: '/analytics' },
              { n: '07', label: 'Unit-экономика',         icon: 'calculate',               href: '/metrics'   },
              { n: '08', label: 'Команда и операции',     icon: 'precision_manufacturing', href: '/team'      },
            ].map((block) => (
              <Link key={block.n} href={block.href}
                className="bg-surface-container-low rounded-2xl border border-white/[0.04] hover:border-primary/20 p-4 transition-all duration-200 group cursor-pointer hover:bg-surface-container">
                <div className="flex items-start justify-between mb-3">
                  <span className="text-[10px] font-mono text-primary/40">{block.n}</span>
                  <span className="material-symbols-outlined text-base text-on-surface-variant/30 group-hover:text-primary/60 transition-colors">{block.icon}</span>
                </div>
                <p className="text-xs text-on-surface-variant group-hover:text-on-surface transition-colors leading-snug">{block.label}</p>
              </Link>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5">
            <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-4">Программа (12–18 месяцев)</p>
            <div className="space-y-3">
              {[
                { phase: '7 дней',   title: 'Подготовка и онбординг',           icon: 'rocket_launch',  color: 'text-primary'   },
                { phase: '1 день',   title: 'GRI-воркшоп интенсив',             icon: 'radar',          color: 'text-primary'   },
                { phase: '21 день',  title: 'Пилотный запуск + 2 мес поддержки', icon: 'flag',          color: 'text-secondary' },
                { phase: '9–12 мес', title: 'Системное масштабирование',        icon: 'trending_up',    color: 'text-primary'   },
              ].map((p, i) => (
                <div key={i} className="flex items-center gap-4">
                  <div className="flex flex-col items-center flex-shrink-0 w-8">
                    <span className={`material-symbols-outlined text-lg ${p.color}`}>{p.icon}</span>
                    {i < 3 && <div className="w-px h-4 bg-white/[0.06] mt-1" />}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-on-surface">{p.title}</p>
                    <p className="text-[10px] font-mono text-on-surface-variant/60">{p.phase}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5">
            <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-4">Экспертная команда</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { role: 'Growth Manager',       icon: 'person_pin'             },
                { role: 'Финансы & Unit Econ',  icon: 'calculate'              },
                { role: 'Data & Analytics',     icon: 'monitoring'             },
                { role: 'HR & Culture',         icon: 'groups'                 },
                { role: 'AI Training Center',   icon: 'smart_toy'              },
                { role: 'Performance Marketing',icon: 'ads_click'              },
                { role: 'Production',           icon: 'precision_manufacturing'},
                { role: 'Founder Transform',    icon: 'manage_accounts'        },
              ].map((e) => (
                <div key={e.role} className="flex items-center gap-2.5 bg-surface-container rounded-xl p-2.5 border border-white/[0.03] hover:border-white/[0.07] transition-colors">
                  <span className="material-symbols-outlined text-sm text-primary/40">{e.icon}</span>
                  <span className="text-[11px] text-on-surface-variant leading-tight">{e.role}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
