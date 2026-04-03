import type { Metadata } from 'next'
import Link from 'next/link'
import { SystemHealth } from '@/components/dashboard/SystemHealth'
import { KpiChart } from '@/components/dashboard/KpiChart'
import { WidgetGrid } from '@/components/dashboard/WidgetGrid'
import { getDashboardData } from '@/lib/get-dashboard-data'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import type { AlertCardProps } from '@/components/dashboard/AlertCard'

export const metadata: Metadata = { title: 'Дэшборд' }

export default async function DashboardPage() {
  const session = await auth()
  const data = getDashboardData(session?.user?.email)

  const userOrgId = (session?.user as any)?.orgId

  // ── Real data from DB ──────────────────────────────────────────
  const [financialSnap, dbClient] = await Promise.all([
    // Latest financial snapshot for this org (or any org as fallback)
    userOrgId
      ? prisma.financialSnapshot.findFirst({ where: { orgId: userOrgId }, orderBy: { recordedAt: 'desc' } })
          .then(r => r ?? prisma.financialSnapshot.findFirst({ orderBy: { recordedAt: 'desc' } }))
      : prisma.financialSnapshot.findFirst({ orderBy: { recordedAt: 'desc' } }),
    // GRI data from latest report
    userOrgId
      ? prisma.client.findFirst({
          where: { orgId: userOrgId },
          include: { griReports: { orderBy: { calculatedAt: 'desc' }, take: 1 } }
        })
      : null,
  ])

  // KPI cards — prefer real DB data, fall back to mock
  const kpiData = financialSnap ? [
    { label: 'Доход',   value: `₸${financialSnap.revenueKzt.toFixed(1)}М`, trend: `${financialSnap.revenueChange > 0 ? '+' : ''}${financialSnap.revenueChange.toFixed(1)}%`, trendUp: financialSnap.revenueChange >= 0, sublabel: 'vs прошлый квартал',      icon: 'payments',      href: '/analytics' },
    { label: 'Маржа',   value: `${financialSnap.marginPct.toFixed(1)}%`,   trend: `${financialSnap.marginChange > 0 ? '+' : ''}${financialSnap.marginChange.toFixed(1)} пп`, trendUp: financialSnap.marginChange >= 0, sublabel: 'чистая маржинальность', icon: 'percent',       href: '/metrics'   },
    { label: 'Клиенты', value: String(financialSnap.clientsCount),          trend: `${financialSnap.clientsChange > 0 ? '+' : ''}${financialSnap.clientsChange}`,              trendUp: financialSnap.clientsChange >= 0, sublabel: 'активных клиентов',    icon: 'groups',        href: '/clients'   },
    { label: 'Расходы', value: `₸${financialSnap.expensesKzt.toFixed(1)}М`,trend: `${financialSnap.expensesChange > 0 ? '+' : ''}${financialSnap.expensesChange.toFixed(1)}%`,trendUp: financialSnap.expensesChange < 0, sublabel: 'операционные расходы', icon: 'trending_down', href: '/metrics'   },
  ] : data.KPI

  const currentPeriod = financialSnap?.period ?? 'Q1 2026'

  // GRI data
  const dbGriScore = dbClient?.griReports?.[0] ?? null
  const griDomains = dbGriScore ? {
    'Продукт': dbGriScore.productScore,
    'Бизнес-модель': dbGriScore.businessModelScore,
    'Команда': dbGriScore.teamScore,
    'Операции': dbGriScore.operationsScore,
  } : { 'Технологии': 9.8, 'Рынок': 9.2, 'Команда': 8.9, 'Бизнес-модель': 8.8 }

  const griData = Object.entries(griDomains).map(([label, score], i) => {
    const colors = ['#6effc0', '#00e29e', '#47ffb8', '#bcc7de']
    return { label, pct: Math.round((Number(score) / 10) * 100), color: colors[i % colors.length] }
  })

  const metricsData = [
    { name: 'Выручка (ARR)', value: financialSnap ? `₸${(financialSnap.revenueKzt * 12).toFixed(0)}М` : '$2.4B', up: true  as boolean | null },
    { name: 'R&D Бюджет',    value: '35%',   up: null  as boolean | null },
    { name: 'Доля рынка',    value: '68%',   up: true  as boolean | null },
    { name: 'NPS (B2B)',     value: '91',    up: true  as boolean | null },
  ]

  return (
    <div className="space-y-6">

      {/* ─── Hero + KPIs + Chart ──────────────────────────────── */}
      <section>
        <div className="mb-5">
          <p className="text-[11px] font-mono text-primary/60 uppercase tracking-[0.2em] mb-2">
            {currentPeriod.replace('-', ' ')} · Текущий период
          </p>
          <h1 className="font-headline text-3xl lg:text-4xl font-extrabold text-on-surface leading-tight">
            Финансовый{' '}
            <span className="text-gradient">Обзор</span>
          </h1>
          <p className="text-on-surface-variant mt-2 text-sm max-w-md leading-relaxed">
            Ключевые показатели компании в реальном времени.
          </p>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
          {/* KPI 2×2 */}
          <div className="xl:col-span-2 grid grid-cols-2 gap-3 content-start">
            {kpiData.map((kpi) => (
              <Link
                key={kpi.label}
                href={kpi.href}
                className={`
                  relative bg-surface-container-low rounded-2xl p-5 overflow-hidden
                  border border-white/[0.04] hover:border-primary/20
                  transition-all duration-200 group cursor-pointer
                  ${!kpi.trendUp ? 'hover:border-error/20' : ''}
                `}
              >
                <div className={`
                  absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none rounded-2xl
                  ${kpi.trendUp
                    ? 'bg-gradient-to-br from-primary/[0.05] to-transparent'
                    : 'bg-gradient-to-br from-error/[0.05] to-transparent'}
                `} />
                <div className="flex items-start justify-between mb-3">
                  <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">
                    {kpi.label}
                  </p>
                  <span className={`material-symbols-outlined text-base opacity-30 group-hover:opacity-60 transition-opacity ${kpi.trendUp ? 'text-primary' : 'text-error'}`}>
                    {kpi.icon}
                  </span>
                </div>
                <h3 className="text-2xl font-mono font-bold leading-none mb-2.5 text-on-surface">
                  {kpi.value}
                </h3>
                <div className="flex items-center gap-1.5">
                  <span className={`material-symbols-outlined text-sm ${kpi.trendUp ? 'text-primary' : 'text-error'}`}>
                    {kpi.trendUp ? 'trending_up' : 'trending_down'}
                  </span>
                  <span className={`text-xs font-mono font-bold ${kpi.trendUp ? 'text-primary' : 'text-error'}`}>
                    {kpi.trend}
                  </span>
                  <span className="text-[10px] text-on-surface-variant/60 ml-0.5">{kpi.sublabel}</span>
                </div>
                <span className="material-symbols-outlined text-sm absolute bottom-4 right-4 opacity-0 group-hover:opacity-30 transition-opacity text-on-surface-variant">
                  arrow_forward
                </span>
              </Link>
            ))}
          </div>

          {/* Interactive chart */}
          <div className="xl:col-span-3">
            <KpiChart />
          </div>
        </div>
      </section>

      {/* ─── System Health ────────────────────────────────────── */}
      <SystemHealth />

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
