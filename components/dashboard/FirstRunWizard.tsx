import Link from 'next/link'

/**
 * First-run wizard (ON-1). Shown to a client who hasn't produced a diagnostic
 * yet: three clear steps to their GRI, with real per-step completion, instead
 * of a scattered "fill the survey" prompt. Server component — no client JS.
 *
 * R2-C (Q4 + product review M-1): the full GRI is a paid section. With it
 * closed for the account (`griLocked`, the server decision) the third step
 * leads to the free «Снимок бизнеса» — the express assessment of the cabinet,
 * built from the account's own questionnaire — instead of the paywall of /gri.
 * NOT the public mini-GRI /gri-free: that is a lead magnet for visitors
 * («без регистрации», e-mail form, «Зарегистрируйтесь»), its result is not
 * tied to the account. With the full GRI open — as before.
 */

/** «Снимок бизнеса» — the free express assessment in the cabinet (app/client/onboarding/snapshot). */
export const FREE_SNAPSHOT_HREF = '/client/onboarding/snapshot'

export function FirstRunWizard({
  surveyStepsDone,
  docsCount,
  hasDiagnostic,
  griLocked = false,
}: {
  surveyStepsDone: number
  docsCount: number
  hasDiagnostic: boolean
  /** Полный GRI закрыт для аккаунта (решение сервера, lib/access/decision.ts). */
  griLocked?: boolean
}) {
  const surveyDone = surveyStepsDone > 0
  const docsDone = docsCount > 0

  const steps = [
    {
      done: surveyDone,
      title: 'Заполните анкету',
      desc: surveyDone
        ? `Заполнено шагов: ${surveyStepsDone}. Можно дополнить в любой момент.`
        : 'Расскажите о продажах, финансах и команде — основа диагностики.',
      href: '/client/onboarding',
      cta: surveyDone ? 'Продолжить анкету' : 'Заполнить анкету',
      icon: 'edit_note',
    },
    {
      done: docsDone,
      title: 'Загрузите документы',
      desc: docsDone
        ? `Загружено файлов: ${docsCount}. ИИ уже их учитывает.`
        : 'P&L, выгрузки из CRM, отчёты — ИИ извлечёт метрики автоматически.',
      href: '/client/onboarding/documents',
      cta: docsDone ? 'Добавить ещё' : 'Загрузить файлы',
      icon: 'upload_file',
    },
    griLocked
      ? {
          done: hasDiagnostic,
          title: 'Получите экспресс-оценку',
          desc: '«Снимок бизнеса» по вашей анкете — бесплатно. Полный GRI и Точка А — в платном доступе.',
          href: FREE_SNAPSHOT_HREF,
          cta: 'Открыть снимок бизнеса',
          icon: 'insights',
        }
      : {
          done: hasDiagnostic,
          title: 'Получите Точку А и GRI',
          desc: hasDiagnostic
            ? 'Диагностика готова — смотрите разбор и план роста.'
            : 'Индекс готовности к росту по 7 блокам и план на 90 дней.',
          href: '/gri',
          cta: hasDiagnostic ? 'Открыть GRI' : 'Пройти GRI',
          icon: 'radar',
        },
  ]

  const completed = steps.filter((s) => s.done).length
  // Index of the step the user should act on next (first not-done).
  const currentIdx = steps.findIndex((s) => !s.done)

  return (
    // data-first-run-wizard: the mascot suppresses its greeting while the
    // wizard owns onboarding; data-mascot-avoid keeps the cat off the CTA row.
    <section
      data-first-run-wizard
      data-mascot-avoid
      className="bg-surface-container-low border border-primary/15 rounded-2xl p-6 lg:p-8"
    >
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <p className="text-[11px] font-mono text-primary/70 uppercase tracking-[0.2em] mb-2">
            С чего начать
          </p>
          <h2 className="font-headline text-xl lg:text-2xl font-extrabold text-on-surface">
            {griLocked ? '3 шага до первой оценки бизнеса' : '3 шага до вашего GRI'}
          </h2>
          <p className="text-sm text-on-surface-variant mt-1.5 max-w-lg leading-relaxed">
            {griLocked
              ? 'Заполните анкету и загрузите документы — получите бесплатный «Снимок бизнеса».'
              : 'Пройдите диагностику готовности к росту — увидите точку А, разрывы и план пути к $2M.'}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">Прогресс</p>
          <p className="font-mono text-2xl font-bold text-primary">{completed}/3</p>
        </div>
      </div>

      <ol className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {steps.map((s, i) => {
          const isCurrent = i === currentIdx
          return (
            <li key={s.title}>
              <Link
                href={s.href}
                className={`group flex h-full flex-col gap-3 rounded-xl border p-4 transition-all ${
                  s.done
                    ? 'border-primary/25 bg-primary/[0.04]'
                    : isCurrent
                      ? 'border-primary/40 bg-primary/[0.06] hover:border-primary/60'
                      : 'border-white/[0.06] bg-surface-container hover:border-primary/20'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                      s.done ? 'bg-primary text-on-primary' : 'bg-surface-container-high text-on-surface-variant'
                    }`}
                  >
                    {s.done ? <span className="material-symbols-outlined text-[18px]">check</span> : i + 1}
                  </span>
                  <span className="material-symbols-outlined text-lg text-on-surface-variant/60 group-hover:text-primary transition-colors">
                    {s.icon}
                  </span>
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-on-surface">{s.title}</p>
                  <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">{s.desc}</p>
                </div>
                <span className={`inline-flex items-center gap-1 text-xs font-medium ${s.done ? 'text-on-surface-variant' : 'text-primary'}`}>
                  {s.cta}
                  <span className="material-symbols-outlined text-sm group-hover:translate-x-0.5 transition-transform">arrow_forward</span>
                </span>
              </Link>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
