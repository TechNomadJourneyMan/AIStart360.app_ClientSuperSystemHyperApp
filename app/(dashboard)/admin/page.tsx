'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { SystemHealth } from '@/components/dashboard/SystemHealth'
import { PendingClientsTable } from '@/components/dashboard/admin/PendingClientsTable'
import { AdminClientsList } from '@/components/dashboard/admin/AdminClientsList'

const CONTENT_SECTIONS = [
  { label: 'GRI-диагностика',  href: '/gri',         icon: 'radar',                count: '34 отчёта',    color: 'primary',   desc: 'Воркшопы и анализ по 7 блокам'         },
  { label: 'Рынок',            href: '/market',       icon: 'public',               count: '12 анализов',  color: 'primary',   desc: 'Рыночные исследования и тренды'         },
  { label: 'Метрики',          href: '/metrics',      icon: 'monitoring',           count: '11 целей',     color: 'secondary', desc: 'KPI-система роста к $2M/год'            },
  { label: 'Продажи',          href: '/sales-monitoring', icon: 'point_of_sale',     count: 'Live data',    color: 'primary',   desc: 'Продажи, расходы, планы и P&L'          },
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
  { icon: 'radar', client: 'Vortex Labs', event: 'GRI Score обновлён: 8.4 (+0.6)', time: '2ч', color: 'text-primary' },
  { icon: 'person_add', client: 'TechFlow KZ', event: 'Новый клиент добавлен в систему', time: '3ч', color: 'text-primary' },
  { icon: 'description', client: 'Calyx Digital', event: 'Отчёт Q1 2026 сгенерирован', time: '5ч', color: 'text-secondary' },
  { icon: 'warning', client: 'Astra Ventures', event: 'Риск: Churn Rate вырос до 12%', time: '6ч', color: 'text-error' },
]

