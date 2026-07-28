import Link from 'next/link'

const RELEASES = [
  {
    phase: 'Сейчас в пилоте',
    status: 'Доступно',
    items: ['Диагностика бизнеса', 'Точка А', 'Документы', 'AI-рекомендации', 'Профиль компании'],
    tone: 'border-primary/25 bg-primary/10 text-primary',
  },
  {
    phase: 'Следующий релиз',
    status: 'Запланировано',
    items: ['Мониторинг продаж', 'Планы и план-факт', 'Операционные расходы', 'P&L и ДДС'],
    tone: 'border-secondary/25 bg-secondary/10 text-secondary',
  },
  {
    phase: 'Расширение платформы',
    status: 'В roadmap',
    items: ['Рынок и конкуренты', 'Командные роли', 'Интеграции CRM', 'Автоматические отчёты'],
    tone: 'border-white/10 bg-white/[0.03] text-on-surface-variant',
  },
]

export default function OwnerRoadmapPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-primary/70">Карта развития</p>
        <h1 className="mt-2 font-headline text-3xl font-extrabold text-on-surface">
          Что уже работает и что появится дальше
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-on-surface-variant">
          В пилоте доступны только завершённые сценарии. Будущие модули показаны честно и не маскируются под рабочие разделы.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {RELEASES.map((release) => (
          <section key={release.phase} className="rounded-2xl border border-white/[0.07] bg-surface-container-low p-5">
            <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${release.tone}`}>
              {release.status}
            </span>
            <h2 className="mt-4 text-lg font-bold text-on-surface">{release.phase}</h2>
            <ul className="mt-4 space-y-2">
              {release.items.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-on-surface-variant">
                  <span className="material-symbols-outlined mt-0.5 text-base text-primary/70">check_circle</span>
                  {item}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <Link
        href="/owner/dashboard"
        className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-on-surface transition-colors hover:bg-white/[0.04]"
      >
        <span className="material-symbols-outlined text-lg">arrow_back</span>
        Вернуться на дашборд
      </Link>
    </div>
  )
}
