import type { Metadata } from 'next'
import Link from 'next/link'
import { AlertCard } from '@/components/dashboard/AlertCard'
import { ActivityFeed } from '@/components/dashboard/ActivityFeed'
import { SystemHealth } from '@/components/dashboard/SystemHealth'
import { createServerClient } from '@/lib/supabase-server'
import type { Alert, ActivityItem } from '@/types'

export const metadata: Metadata = { title: 'Дэшборд' }

// ─── types ────────────────────────────────────────────────────────────────────
interface KpiCard {
  label:    string
  value:    string
  trend:    string
  trendUp:  boolean
  icon:     string
  sublabel: string
  href:     string
}

interface GriDist {
  excellent:  number
  strong:     number
  developing: number
  critical:   number
  total:      number
}

interface DashboardData {
  total:    number
  active:   number
  pending:  number
  griDist:  GriDist
  activity: ActivityItem[]
  alerts:   Alert[]
  companies: { user_id: string; company_name: string }[]
}

// ─── data fetching ────────────────────────────────────────────────────────────
async function getDashboardData(): Promise<DashboardData | null> {
  try {
    const sb = createServerClient()

    // 1. Profiles
    const { data: profiles } = await sb
      .from('profiles')
      .select('id, status, full_name, email')
      .not('status', 'eq', 'rejected')

    const total   = profiles?.length ?? 0
    const active  = profiles?.filter((p) => p.status === 'approved').length ?? 0
    const pending = profiles?.filter((p) => p.status === 'pending_approval').length ?? 0

    // 2. Diagnostics for GRI distribution (overall_score is 0–10 scale)
    const { data: diags } = await sb
      .from('diagnostics')
      .select('overall_score, user_id')
      .eq('is_current', true)
      .not('overall_score', 'is', null)

    const scores = (diags ?? []).map((d) => Number(d.overall_score))
    const griDist: GriDist = {
      excellent:  scores.filter((s) => s >= 9).length,
      strong:     scores.filter((s) => s >= 7 && s < 9).length,
      developing: scores.filter((s) => s >= 5 && s < 7).length,
      critical:   scores.filter((s) => s < 5).length,
      total:      scores.length,
    }

    // 3. Companies
    const { data: companies } = await sb
      .from('companies')
      .select('user_id, company_name')

    const companyMap = Object.fromEntries(
      (companies ?? []).map((c) => [c.user_id, c.company_name as string])
    )

    // 4. Recent profiles → ActivityItem[]
    const recent = [...(profiles ?? [])].slice(0, 6)
    const activity: ActivityItem[] = recent.map((p) => {
      const diag  = diags?.find((d) => d.user_id === p.id)
      const score = diag ? Math.round(Number(diag.overall_score) * 100) : 0
      return {
        id:         p.id as string,
        clientName: (p.full_name ?? p.email ?? 'Клиент') as string,
        industry:   companyMap[p.id as string] ?? '—',
        event:
          p.status === 'approved'          ? 'Активный клиент'    :
          p.status === 'pending_approval'  ? 'Ожидает проверки'   :
                                             'Новая регистрация',
        gri:    score,
        status:
          p.status === 'approved'         ? 'active'   :
          p.status === 'pending_approval' ? 'inactive' : 'inactive',
        time: 'недавно',
      }
    })

    // 5. Alerts derived from DB state
    const alerts: Alert[] = []
    if (pending > 0) {
      alerts.push({
        id:          'pending-reg',
        severity:    'info',
        title:       `${pending} заявок ожидают проверки`,
        description: 'Новые клиенты зарегистрировались и ждут подтверждения аккаунта.',
        time:        'сейчас',
        action:      { label: 'Просмотреть', href: '/clients' },
      })
    }

    const criticalCount = scores.filter((s) => s < 4).length
    if (criticalCount > 0) {
      alerts.push({
        id:          'critical-gri',
        severity:    'critical',
        title:       `${criticalCount} клиент(ов) — критический GRI`,
        description: 'Клиенты с низкой оценкой готовности к росту требуют немедленного внимания.',
        time:        'сейчас',
        action:      { label: 'Смотреть клиентов', href: '/clients' },
      })
    }

    if (griDist.total > 0) {
      const excellentPct = Math.round((griDist.excellent / griDist.total) * 100)
      if (excellentPct > 0) {
        alerts.push({
          id:          'excellent-gri',
          severity:    'success',
          title:       `${griDist.excellent} клиент(ов) — Excellent GRI`,
          description: `${excellentPct}% портфеля достигли высшего уровня готовности к росту.`,
          time:        'сейчас',
          action:      { label: 'Смотреть отчёт', href: '/gri' },
        })
      }
    }

    // Always add a regulatory info alert as last item
    alerts.push({
      id:          'platform-info',
      severity:    'info',
      title:       'Платформа AIStart360',
      description: 'GRI-диагностика доступна для новых клиентов. Назначьте экспертов.',
      time:        'сейчас',
      action:      { label: 'Открыть настройки', href: '/settings' },
    })

    return { total, active, pending, griDist, activity, alerts, companies: companies ?? [] }
  } catch (e) {
    console.error('[Dashboard] data fetch error:', e)
    return null
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────
function buildKpi(data: DashboardData | null): KpiCard[] {
  if (!data) {
    return [
      { label: 'Клиенты',   value: '—',  trend: '—',    trendUp: true,  icon: 'groups',       sublabel: 'загрузка...', href: '/clients'   },
      { label: 'Активных',  value: '—',  trend: '—',    trendUp: true,  icon: 'check_circle', sublabel: 'загрузка...', href: '/clients'   },
      { label: 'Ожидают',   value: '—',  trend: '—',    trendUp: false, icon: 'hourglass_top',sublabel: 'загрузка...', href: '/clients'   },
      { label: 'GRI анализ',value: '—',  trend: '—',    trendUp: true,  icon: 'radar',        sublabel: 'загрузка...', href: '/gri'       },
    ]
  }
  const activePct = data.total > 0 ? Math.round((data.active / data.total) * 100) : 0
  return [
    {
      label:    'Клиенты',
      value:    String(data.total),
      trend:    data.total > 0 ? `+${data.total}` : '0',
      trendUp:  true,
      icon:     'groups',
      sublabel: 'зарегистрировано',
      href:     '/clients',
    },
    {
      label:    'Активных',
      value:    String(data.active),
      trend:    `${activePct}%`,
      trendUp:  data.active > 0,
      icon:     'check_circle',
      sublabel: 'от общего числа',
      href:     '/clients',
    },
    {
      label:    'Ожидают',
      value:    String(data.pending),
      trend:    data.pending > 0 ? 'нужна проверка' : 'нет новых',
      trendUp:  data.pending === 0,
      icon:     'hourglass_top',
      sublabel: 'заявок на рассмотрении',
      href:     '/clients',
    },
    {
      label:    'GRI анализов',
      value:    String(data.griDist.total),
      trend:    data.griDist.excellent > 0 ? `${data.griDist.excellent} excellent` : '—',
      trendUp:  data.griDist.excellent > 0,
      icon:     'radar',
      sublabel: 'диагностик проведено',
      href:     '/gri',
    },
  ]
}

function buildGriDistRows(griDist: GriDist) {
  const { excellent, strong, developing, critical, total } = griDist
  if (total === 0) {
    return [
      { label: 'Excellent (9–10)', pct: 0, color: 'bg-primary' },
      { label: 'Strong (7–8)',     pct: 0, color: 'bg-primary-fixed-dim' },
      { label: 'Developing (5–6)', pct: 0, color: 'bg-tertiary-container' },
      { label: 'Critical (<5)',    pct: 0, color: 'bg-error' },
    ]
  }
  const p = (n: number) => Math.round((n / total) * 100)
  return [
    { label: 'Excellent (9–10)', pct: p(excellent),  color: 'bg-primary' },
    { label: 'Strong (7–8)',     pct: p(strong),     color: 'bg-primary-fixed-dim' },
    { label: 'Developing (5–6)', pct: p(developing), color: 'bg-tertiary-container' },
    { label: 'Critical (<5)',    pct: p(critical),   color: 'bg-error' },
  ]
}

// ─── page ─────────────────────────────────────────────────────────────────────
export default async function DashboardPage() {
  const data    = await getDashboardData()
  const kpi     = buildKpi(data)
  const alerts  = data?.alerts ?? []
  const activity = data?.activity ?? []
  const griRows  = buildGriDistRows(data?.griDist ?? { excellent: 0, strong: 0, developing: 0, critical: 0, total: 0 })

  // Top companies for industry widget
  const topCompanies = (data?.companies ?? []).slice(0, 5).map((c, i) => ({
    name:   c.company_name ?? '—',
    count:  1,
    active: i === 0,
  }))

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="flex flex-col lg:flex-row justify-between items-start gap-6">
        <div className="lg:flex-1 max-w-xl min-w-0">
          <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">
            Q1 2026 · Текущий период
          </p>
          <h1 className="font-headline text-3xl lg:text-4xl font-extrabold text-on-surface leading-tight">
            Финансовый{' '}
            <span className="text-gradient">Обзор</span>
          </h1>
          <p className="text-on-surface-variant mt-3 text-sm max-w-lg leading-relaxed">
            Ключевые показатели компании в реальном времени.
          </p>
        </div>

        {/* KPI Grid */}
        <div className="grid grid-cols-2 gap-3 w-full lg:w-[460px] lg:shrink-0">
          {kpi.map((card) => (
            <Link
              key={card.label}
              href={card.href}
              className={`
                relative bg-surface-container-low rounded-2xl p-5 overflow-hidden
                border border-white/[0.04] hover:border-primary/20
                transition-all duration-200 group cursor-pointer
                ${!card.trendUp ? 'hover:border-error/20' : ''}
              `}
            >
              <div className={`
                absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none rounded-2xl
                ${card.trendUp
                  ? 'bg-gradient-to-br from-primary/[0.04] to-transparent'
                  : 'bg-gradient-to-br from-error/[0.04] to-transparent'
                }
              `} />
              <div className="flex items-start justify-between mb-3">
                <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">
                  {card.label}
                </p>
                <span className={`material-symbols-outlined text-base opacity-40 ${card.trendUp ? 'text-primary' : 'text-error'}`}>
                  {card.icon}
                </span>
              </div>
              <h3 className="text-3xl font-mono font-bold leading-none mb-2 text-on-surface">
                {card.value}
              </h3>
              <div className="flex items-center gap-1.5">
                <span className={`material-symbols-outlined text-sm ${card.trendUp ? 'text-primary' : 'text-error'}`}>
                  {card.trendUp ? 'trending_up' : 'trending_down'}
                </span>
                <span className={`text-xs font-mono ${card.trendUp ? 'text-primary' : 'text-error'}`}>
                  {card.trend}
                </span>
                <span className="text-[10px] text-on-surface-variant ml-1">{card.sublabel}</span>
              </div>
              <span className="material-symbols-outlined text-sm absolute bottom-4 right-4 opacity-0 group-hover:opacity-40 transition-opacity text-on-surface-variant">
                arrow_forward
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* System Health */}
      <SystemHealth />

      {/* Critical Alerts */}
      <section>
        <div className="flex justify-between items-end border-b border-outline-variant/10 pb-4 mb-5">
          <div>
            <h2 className="font-headline text-lg font-bold text-on-surface">Критические сигналы</h2>
            <p className="text-xs text-on-surface-variant mt-1">Требуют немедленного внимания</p>
          </div>
          <span className="font-mono text-[10px] text-error bg-error/10 px-3 py-1 rounded-full border border-error/20">
            {alerts.filter((a) => a.severity === 'critical').length} алерта
          </span>
        </div>
        {alerts.length === 0 ? (
          <div className="bg-surface-container rounded-xl p-8 text-center">
            <span className="material-symbols-outlined text-4xl text-primary/30 mb-3 block">check_circle</span>
            <p className="text-sm text-on-surface-variant">Нет критических сигналов</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {alerts.map((alert) => (
              <AlertCard key={alert.id} {...alert} />
            ))}
          </div>
        )}
      </section>

      {/* Activity Feed + Portfolio Health */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="flex justify-between items-center mb-5">
            <h2 className="font-headline text-lg font-bold text-on-surface">Активность клиентов</h2>
            <Link href="/clients" className="text-xs font-mono text-primary hover:underline uppercase tracking-wider">
              Все клиенты →
            </Link>
          </div>
          <ActivityFeed items={activity} />
        </div>

        {/* Side stats */}
        <div className="space-y-4">
          <h2 className="font-headline text-lg font-bold text-on-surface mb-5">Здоровье портфеля</h2>

          {/* GRI Distribution */}
          <Link href="/gri" className="block bg-surface-container rounded-2xl p-5 space-y-3 border border-white/[0.04] hover:border-primary/20 transition-colors group">
            <div className="flex items-center justify-between mb-4">
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">Распределение GRI</p>
              <span className="material-symbols-outlined text-sm text-on-surface-variant/30 group-hover:text-primary/60 transition-colors">arrow_forward</span>
            </div>
            {griRows.map((item) => (
              <div key={item.label}>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-on-surface-variant">{item.label}</span>
                  <span className="font-mono text-on-surface">{item.pct}%</span>
                </div>
                <div className="h-1 bg-surface-container-high rounded-full overflow-hidden">
                  <div className={`h-full ${item.color} rounded-full transition-all duration-700`} style={{ width: `${item.pct}%` }} />
                </div>
              </div>
            ))}
          </Link>

          {/* Top companies / industry */}
          <Link href="/clients" className="block bg-surface-container rounded-2xl p-5 border border-white/[0.04] hover:border-primary/20 transition-colors group">
            <div className="flex items-center justify-between mb-4">
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">Компании</p>
              <span className="material-symbols-outlined text-sm text-on-surface-variant/30 group-hover:text-primary/60 transition-colors">arrow_forward</span>
            </div>
            {topCompanies.length > 0 ? (
              <div className="space-y-3">
                {topCompanies.map((item) => (
                  <div key={item.name} className="flex justify-between items-center">
                    <span className="text-sm text-on-surface-variant truncate max-w-[140px]">{item.name}</span>
                    <span className={`font-mono text-sm ${item.active ? 'text-primary' : 'text-on-surface'}`}>
                      {item.count}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-on-surface-variant">Нет данных</p>
            )}
          </Link>
        </div>
      </section>

      {/* Platform Overview — AIStart360 */}
      <section>
        <div className="flex items-end justify-between border-b border-outline-variant/10 pb-4 mb-5">
          <div>
            <h2 className="font-headline text-lg font-bold text-on-surface">О платформе AIStart360</h2>
            <p className="text-xs text-on-surface-variant mt-1">Система акселерации бизнеса до $2M ARR</p>
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

        {/* Mission banner */}
        <div className="relative rounded-2xl overflow-hidden border border-primary/20 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-6 mb-6">
          <div className="absolute right-6 top-1/2 -translate-y-1/2 opacity-10">
            <span className="material-symbols-outlined text-[96px] text-primary">rocket_launch</span>
          </div>
          <p className="text-[10px] font-mono text-primary/70 uppercase tracking-[0.2em] mb-2">Миссия платформы</p>
          <h3 className="font-headline text-xl font-bold text-on-surface mb-2 max-w-xl">
            Стабильный рост до $2M/год на основе AI-трансформации и экспертной поддержки
          </h3>
          <p className="text-sm text-on-surface-variant max-w-2xl">
            AIStart360 помогает B2B-компаниям систематизировать рост — от операционного хаоса к масштабируемой системе.
          </p>
          <div className="flex gap-6 mt-4">
            {[
              { label: 'CAC Payback',    value: '1–2 мес' },
              { label: 'MoM Growth',     value: '≥15%'    },
              { label: 'LTV/CAC',        value: 'x3+'     },
              { label: 'Repeat Revenue', value: '40–60%'  },
            ].map((s) => (
              <div key={s.label}>
                <p className="text-lg font-mono font-bold text-primary">{s.value}</p>
                <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">{s.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* 8-block GTM Framework */}
        <div className="mb-6">
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
                className="bg-surface-container-low rounded-xl border border-white/[0.04] hover:border-primary/20 p-4 transition-colors group cursor-pointer">
                <div className="flex items-start justify-between mb-2">
                  <span className="text-[10px] font-mono text-primary/50">{block.n}</span>
                  <span className="material-symbols-outlined text-base text-on-surface-variant/30 group-hover:text-primary/60 transition-colors">{block.icon}</span>
                </div>
                <p className="text-xs text-on-surface-variant group-hover:text-on-surface transition-colors leading-snug">{block.label}</p>
              </Link>
            ))}
          </div>
        </div>

        {/* Program + Team */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5">
            <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-4">Программа (12–18 месяцев)</p>
            <div className="space-y-3">
              {[
                { phase: '7 дней',   title: 'Подготовка и онбординг',           icon: 'rocket_launch', color: 'text-primary'   },
                { phase: '1 день',   title: 'GRI-воркшоп интенсив',             icon: 'radar',         color: 'text-primary'   },
                { phase: '21 день',  title: 'Пилотный запуск + 2 мес поддержки', icon: 'flag',         color: 'text-secondary' },
                { phase: '9–12 мес', title: 'Системное масштабирование',         icon: 'trending_up',  color: 'text-primary'   },
              ].map((p, i) => (
                <div key={i} className="flex items-center gap-4">
                  <div className="flex flex-col items-center flex-shrink-0 w-8">
                    <span className={`material-symbols-outlined text-lg ${p.color}`}>{p.icon}</span>
                    {i < 3 && <div className="w-px h-4 bg-white/[0.06] mt-1" />}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-on-surface">{p.title}</p>
                    <p className="text-[10px] font-mono text-on-surface-variant">{p.phase}</p>
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
                <div key={e.role} className="flex items-center gap-2.5 bg-surface-container rounded-xl p-2.5">
                  <span className="material-symbols-outlined text-sm text-primary/50">{e.icon}</span>
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
