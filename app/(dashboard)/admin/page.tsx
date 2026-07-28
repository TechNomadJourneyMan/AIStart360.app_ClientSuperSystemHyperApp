'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { SystemHealth } from '@/components/dashboard/SystemHealth'
import { PendingClientsTable } from '@/components/dashboard/admin/PendingClientsTable'
import { AdminClientsList } from '@/components/dashboard/admin/AdminClientsList'

const CONTENT_SECTIONS = [
  { label: 'GRI-диагностика', href: '/gri', icon: 'radar', color: 'primary', desc: 'Воркшопы и анализ по 7 блокам' },
  { label: 'Рынок', href: '/market', icon: 'public', color: 'primary', desc: 'Рыночные исследования и тренды' },
  { label: 'Метрики', href: '/metrics', icon: 'monitoring', color: 'secondary', desc: 'KPI-система роста к $2M/год' },
  { label: 'Продажи', href: '/sales-monitoring', icon: 'point_of_sale', color: 'primary', desc: 'Продажи, расходы, планы и P&L' },
  { label: 'Аналитика', href: '/analytics', icon: 'bar_chart', color: 'primary', desc: 'Финансовая аналитика и тренды' },
  { label: 'Точка А', href: '/point-a', icon: 'my_location', color: 'primary', desc: 'Диагностика текущего состояния' },
  { label: 'Точка Б', href: '/point-b', icon: 'flag', color: 'secondary', desc: 'Целевые показатели и дорожные карты' },
  { label: 'Инсайты', href: '/insights', icon: 'lightbulb', color: 'primary', desc: 'AI-инсайты и сигналы по платформе' },
  { label: 'Конкуренты', href: '/competitors', icon: 'compare_arrows', color: 'secondary', desc: 'Конкурентная разведка по клиентам' },
  { label: 'Отчёты', href: '/reports', icon: 'description', color: 'primary', desc: 'Все сгенерированные отчёты' },
  { label: 'Команда', href: '/team', icon: 'group', color: 'secondary', desc: 'Управление командой экспертов' },
  { label: 'Клиенты', href: '/clients', icon: 'business_center', color: 'primary', desc: 'Полная база клиентов платформы' },
  { label: 'Пользователи', href: '/users', icon: 'manage_accounts', color: 'primary', desc: 'Управление доступами и ролями' },
]

function withRoutePrefix(routePrefix: string, href: string) {
  if (!routePrefix) return href
  return `${routePrefix.replace(/\/+$/, '')}${href}`
}

