export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'

export const metadata: Metadata = { title: 'Рынок' }

async function getMarketCounts() {
  try {
    const [organizations, clients] = await Promise.all([
      prisma.organization.count(),
      prisma.client.count(),
    ])
    return { organizations, clients, unavailable: false }
  } catch (error) {
    console.error('[market] live counters unavailable', error)
    return { organizations: null, clients: null, unavailable: true }
  }
}

export default async function MarketPage() {
  await auth()
  const counts = await getMarketCounts()

  const liveCards = [
    {
      label: 'Организации',
      value: counts.organizations === null ? '—' : String(counts.organizations),
      icon: 'apartment',
      desc: counts.organizations === null ? 'Данные временно недоступны' : 'Записи в системе',
    },
    {
      label: 'Клиенты',
      value: counts.clients === null ? '—' : String(counts.clients),
      icon: 'groups',
      desc: counts.clients === null ? 'Данные временно недоступны' : 'Клиентская база',
    },
  ]

  return (
    <div className="space-y-8">
      <section>
        <p className="mb-3 text-xs font-mono uppercase tracking-[0.2em] text-primary/70">
          Рыночная аналитика
        </p>
        <h1 className="font-headline text-3xl font-extrabold text-on-surface lg:text-4xl">
          Анализ <span className="text-gradient">рынка</span>
        </h1>
        <p className="mt-2 max-w-xl text-sm text-on-surface-variant">
          На странице отображаются только показатели, полученные из подключённой базы.
        </p>
      </section>

      {counts.unavailable && (
        <div
          role="alert"
          className="flex flex-wrap items-start gap-3 rounded-2xl border border-tertiary-container/25 bg-tertiary-container/5 px-4 py-3"
        >
          <span className="material-symbols-outlined mt-0.5 text-lg text-tertiary-container">cloud_off</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-on-surface">Оперативные счётчики временно недоступны</p>
            <p className="mt-1 text-xs text-on-surface-variant">
              Источник данных не отвечает. Значения не заменены демонстрационными цифрами.
            </p>
          </div>
          <a
            href="?retry=market-counts"
            className="inline-flex items-center gap-1.5 rounded-lg border border-tertiary-container/25 px-3 py-1.5 text-xs font-semibold text-tertiary-container transition-colors hover:bg-tertiary-container/10"
          >
            <span className="material-symbols-outlined text-base">refresh</span>
            Повторить
          </a>
        </div>
      )}

      <section aria-label="Подключённые показатели" className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {liveCards.map((metric) => (
          <div key={metric.label} className="rounded-2xl border border-white/[0.04] bg-surface-container-low p-6">
            <div className="mb-4 flex items-start justify-between">
              <p className="text-xs font-mono uppercase tracking-widest text-on-surface-variant">{metric.label}</p>
              <span className="material-symbols-outlined text-xl text-primary/50">{metric.icon}</span>
            </div>
            <p className="mb-1 text-3xl font-mono font-bold text-on-surface">{metric.value}</p>
            <p className="text-xs text-on-surface-variant">{metric.desc}</p>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-dashed border-outline-variant/30 bg-surface-container-low p-8 text-center">
        <span className="material-symbols-outlined mb-3 block text-4xl text-on-surface-variant/30">query_stats</span>
        <h2 className="font-headline text-lg font-bold text-on-surface">Расширенный рыночный обзор не подключён</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-on-surface-variant">
          TAM, SAM, SOM, сегменты, тренды и сигналы скрыты, пока для них нет подтверждённого источника данных.
        </p>
      </section>
    </div>
  )
}
