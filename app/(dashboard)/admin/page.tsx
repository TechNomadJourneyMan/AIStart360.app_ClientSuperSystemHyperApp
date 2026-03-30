import type { Metadata } from 'next'
import Link from 'next/link'
import { SystemHealth } from '@/components/dashboard/SystemHealth'
import { PendingClientsTable } from '@/components/dashboard/admin/PendingClientsTable'
import { AdminClientsList } from '@/components/dashboard/admin/AdminClientsList'
import { createServerClient } from '@/lib/supabase-server'

export const metadata: Metadata = { title: 'Админ-панель — AIStart360' }

const PLATFORM_STATS = [
  { label: 'Всего клиентов',      value: '48',    delta: '+6 за месяц',       icon: 'groups',            color: 'text-primary'    },
  { label: 'Активных сегодня',    value: '12',    delta: '25% от базы',       icon: 'online_prediction', color: 'text-primary'    },
  { label: 'GRI Воркшопов',       value: '34',    delta: '+8 за квартал',     icon: 'radar',             color: 'text-primary'    },
  { label: 'Отчётов создано',     value: '127',   delta: '+23 за месяц',      icon: 'description',       color: 'text-secondary'  },
  { label: 'Пользователей',       value: '56',    delta: '8 администраторов', icon: 'manage_accounts',   color: 'text-on-surface' },
  { label: 'Сред. GRI Score',     value: '5.8',   delta: '+0.4 за квартал',   icon: 'monitoring',        color: 'text-primary'    },
  { label: 'Экспертов',           value: '48',    delta: 'Активных порталов', icon: 'psychology',        color: 'text-secondary'  },
  { label: 'ARR Платформы',       value: '$284K', delta: '+18.2% MoM',        icon: 'payments',          color: 'text-primary'    },
]

// ALL_CLIENTS mock removed

const CONTENT_SECTIONS = [
  { label: 'GRI-диагностика',  href: '/gri',         icon: 'radar',                count: '34 отчёта',    color: 'primary',   desc: 'Воркшопы и анализ по 7 блокам'         },
  { label: 'Рынок',            href: '/market',       icon: 'public',               count: '12 анализов',  color: 'primary',   desc: 'Рыночные исследования и тренды'         },
  { label: 'Метрики',          href: '/metrics',      icon: 'monitoring',           count: '11 целей',     color: 'secondary', desc: 'KPI-система роста к $2M/год'            },
  { label: 'Аналитика',        href: '/analytics',    icon: 'bar_chart',            count: 'Live data',    color: 'primary',   desc: 'Финансовая аналитика и тренды'          },
  { label: 'Точка А',          href: '/point-a',      icon: 'my_location',          count: '48 профилей',  color: 'primary',   desc: 'Диагностика текущего состояния'         },
  { label: 'Точка Б',          href: '/point-b',      icon: 'flag',                 count: '48 целей',     color: 'secondary', desc: 'Целевые показатели и дорожные карты'    },
  { label: 'Инсайты',          href: '/insights',     icon: 'lightbulb',            count: '6 активных',   color: 'primary',   desc: 'AI-инсайты и сигналы по платформе'      },
  { label: 'Конкуренты',       href: '/competitors',  icon: 'compare_arrows',       count: '24 профиля',   color: 'secondary', desc: 'Конкурентная разведка по клиентам'       },
  { label: 'Отчёты',           href: '/reports',      icon: 'description',          count: '127 файлов',   color: 'primary',   desc: 'Все сгенерированные отчёты'             },
  { label: 'Команда',          href: '/team',         icon: 'group',                count: '8 экспертов',  color: 'secondary', desc: 'Управление командой экспертов'           },
  { label: 'Клиенты',          href: '/clients',      icon: 'business_center',      count: '48 компаний',  color: 'primary',   desc: 'Полная база клиентов платформы'         },
  { label: 'Пользователи',     href: '/users',        icon: 'manage_accounts',      count: '56 аккаунтов', color: 'primary',   desc: 'Управление доступами и ролями'          },
]

