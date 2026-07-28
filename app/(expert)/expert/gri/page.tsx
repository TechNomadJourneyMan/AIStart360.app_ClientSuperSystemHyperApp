import Link from 'next/link'

const UNAVAILABLE_SECTIONS = [
  {
    title: 'История GRI Score',
    description: 'Динамика по периодам появится после подключения сохранённых расчётов.',
    icon: 'monitoring',
  },
  {
    title: 'Разбивка по доменам',
    description: 'Оценки по направлениям не показываются без результата диагностики.',
    icon: 'donut_large',
  },
  {
    title: 'Ключевые инсайты',
    description: 'Рекомендации появятся только после обработки реальных данных.',
    icon: 'lightbulb',
  },
]

export default function ExpertGriPage() {
  return (
    <div className="space-y-8">
      <section>
        <p className="mb-3 text-xs font-mono uppercase tracking-[0.2em] text-primary/70">
          Expert Portal
        </p>
        <h1 className="font-headline text-3xl font-extrabold text-on-surface">
          GRI-диагностика
        </h1>
        <p className="mt-2 text-sm text-on-surface-variant">
          Growth Readiness Index — комплексная оценка готовности к росту
        </p>
      </section>

      <div
        id="expert-gri-data-status"
        role="status"
        className="flex items-start gap-3 rounded-2xl border border-tertiary-container/25 bg-tertiary-container/5 px-4 py-3"
      >
        <span className="material-symbols-outlined mt-0.5 text-lg text-tertiary-container">
          pending_actions
        </span>
        <div>
          <p className="text-sm font-medium text-on-surface">Расчёт GRI ещё не подключён</p>
          <p className="mt-1 text-xs text-on-surface-variant">
            На этой странице не отображаются примерные баллы, сравнения или рекомендации как
            результаты вашей компании.
          </p>
        </div>
      </div>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div
          aria-describedby="expert-gri-data-status"
          className="flex flex-col items-center justify-center rounded-2xl border border-white/[0.04] bg-surface-container-low p-8 text-center"
        >
          <p className="mb-6 text-[10px] font-mono uppercase tracking-widest text-on-surface-variant">
            Итоговый GRI Score
          </p>
          <div className="mb-5 flex h-44 w-44 items-center justify-center rounded-full border-[10px] border-white/[0.06]">
            <span className="text-4xl font-mono font-bold text-on-surface-variant">—</span>
          </div>
          <p className="text-sm font-medium text-on-surface">Нет рассчитанного результата</p>
          <p className="mt-1 text-xs text-on-surface-variant">
            Оценка появится после подключения диагностики.
          </p>
        </div>

        <div className="grid gap-4 lg:col-span-2">
          {UNAVAILABLE_SECTIONS.map((section) => (
            <div
              key={section.title}
              aria-describedby="expert-gri-data-status"
              className="flex items-start gap-4 rounded-2xl border border-white/[0.04] bg-surface-container-low p-5"
            >
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-surface-container">
                <span className="material-symbols-outlined text-lg text-on-surface-variant/60">
                  {section.icon}
                </span>
              </div>
              <div>
                <h2 className="text-sm font-semibold text-on-surface">{section.title}</h2>
                <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">
                  {section.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-white/[0.04] bg-surface-container-low p-6">
        <h2 className="font-headline text-lg font-bold text-on-surface">Что доступно сейчас</h2>
        <p className="mt-2 max-w-2xl text-sm text-on-surface-variant">
          Можно проверить данные профиля или перейти к другим разделам экспертного портала. Эти
          ссылки открывают существующие страницы и не запускают фиктивный расчёт.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href="/expert/profile"
            className="rounded-xl border border-primary/20 bg-primary/10 px-4 py-2 text-xs font-mono text-primary transition-colors hover:bg-primary/15"
          >
            Открыть профиль
          </Link>
          <Link
            href="/expert/dashboard"
            className="rounded-xl border border-white/[0.08] bg-surface-container px-4 py-2 text-xs font-mono text-on-surface-variant transition-colors hover:border-white/[0.14] hover:text-on-surface"
          >
            На главную
          </Link>
        </div>
      </section>
    </div>
  )
}
