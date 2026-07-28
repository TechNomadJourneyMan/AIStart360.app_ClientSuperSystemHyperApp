import Link from 'next/link'

const INSIGHT_TYPES = [
  { label: 'Возможности', icon: 'lightbulb', color: 'text-primary' },
  { label: 'Риски', icon: 'warning', color: 'text-error' },
  { label: 'Достижения', icon: 'star', color: 'text-secondary' },
]

export default function ExpertInsightsPage() {
  return (
    <div className="space-y-8">
      <section>
        <p className="mb-3 text-xs font-mono uppercase tracking-[0.2em] text-primary/70">
          Expert Portal
        </p>
        <h1 className="font-headline text-3xl font-extrabold text-on-surface">Инсайты</h1>
        <p className="mt-2 text-sm text-on-surface-variant">
          Аналитические выводы на основе данных компании
        </p>
      </section>

      <div
        id="expert-insights-data-status"
        role="status"
        className="flex items-start gap-3 rounded-2xl border border-tertiary-container/25 bg-tertiary-container/5 px-4 py-3"
      >
        <span className="material-symbols-outlined mt-0.5 text-lg text-tertiary-container">
          data_alert
        </span>
        <div>
          <p className="text-sm font-medium text-on-surface">Источник инсайтов не подключён</p>
          <p className="mt-1 text-xs text-on-surface-variant">
            Примерные выводы, показатели рынка и рекомендации не отображаются как анализ вашей
            компании.
          </p>
        </div>
      </div>

      <section aria-labelledby="expert-insight-types-title">
        <h2 id="expert-insight-types-title" className="sr-only">
          Категории инсайтов
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {INSIGHT_TYPES.map((insightType) => (
            <div
              key={insightType.label}
              aria-describedby="expert-insights-data-status"
              className="rounded-2xl border border-white/[0.04] bg-surface-container-low p-4"
            >
              <div className="mb-2 flex items-center gap-2">
                <span className={`material-symbols-outlined text-base ${insightType.color}`}>
                  {insightType.icon}
                </span>
                <span className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant">
                  {insightType.label}
                </span>
              </div>
              <p className="text-2xl font-mono font-bold text-on-surface-variant">—</p>
              <p className="mt-1 text-[10px] text-on-surface-variant">Нет данных</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-white/[0.04] bg-surface-container-low p-8 text-center sm:p-12">
        <span className="material-symbols-outlined mb-3 block text-4xl text-on-surface-variant/20">
          lightbulb
        </span>
        <h2 className="text-sm font-medium text-on-surface">Инсайты пока недоступны</h2>
        <p className="mx-auto mt-1 max-w-lg text-xs leading-relaxed text-on-surface-variant">
          Здесь появятся только выводы, сформированные из подключённых данных. Фильтры и отметки
          прочтения будут доступны вместе с рабочим источником.
        </p>
        <Link
          href="/expert/dashboard"
          className="mt-5 inline-flex rounded-xl border border-white/[0.08] bg-surface-container px-4 py-2 text-xs font-mono text-on-surface-variant transition-colors hover:border-white/[0.14] hover:text-on-surface"
        >
          На главную
        </Link>
      </section>
    </div>
  )
}