const GRI_DISTRIBUTION = [
  { label: 'Excellent  8–10', count: 6,  pct: 12, color: 'bg-primary'     },
  { label: 'Strong     6–8',  count: 22, pct: 45, color: 'bg-primary/60'  },
  { label: 'Developing 4–6',  count: 14, pct: 29, color: 'bg-secondary'   },
  { label: 'Critical   0–4',  count: 6,  pct: 12, color: 'bg-error'       },
]

const RECENT_ACTIVITY = [
  { icon: 'radar',        client: 'Vortex Labs',     event: 'GRI Score обновлён: 8.4 (+0.6)',       time: '2ч',  color: 'text-primary'   },
  { icon: 'person_add',   client: 'TechFlow KZ',     event: 'Новый клиент добавлен в систему',      time: '3ч',  color: 'text-primary'   },
  { icon: 'description',  client: 'Calyx Digital',   event: 'Отчёт Q1 2026 сгенерирован',           time: '5ч',  color: 'text-secondary' },
  { icon: 'warning',      client: 'Astra Ventures',  event: 'Риск: Churn Rate вырос до 12%',         time: '6ч',  color: 'text-error'     },
  { icon: 'check_circle', client: 'Nexum Systems',   event: 'Пилот 21 день — успешно завершён',     time: '1д',  color: 'text-primary'   },
  { icon: 'payments',     client: 'Momentum Finance',event: 'CAC Payback достиг ≤30 дней',          time: '1д',  color: 'text-primary'   },
  { icon: 'groups',       client: 'PulseCo',         event: 'Онбординг завершён, старт GRI',         time: '2д',  color: 'text-secondary' },
  { icon: 'block',        client: 'GreenBridge',     event: 'Критический блок: Operations — 2.1',   time: '3д',  color: 'text-error'     },
]

const STATUS_CONFIG = {
  active:   { label: 'Активен',       color: 'text-primary',   dot: 'bg-primary'   },
  at_risk:  { label: 'В зоне риска',  color: 'text-secondary', dot: 'bg-secondary' },
  critical: { label: 'Критично',      color: 'text-error',     dot: 'bg-error'     },
}

function GriBar({ score }: { score: number }) {
  const color = score >= 7 ? 'bg-primary' : score >= 5 ? 'bg-secondary' : 'bg-error'
  const textColor = score >= 7 ? 'text-primary' : score >= 5 ? 'text-secondary' : 'text-error'
  return (
    <div className="flex items-center gap-2 w-24">
      <div className="flex-1 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${(score / 10) * 100}%` }} />
      </div>
      <span className={`text-xs font-mono font-bold w-6 text-right ${textColor}`}>{score}</span>
    </div>
  )
}

