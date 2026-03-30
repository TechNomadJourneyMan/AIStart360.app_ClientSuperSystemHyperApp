import type { Metadata } from 'next'
import { prisma } from '@/lib/db'

export const metadata: Metadata = { title: 'Рынок' }

export default async function MarketPage() {
  const [organizations, clients] = await Promise.all([
    prisma.organization.count(),
    prisma.client.count(),
  ])

  return (
    <div className="space-y-8">
      {/* Header */}
      <section>
        <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">
          Рыночная аналитика · Q1 2026
        </p>
        <h1 className="font-headline text-3xl lg:text-4xl font-extrabold text-on-surface">
          Анализ{' '}
          <span className="text-gradient">Рынка</span>
        </h1>
        <p className="text-on-surface-variant mt-2 text-sm max-w-xl">
          Размер рынка, сегменты, тренды и рыночные сигналы в реальном времени.
        </p>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { label: 'Организации', value: String(organizations), icon: 'apartment', desc: 'Активные организации в системе' },
          { label: 'Клиенты', value: String(clients), icon: 'groups', desc: 'Клиентская база для анализа' },
          { label: 'Сигналы рынка', value: '0', icon: 'hub', desc: 'Источник данных ещё не подключён' },
        ].map((m) => (
          <div key={m.label} className="bg-surface-container-low rounded-2xl border border-white/[0.04] hover:border-primary/20 p-6 transition-colors group">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-xs font-mono text-on-surface-variant uppercase tracking-widest">{m.label}</p>
              </div>
              <span className="material-symbols-outlined text-xl text-primary/40 group-hover:text-primary/70 transition-colors">{m.icon}</span>
            </div>
            <p className="text-3xl font-mono font-bold text-on-surface mb-1">{m.value}</p>
            <p className="text-xs text-on-surface-variant">{m.desc}</p>
          </div>
        ))}
      </section>

      <section className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6">
        <div className="flex items-start gap-4">
          <span className="material-symbols-outlined text-2xl text-on-surface-variant">database</span>
          <div>
            <h2 className="font-headline text-lg font-bold text-on-surface mb-2">Данные рынка не подключены</h2>
            <p className="text-sm text-on-surface-variant leading-relaxed">
              Эта страница переведена в real-data режим: вместо моков показывается фактическое состояние источников.
              Для заполнения раздела требуется подключить таблицу/интеграцию рыночных сигналов.
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}