export default function AdminPage({ routePrefix = '' }: { routePrefix?: string }) {
  const searchParams = useSearchParams()
  const activeTab = searchParams.get('tab') === 'clients' ? 'clients' : 'overview'
  const moduleHref = (href: string) => withRoutePrefix(routePrefix, href)

  return (
    <div className="space-y-8 min-h-screen pb-20">
      {/* Header with Tab Switcher */}
      <section className="sticky top-0 z-20 bg-surface/80 backdrop-blur-xl -mx-4 px-4 py-4 border-b border-white/5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="font-headline text-2xl font-black text-on-surface tracking-tight uppercase">Platform Command</h1>
            <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-[0.2em] mt-1 opacity-60">
              Workspace · состояние систем показано ниже
            </p>
          </div>
          
          <div className="flex bg-surface-container-high p-1 rounded-2xl border border-white/5 self-start">
            <Link
              href="?tab=overview"
              scroll={false}
              aria-current={activeTab === 'overview' ? 'page' : undefined}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-bold transition-all duration-300 ${
                activeTab === 'overview'
                  ? 'bg-primary text-on-primary shadow-lg shadow-primary/20'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-white/5'
              }`}
            >
              <span className="material-symbols-outlined text-base">dashboard</span>
              ОБЗОР
            </Link>
            <Link
              href="?tab=clients"
              scroll={false}
              aria-current={activeTab === 'clients' ? 'page' : undefined}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-bold transition-all duration-300 ${
                activeTab === 'clients'
                  ? 'bg-primary text-on-primary shadow-lg shadow-primary/20'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-white/5'
              }`}
            >
              <span className="material-symbols-outlined text-base">groups</span>
              КЛИЕНТЫ
            </Link>
          </div>
        </div>
      </section>

      <div className="animate-in fade-in transition-all duration-500">
        {activeTab === 'overview' ? (
          <div className="space-y-8">
             {/* Stats Grid */}
             <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'Всего клиентов', value: '—', icon: 'groups' },
                  { label: 'Сред. GRI Score', value: '—', icon: 'monitoring' },
                  { label: 'Пользователей', value: '—', icon: 'manage_accounts' },
                  { label: 'GRI Воркшопов', value: '—', icon: 'radar' },
                ].map(s => (
                  <div key={s.label} className="bg-surface-container-low rounded-2xl border border-white/5 p-4">
                     <span className="material-symbols-outlined text-base mb-2 font-light text-on-surface-variant opacity-50">{s.icon}</span>
                     <p className="text-2xl font-mono font-black text-on-surface-variant">{s.value}</p>
                     <p className="text-[10px] font-mono text-on-surface-variant uppercase mt-1">{s.label}</p>
                     <p className="mt-1 text-[9px] font-mono text-on-surface-variant/60">Источник не подключён</p>
                  </div>
                ))}
             </div>

             <SystemHealth />

             <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                   <div className="bg-surface-container-low rounded-3xl border border-white/5 p-6">
                      <div className="flex items-center justify-between mb-8">
                         <h2 className="text-xl font-black text-on-surface tracking-tighter">МОДУЛИ ПЛАТФОРМЫ</h2>
                         <Link href={moduleHref('/clients')} className="text-[10px] font-mono text-primary bg-primary/10 px-3 py-1 rounded-full hover:bg-primary/20 transition-colors uppercase font-bold">Base Access ↗</Link>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {CONTENT_SECTIONS.slice(0, 12).map((s) => (
                          <Link key={s.href} href={moduleHref(s.href)} className="flex flex-col h-full bg-surface-container rounded-2xl border border-white/5 p-4 hover:bg-primary/5 hover:border-primary/30 transition-all group">
                            <span className={`material-symbols-outlined text-xl mb-3 ${s.color === 'primary' ? 'text-primary' : 'text-secondary'}`}>{s.icon}</span>
                            <p className="text-xs font-black text-on-surface group-hover:text-primary transition-colors leading-tight">{s.label.toUpperCase()}</p>
                            <p className="text-[9px] text-on-surface-variant mt-2 opacity-60 leading-relaxed">{s.desc}</p>
                          </Link>
                        ))}
                      </div>
                   </div>
                </div>

                <div className="bg-surface-container-low rounded-3xl border border-white/5 p-6">
                   <h2 className="text-xl font-black text-on-surface tracking-tighter mb-8 uppercase">Активность</h2>
                   <div className="rounded-2xl bg-surface-container p-6 text-center" role="status">
                      <span className="material-symbols-outlined mb-3 block text-3xl text-on-surface-variant/30">history_toggle_off</span>
                      <p className="text-sm font-medium text-on-surface">Лента активности не подключена</p>
                      <p className="mt-1 text-xs text-on-surface-variant">
                        События не отображаются без подтверждённого источника данных.
                      </p>
                   </div>
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
                         <h2 className="text-2xl font-black text-on-surface tracking-tighter uppercase">Client Database</h2>
                         <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-[0.2em] mt-1 opacity-60">
                           Состояние источника отображается в таблице
                         </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled
                          title="Поиск по базе пока недоступен"
                          aria-label="Поиск по базе пока недоступен"
                          className="w-10 h-10 rounded-full bg-surface-container-high border border-white/5 flex items-center justify-center text-on-surface-variant opacity-50 cursor-not-allowed"
                        >
                           <span className="material-symbols-outlined text-lg">search</span>
                        </button>
                        <button
                          type="button"
                          disabled
                          title="Создание портала пока недоступно"
                          aria-label="Создание нового портала пока недоступно"
                          className="px-6 py-2.5 rounded-full bg-surface-container-high text-on-surface-variant text-[10px] font-black tracking-widest opacity-50 cursor-not-allowed"
                        >
                           PORTAL DEPLOY UNAVAILABLE
                        </button>
                      </div>
                   </div>
                   <AdminClientsList basePath={moduleHref('/clients')} />
                </div>
             </section>

             <section className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-20">
                <div className="bg-surface-container-low rounded-3xl border border-white/5 p-8">
                   <h2 className="text-sm font-black text-on-surface tracking-widest uppercase mb-6 opacity-60 font-mono">GRI Score Distribution</h2>
                   <div className="rounded-2xl bg-surface-container p-6 text-center" role="status">
                      <span className="font-mono text-2xl font-bold text-on-surface-variant">—</span>
                      <p className="mt-2 text-xs text-on-surface-variant">
                        Распределение GRI недоступно: агрегированный источник не подключён.
                      </p>
                   </div>
                </div>
                <div className="bg-surface-container-low rounded-3xl border border-white/5 p-8 flex flex-col justify-center text-center">
                   <span className="material-symbols-outlined text-4xl text-on-surface-variant mb-4 opacity-30">auto_awesome</span>
                   <h3 className="text-lg font-black text-on-surface leading-tight px-10">AI INSIGHT НЕДОСТУПЕН</h3>
                   <p className="text-xs text-on-surface-variant mt-4 opacity-70">
                     Выводы не формируются без подтверждённых аналитических данных.
                   </p>
                </div>
             </section>
          </div>
        )}
      </div>
    </div>
  )
}