export default async function AdminPage() {
  const sb = createServerClient()

  // Real-time counts
  const { count: clientsCount } = await sb.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'client')
  const { count: totalUsers } = await sb.from('profiles').select('*', { count: 'exact', head: true })
  const { data: diagData } = await sb.from('diagnostics').select('overall_score').eq('is_current', true)
  const avgGri = diagData && diagData.length > 0
    ? (diagData.reduce((acc, d) => acc + (d.overall_score || 0), 0) / diagData.length / 10).toFixed(1)
    : '0.0'

  const stats = [
    { label: 'Всего клиентов',      value: String(clientsCount ?? 0),    delta: '+0 за месяц',       icon: 'groups',            color: 'text-primary'    },
    { label: 'Сред. GRI Score',     value: avgGri,                       delta: '+0.0 за квартал',   icon: 'monitoring',        color: 'text-primary'    },
    { label: 'Пользователей',       value: String(totalUsers ?? 0),      delta: 'Всего в системе',   icon: 'manage_accounts',   color: 'text-on-surface' },
    { label: 'GRI Воркшопов',       value: String(diagData?.length ?? 0),delta: 'За всё время',      icon: 'radar',             color: 'text-primary'    },
    { label: 'Активных сегодня',    value: '—',                         delta: 'Coming soon',       icon: 'online_prediction', color: 'text-primary'    },
    { label: 'Отчётов создано',     value: '—',                         delta: 'Coming soon',       icon: 'description',       color: 'text-secondary'  },
    { label: 'Экспертов',           value: '—',                         delta: 'Coming soon',       icon: 'psychology',        color: 'text-secondary'  },
    { label: 'ARR Платформы',       value: '—',                         delta: 'Coming soon',       icon: 'payments',          color: 'text-primary'    },
  ]

  return (
    <div className="space-y-8">

      {/* Header */}
      <section>
        <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">
          Административная панель · Q1 2026
        </p>
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="font-headline text-3xl lg:text-4xl font-extrabold text-on-surface">
              Управление платформой
            </h1>
            <p className="text-on-surface-variant mt-2 text-sm">
              Полный контроль над клиентами, контентом, пользователями и системой
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/users"
              className="flex items-center gap-2 text-sm font-mono text-on-surface-variant border border-white/[0.06] hover:border-primary/30 px-4 py-2 rounded-xl transition-colors">
              <span className="material-symbols-outlined text-base">manage_accounts</span>
              Пользователи
            </Link>
            <Link href="/reports"
              className="flex items-center gap-2 text-sm font-mono text-[#003824] bg-gradient-to-r from-primary to-[#00e29e] px-4 py-2 rounded-xl font-bold hover:scale-[0.98] transition-all">
              <span className="material-symbols-outlined text-base">description</span>
              Отчёты
            </Link>
          </div>
        </div>
      </section>

      {/* Platform Stats */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="bg-surface-container-low rounded-2xl border border-white/[0.04] hover:border-primary/10 p-4 transition-colors">
            <div className="flex items-start justify-between mb-2">
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest leading-tight">{s.label}</p>
              <span className={`material-symbols-outlined text-base opacity-40 ${s.color}`}>{s.icon}</span>
            </div>
            <p className={`text-2xl font-mono font-bold ${s.color} mb-1`}>{s.value}</p>
            <p className="text-[10px] text-on-surface-variant">{s.delta}</p>
          </div>
        ))}
      </section>

      {/* System Health */}
      <SystemHealth />

      {/* Pending Applications */}
      <PendingClientsTable />

      {/* All Clients + Sidebar */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Clients Table */}
        <AdminClientsList />

        {/* Right column */}
        <div className="space-y-4">
          {/* GRI Distribution */}
          <Link href="/gri" className="block bg-surface-container-low rounded-2xl border border-white/[0.04] hover:border-primary/20 p-5 transition-colors group">
            <div className="flex items-center justify-between mb-4">
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">GRI по клиентам</p>
              <span className="material-symbols-outlined text-sm text-on-surface-variant/30 group-hover:text-primary/60 transition-colors">arrow_forward</span>
            </div>
            <div className="space-y-3">
              {GRI_DISTRIBUTION.map(d => (
                <div key={d.label}>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-on-surface-variant">{d.label}</span>
                    <span className="font-mono text-on-surface">{d.count} <span className="text-on-surface-variant/50">({d.pct}%)</span></span>
                  </div>
                  <div className="h-1.5 bg-surface-container-high rounded-full overflow-hidden">
                    <div className={`h-full ${d.color} rounded-full`} style={{ width: `${d.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-on-surface-variant mt-4">Средний GRI: <strong className="text-primary">5.8 / 10</strong></p>
          </Link>

          {/* Live Activity */}
          <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">Активность</p>
              <span className="text-[10px] font-mono text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-full">live</span>
            </div>
            <div className="space-y-3">
              {RECENT_ACTIVITY.slice(0, 6).map((act, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span className={`material-symbols-outlined text-base flex-shrink-0 ${act.color} mt-0.5`}>{act.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-medium text-on-surface leading-tight">{act.client}</p>
                    <p className="text-[10px] text-on-surface-variant leading-tight mt-0.5">{act.event}</p>
                  </div>
                  <span className="text-[10px] font-mono text-on-surface-variant flex-shrink-0">{act.time}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Content Sections */}
      <section>
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="font-headline text-xl font-bold text-on-surface">Разделы платформы</h2>
            <p className="text-xs text-on-surface-variant mt-1">Управление всем контентом клиентских порталов</p>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {CONTENT_SECTIONS.map((s) => (
            <Link key={s.href} href={s.href}
              className="bg-surface-container-low rounded-xl border border-white/[0.04] hover:border-primary/30 hover:bg-primary/5 p-4 transition-all group">
              <div className="flex items-start justify-between mb-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${s.color === 'primary' ? 'bg-primary/10' : 'bg-secondary/10'}`}>
                  <span className={`material-symbols-outlined text-base ${s.color === 'primary' ? 'text-primary' : 'text-secondary'}`}>{s.icon}</span>
                </div>
                <span className="text-[10px] font-mono text-on-surface-variant bg-surface-container px-2 py-0.5 rounded-md">{s.count}</span>
              </div>
              <p className="text-sm font-semibold text-on-surface mb-1 group-hover:text-primary transition-colors">{s.label}</p>
              <p className="text-[10px] text-on-surface-variant leading-snug">{s.desc}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* Users + Health */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-headline text-base font-bold text-on-surface">Пользователи системы</h2>
            <Link href="/users" className="text-xs font-mono text-primary hover:underline">Управление →</Link>
          </div>
          <div className="space-y-3">
            {[
              { role: 'Администраторы', count: 8,  icon: 'admin_panel_settings', color: 'text-primary',   desc: 'Полный доступ к платформе'          },
              { role: 'Эксперты',       count: 48, icon: 'psychology',           color: 'text-secondary', desc: 'Клиентские порталы и GRI-воркшопы'  },
            ].map(u => (
              <div key={u.role} className="flex items-center gap-4 p-3 rounded-xl bg-surface-container border border-white/[0.04]">
                <span className={`material-symbols-outlined text-xl ${u.color}`}>{u.icon}</span>
                <div className="flex-1">
                  <p className="text-sm font-medium text-on-surface">{u.role}</p>
                  <p className="text-[10px] text-on-surface-variant">{u.desc}</p>
                </div>
                <span className={`text-2xl font-mono font-bold ${u.color}`}>{u.count}</span>
              </div>
            ))}
          </div>
          <Link href="/register"
            className="mt-4 w-full flex items-center justify-center gap-2 text-sm font-mono text-on-surface-variant border border-white/[0.06] hover:border-primary/30 hover:text-primary px-4 py-2.5 rounded-xl transition-colors">
            <span className="material-symbols-outlined text-base">person_add</span>
            Добавить пользователя
          </Link>
        </div>

        <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6">
          <h2 className="font-headline text-base font-bold text-on-surface mb-5">Состояние платформы</h2>
          <div className="space-y-3">
            {[
              { label: 'Средний GRI Score',        value: '5.8 / 10', icon: 'radar',       ok: true  },
              { label: 'Клиентов в Critical зоне',  value: '6 (12%)',  icon: 'warning',     ok: false },
              { label: 'Retention 30d (средн.)',    value: '63%',      icon: 'favorite',    ok: true  },
              { label: 'CAC Payback (средн.)',       value: '38 дней',  icon: 'payments',    ok: true  },
              { label: 'Активных воркшопов',        value: '7 сейчас', icon: 'groups',      ok: true  },
              { label: 'Отчётов за месяц',          value: '23 новых', icon: 'description', ok: true  },
            ].map(item => (
              <div key={item.label} className="flex items-center gap-3">
                <span className={`material-symbols-outlined text-base ${item.ok ? 'text-primary' : 'text-error'}`}>{item.icon}</span>
                <span className="text-sm text-on-surface-variant flex-1">{item.label}</span>
                <span className={`text-sm font-mono font-bold ${item.ok ? 'text-primary' : 'text-error'}`}>{item.value}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 p-3 bg-primary/5 border border-primary/10 rounded-xl">
            <p className="text-xs text-on-surface-variant">
              <strong className="text-on-surface">Приоритет:</strong> 6 клиентов в Critical зоне требуют работы по Operations и Team блокам.
            </p>
          </div>
        </div>
      </section>

    </div>
  )
}
