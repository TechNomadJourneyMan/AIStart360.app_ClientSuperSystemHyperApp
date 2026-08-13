import Link from 'next/link'
import { ArrowRight, CheckCircle2, Database, LockKeyhole, Route, Sparkles, Target } from 'lucide-react'
import type { ReactNode } from 'react'
import type { JourneyState } from '@/lib/journey/schema'
import { formatDate, formatPeriod } from '@/lib/store/format'
import type { StoreOverview } from '@/lib/store/types'
import { WidgetRenderer } from './widgets/WidgetRenderer'

export function StoreJourneyView({
  state,
  overview,
}: {
  state: JourneyState
  overview: StoreOverview
}) {
  const next = state.roadmap.find((item) => item.status === 'next') ?? state.roadmap[0]

  return (
    <main className="min-h-screen bg-background text-on-surface">
      <header className="border-b border-white/10 bg-surface-container-lowest/95">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
                <span>AIStart360 Journey</span>
                <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 tracking-normal">
                  Store · live read-only
                </span>
              </div>
              <h1 className="mt-2 truncate font-headline text-2xl font-extrabold sm:text-3xl">
                {state.companyName || 'Интернет-магазин'}
              </h1>
              <p className="mt-1 text-sm text-on-surface-variant">
                Тот же бизнес и те же опубликованные данные — в управленческом пути A → B.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Link
                href="/store"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/10 px-4 text-sm font-semibold text-on-surface transition-colors hover:border-primary/30 hover:text-primary"
              >
                Вернуться в Магазин
              </Link>
              {overview.source === 'empty' && (
                <Link
                  href="/store/imports"
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-on-primary"
                >
                  Подключить данные
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              )}
            </div>
          </div>

          <dl className="grid gap-2 text-xs text-on-surface-variant sm:grid-cols-3">
            <StatusItem label="Период" value={formatPeriod(overview.period)} />
            <StatusItem label="Версия" value={overview.versionLabel ?? 'Нет утверждённой версии'} />
            <StatusItem label="Актуально" value={formatDate(overview.asOf)} />
          </dl>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] space-y-7 px-4 py-6 sm:px-6 lg:px-8">
        <aside className="flex items-start gap-3 rounded-2xl border border-primary/15 bg-primary/[0.05] p-4 text-xs text-on-surface-variant" aria-label="Безопасность данных">
          <LockKeyhole className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <p>
            Journey читает агрегаты непосредственно из Store текущего аккаунта. Данные не копируются во вторую компанию, localStorage или клиентский query-cache.
          </p>
        </aside>

        <section aria-labelledby="journey-path-title">
          <div className="mb-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">Живой управленческий маршрут</p>
            <h2 id="journey-path-title" className="mt-1 font-headline text-xl font-bold">Точка A → действие → Точка B</h2>
          </div>
          <div className="grid gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr] lg:items-stretch">
            <JourneyStep
              icon={<Database className="size-5" aria-hidden />}
              eyebrow="Точка A · подтверждено"
              title={state.companyName || 'Текущий бизнес'}
              text={state.facts.length
                ? `${state.facts.length} фактов из опубликованного Store-контура.`
                : 'Опубликованные показатели пока не найдены.'}
              tone="confirmed"
            />
            <StepArrow />
            <JourneyStep
              icon={<Route className="size-5" aria-hidden />}
              eyebrow="Следующий шаг"
              title={next?.title ?? 'Собрать фактический контур'}
              text={next?.description ?? 'Сначала нужны подтверждённые данные.'}
              tone="active"
            />
            <StepArrow />
            <JourneyStep
              icon={<Target className="size-5" aria-hidden />}
              eyebrow="Точка B · решение владельца"
              title="Цель ещё не задана"
              text="Journey не придумывает KPI: выберите показатель, целевое значение и срок."
              tone="pending"
            />
          </div>
        </section>

        <section aria-labelledby="journey-facts-title" className="rounded-2xl border border-white/10 bg-surface-container-low p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">Точка A</p>
              <h2 id="journey-facts-title" className="mt-1 font-headline text-lg font-bold">Подтверждённые факты</h2>
            </div>
            <span className="rounded-full border border-primary/15 bg-primary/[0.06] px-2.5 py-1 text-[10px] text-primary">
              {state.facts.length} фактов
            </span>
          </div>
          {state.facts.length ? (
            <dl className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {state.facts.map((fact) => (
                <div key={fact.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                  <dt className="text-[10px] uppercase tracking-wide text-on-surface-variant">{fact.label}</dt>
                  <dd className="mt-1.5 text-sm font-semibold tabular-nums text-on-surface">{fact.value}</dd>
                  <p className="mt-1 line-clamp-1 text-[10px] text-on-surface-variant">{fact.sourceLabel}</p>
                </div>
              ))}
            </dl>
          ) : (
            <div className="mt-4 rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-on-surface-variant">
              Нет опубликованных фактов. Journey не подставляет демонстрационные показатели.
            </div>
          )}
          {overview.source === 'empty' && state.facts.length > 0 && (
            <p className="mt-3 text-xs text-on-surface-variant">
              Операционные показатели не опубликованы. Journey не подставляет демонстрационные показатели или нули.
            </p>
          )}
        </section>

        <section aria-labelledby="journey-modules-title">
          <div className="mb-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">Модули Journey</p>
            <h2 id="journey-modules-title" className="mt-1 font-headline text-xl font-bold">Что видно по текущей публикации</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {state.widgets.map((widget) => {
              return (
                <article key={widget.id} className="rounded-2xl border border-white/10 bg-surface-container-lowest shadow-card">
                  <header className="flex min-h-12 items-center gap-2 border-b border-white/[0.06] px-4">
                    <Sparkles className="size-4 text-primary" aria-hidden />
                    <h3 className="text-sm font-semibold">{widget.title}</h3>
                  </header>
                  <div className="p-4">
                    <WidgetRenderer widget={widget} />
                  </div>
                </article>
              )
            })}
          </div>
        </section>

        <footer className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-surface-container-low p-4 text-xs text-on-surface-variant sm:flex-row sm:items-center sm:justify-between">
          <span className="inline-flex items-center gap-2">
            <CheckCircle2 className="size-4 text-primary" aria-hidden />
            Обновляется при каждом открытии из Store текущего аккаунта.
          </span>
          <Link href="/store" className="font-semibold text-primary hover:underline">
            Открыть полный Store Control Center
          </Link>
        </footer>
      </div>
    </main>
  )
}

function StatusItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2">
      <dt className="text-[10px] uppercase tracking-wide">{label}</dt>
      <dd className="mt-0.5 truncate font-medium text-on-surface">{value}</dd>
    </div>
  )
}

function JourneyStep({
  icon,
  eyebrow,
  title,
  text,
  tone,
}: {
  icon: ReactNode
  eyebrow: string
  title: string
  text: string
  tone: 'confirmed' | 'active' | 'pending'
}) {
  const toneClass = tone === 'confirmed'
    ? 'border-primary/25 bg-primary/[0.06]'
    : tone === 'active'
      ? 'border-secondary/25 bg-secondary/[0.05]'
      : 'border-white/10 bg-surface-container-low'
  return (
    <article className={`rounded-2xl border p-4 ${toneClass}`}>
      <div className="flex items-center gap-2 text-primary">
        {icon}
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em]">{eyebrow}</p>
      </div>
      <h3 className="mt-3 text-base font-bold">{title}</h3>
      <p className="mt-1.5 text-xs leading-relaxed text-on-surface-variant">{text}</p>
    </article>
  )
}

function StepArrow() {
  return (
    <div className="hidden items-center justify-center text-primary/60 lg:flex" aria-hidden>
      <ArrowRight className="size-5" />
    </div>
  )
}