export default function AdminPage() {
  const searchParams = useSearchParams()
  const [activeTab, setActiveTab] = useState(
    searchParams.get('tab') === 'clients' ? 'clients' : 'overview',
  )

  return (
    <div className="space-y-8 min-h-screen pb-20">
      {/* Header with Tab Switcher */}
      <section className="sticky top-0 z-20 bg-surface/80 backdrop-blur-xl -mx-4 px-4 py-4 border-b border-white/5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="font-headline text-2xl font-black text-on-surface tracking-tight uppercase">Platform Command</h1>
            <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-[0.2em] mt-1 opacity-60">Status: Operational · Q1 2026</p>
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

      <div className="animate-in fade-in transition-all duration-500">
        {activeTab === 'overview' ? (
          <div className="space-y-8">
             {/* Stats Grid */}
             <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'Всего клиентов',      value: '48',    delta: '+6 за месяц',       icon: 'groups',            color: 'text-primary'    },
                  { label: 'Сред. GRI Score',     value: '5.8',   delta: '+0.4 за квартал',   icon: 'monitoring',        color: 'text-primary'    },
                  { label: 'Пользователей',       value: '56',    delta: 'Всего в системе',   icon: 'manage_accounts',   color: 'text-on-surface' },
                  { label: 'GRI Воркшопов',       value: '34',    delta: 'За всё время',      icon: 'radar',             color: 'text-primary'    },
                ].map(s => (
                  <div key={s.label} className="bg-surface-container-low rounded-2xl border border-white/5 p-4 hover:border-primary/20 transition-all group">
                     <span className={`material-symbols-outlined text-base mb-2 font-light opacity-50 group-hover:opacity-100 ${s.color}`}>{s.icon}</span>
                     <p className={`text-2xl font-mono font-black ${s.color}`}>{s.value}</p>
                     <p className="text-[10px] font-mono text-on-surface-variant uppercase mt-1">{s.label}</p>
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
                        {CONTENT_SECTIONS.slice(0, 12).map((s) => (
                          <Link key={s.href} href={s.href} className="flex flex-col h-full bg-surface-container rounded-2xl border border-white/5 p-4 hover:bg-primary/5 hover:border-primary/30 transition-all group">
                            <span className={`material-symbols-outlined text-xl mb-3 ${s.color === 'primary' ? 'text-primary' : 'text-secondary'}`}>{s.icon}</span>
                            <p className="text-xs font-black text-on-surface group-hover:text-primary transition-colors leading-tight">{s.label.toUpperCase()}</p>
                            <p className="text-[9px] text-on-surface-variant mt-auto opacity-60 font-mono">{s.count}</p>
                          </Link>
                        ))}
                      </div>
                   </div>
                </div>

                <div className="bg-surface-container-low rounded-3xl border border-white/5 p-6">
                   <h2 className="text-xl font-black text-on-surface tracking-tighter mb-8 uppercase">Live Intel</h2>
                   <div className="space-y-6 relative overflow-hidden">
                      {RECENT_ACTIVITY.map((act, i) => (
                        <div key={i} className="flex items-start gap-4 relative z-10">
                           <div className={`w-8 h-8 rounded-full bg-surface-container-high flex items-center justify-center flex-shrink-0`}>
                              <span className={`material-symbols-outlined text-sm ${act.color}`}>{act.icon}</span>
                           </div>
                           <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold text-on-surface truncate">{act.client}</p>
                              <p className="text-[10px] text-on-surface-variant leading-relaxed mt-1">{act.event}</p>
                           </div>
                           <span className="text-[9px] font-mono text-on-surface-variant opacity-40">{act.time}</span>
                        </div>
                      ))}
                   </div>
                   <button className="w-full mt-8 py-3 bg-white/5 hover:bg-white/10 rounded-2xl text-[10px] font-bold text-on-surface-variant tracking-widest transition-all">VIEW ALL ACTIVITY</button>
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
                         <h2 className="text-2xl font-black text-on-surface tracking-tighter uppercase">Client Database V1.4</h2>
                         <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-[0.2em] mt-1 opacity-60">Synced with Primary Node · Global Portals</p>
                      </div>
                      <div className="flex gap-2">
                        <button className="w-10 h-10 rounded-full bg-surface-container-high border border-white/5 flex items-center justify-center text-on-surface hover:bg-primary hover:text-on-primary transition-all shadow-xl">
                           <span className="material-symbols-outlined text-lg">search</span>
                        </button>
                        <button className="px-6 py-2.5 rounded-full bg-primary text-on-primary text-[10px] font-black tracking-widest shadow-lg shadow-primary/20 hover:scale-[0.98] active:scale-95 transition-all">
                           DEPLOY NEW PORTAL
                        </button>
                      </div>
                   </div>
                   <AdminClientsList />
                </div>
             </section>

             <section className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-20">
                <div className="bg-surface-container-low rounded-3xl border border-white/5 p-8">
                   <h2 className="text-sm font-black text-on-surface tracking-widest uppercase mb-6 opacity-60 font-mono">GRI Score Distribution</h2>
                   <div className="space-y-4">
                      {GRI_DISTRIBUTION.map(d => (
                        <div key={d.label}>
                           <div className="flex justify-between text-[10px] font-mono mb-2 uppercase">
                              <span className="text-on-surface-variant">{d.label}</span>
                              <span className="text-on-surface font-bold">{d.pct}%</span>
                           </div>
                           <div className="h-1 bg-surface-container-high rounded-full overflow-hidden">
                              <div className={`h-full ${d.color} shadow-[0_0_8px_rgba(110,255,192,0.4)]`} style={{ width: `${d.pct}%` }} />
                           </div>
                        </div>
                      ))}
                   </div>
                </div>
                <div className="bg-surface-container-low rounded-3xl border border-white/5 p-8 flex flex-col justify-center text-center">
                   <span className="material-symbols-outlined text-4xl text-primary mb-4 opacity-50">auto_awesome</span>
                   <h3 className="text-lg font-black text-on-surface leading-tight px-10">AI INSIGHT: INCREASED SCALING VELOCITY IN FINTECH SECTOR</h3>
                   <p className="text-xs text-on-surface-variant mt-4 opacity-70">Regulatory shifts in central banking expected to boost GRI averages in H2 2026.</p>
                   <button className="mt-8 text-[10px] font-black text-primary hover:underline uppercase tracking-widest">Read Macro Signals →</button>
                </div>
             </section>
          </div>
        )}
      </div>
    </div>
  )
}
