'use client'

import Link from 'next/link'
import { FieldCalc } from '@/components/survey/FieldCalc'
import { CalcTracker } from '@/components/onboarding/CalcTracker'
import { POINT_A_TOO_LITTLE_DATA, PRIMARY_POINT_A_HINT, PRIMARY_POINT_A_LABEL, pointAStatus } from '@/lib/point-a/v4/primary'
import type { RecommendedBlock } from '@/lib/survey/blocks'
import { SNAPSHOT_CALC_IDS, expressBlindSpots, snapshotFigures, type SnapshotPointA } from '@/lib/survey/snapshot'

const CARD = 'rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 sm:p-5'
const H = 'text-sm font-semibold text-on-surface'

/**
 * «Снимок бизнеса» (spec 2026-10-23 §7.3): the owner's five numbers,
 * approximate calculations, blind spots, the PRIMARY Point A (v4 only —
 * v1 scores, where an unanswered question is 0, are never shown here) and
 * what to do next (three recommended blocks, documents, the full questionnaire).
 */
export function BusinessSnapshot({ answers, pointA, recommended, chatEnabled = false }: {
  answers: Readonly<Record<string, unknown>>
  pointA: SnapshotPointA
  recommended: readonly RecommendedBlock[]
  chatEnabled?: boolean
}) {
  const figures = snapshotFigures(answers)
  const spots = expressBlindSpots(answers)
  const status = pointA.state === 'ready' ? pointAStatus(pointA.snapshot ?? null) : null
  const blocks = (pointA.snapshot?.blocks ?? []).filter((b) => !b.hiddenForClient && !b.informational)

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[11px] font-mono uppercase tracking-wider text-primary/80">Быстрый старт</p>
        <h1 className="font-headline text-2xl font-bold text-on-surface">Снимок бизнеса</h1>
        <p className="mt-1 text-xs text-on-surface-variant">Ваши цифры и приблизительные расчёты по ним — без сравнения с отраслью.</p>
      </div>

      <section aria-labelledby="snap-figures" className={CARD}>
        <h2 id="snap-figures" className={H}>Пять цифр</h2>
        <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {figures.map((f) => (
            <div key={f.id} data-figure={f.id} className="min-w-0 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
              <dt className="text-[11px] text-on-surface-variant">{f.label}</dt>
              {f.value ? (
                <dd className="mt-0.5 break-words text-lg font-bold text-on-surface">{f.value}</dd>
              ) : (
                <dd className="mt-0.5 text-sm text-on-surface-variant">
                  {f.unknown ? 'не знаю' : 'нет данных'} ·{' '}
                  <Link href={`/client/onboarding/express?key=${f.askKey}`} className="inline-flex min-h-[32px] items-center font-semibold text-primary hover:underline">ответить</Link>
                </dd>
              )}
              {f.value && f.note && <dd className="mt-0.5 text-[11px] text-on-surface-variant">{f.note}</dd>}
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="snap-calcs" className={CARD}>
        <h2 id="snap-calcs" className={H}>Приблизительные расчёты</h2>
        <CalcTracker><FieldCalc ids={SNAPSHOT_CALC_IDS} answers={answers} /></CalcTracker>
      </section>

      <section aria-labelledby="snap-spots" className={CARD}>
        <h2 id="snap-spots" className={H}>Слепые зоны</h2>
        <p className="mt-2 text-xs leading-snug text-on-surface-variant">
          {spots.text ?? 'Вы знаете все цифры быстрого старта, которые ответили. Ответы «не знаю» появятся здесь — это первое, что стоит начать считать.'}
        </p>
      </section>

      <section aria-labelledby="snap-point-a" className={CARD} aria-live="polite">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="snap-point-a" className={H}>Точка А</h2>
          {status?.kind === 'primary' && (
            <span className="rounded-full bg-amber-300/10 px-2.5 py-0.5 text-[11px] font-semibold text-amber-200">{PRIMARY_POINT_A_LABEL}</span>
          )}
        </div>
        {(pointA.state === 'loading' || pointA.state === 'pending') && (
          <p className="mt-2 flex items-center gap-2 text-xs text-on-surface-variant">
            <span className="material-symbols-outlined animate-spin text-base text-primary" aria-hidden="true">progress_activity</span>
            Считаем Точку А — до минуты
          </p>
        )}
        {pointA.state === 'none' && (
          <p className="mt-2 text-xs text-on-surface-variant">Точка А ещё не посчитана — нажмите «Готово» в экспрессе, и мы её сформируем.</p>
        )}
        {status && status.kind !== 'none' && (
          <div className="mt-2 space-y-3">
            {status.kind === 'too_little' ? (
              <p className="text-sm text-on-surface">{POINT_A_TOO_LITTLE_DATA}</p>
            ) : (
              <p className="text-sm text-on-surface">
                Общий балл: <b className="text-2xl font-bold">{status.overall}</b> из 100
                {pointA.snapshot?.confidence != null && <span className="ml-2 text-[11px] text-on-surface-variant">достоверность {Math.round(pointA.snapshot.confidence * 100)} %</span>}
              </p>
            )}
            {status.kind === 'primary' && <p className="text-xs text-on-surface-variant">{PRIMARY_POINT_A_HINT}</p>}
            <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {blocks.map((b) => (
                <li key={b.key} className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.02] px-3 py-2 text-xs">
                  <span className="text-on-surface">{b.title}</span>
                  {b.score === null ? <span className="text-amber-200">данных не хватает</span> : <span className="font-semibold text-on-surface">{b.score}</span>}
                </li>
              ))}
            </ul>
            <Link href="/client/point-a" className="inline-flex min-h-[44px] items-center text-sm font-semibold text-primary hover:underline">Открыть Точку А →</Link>
          </div>
        )}
      </section>

      <section aria-labelledby="snap-next" className={CARD}>
        <h2 id="snap-next" className={H}>Что дальше</h2>
        {recommended.length > 0 && (
          <ul className="mt-3 space-y-2">
            {recommended.map((r) => (
              <li key={r.block.id}>
                <Link href={`/client/onboarding/blocks/${r.block.id}`} className="flex min-h-[44px] items-start gap-3 rounded-xl border border-primary/20 bg-primary/[0.04] px-3 py-2.5 hover:bg-primary/[0.08]">
                  <span className="material-symbols-outlined mt-0.5 text-base text-primary" aria-hidden="true">add_task</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-on-surface">{r.block.title} <span className="font-normal text-on-surface-variant">· ~{r.block.minutes} мин</span></span>
                    <span className="block text-[11px] text-on-surface-variant">Что даст: {r.block.gives}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Link href="/client/onboarding/documents" className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-white/[0.08] px-3 text-sm text-on-surface hover:bg-white/[0.04]">
            <span className="material-symbols-outlined text-base text-primary" aria-hidden="true">cloud_upload</span>Загрузить выгрузки — заполним часть сами
          </Link>
          <Link href="/client/onboarding/blocks" className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-white/[0.08] px-3 text-sm text-on-surface hover:bg-white/[0.04]">
            <span className="material-symbols-outlined text-base text-primary" aria-hidden="true">view_agenda</span>Все блоки
          </Link>
          {chatEnabled && (
            <Link href="/client/onboarding/chat" className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-white/[0.08] px-3 text-sm text-on-surface hover:bg-white/[0.04]">
              <span className="material-symbols-outlined text-base text-primary" aria-hidden="true">forum</span>Продолжить в беседе с помощником
            </Link>
          )}
        </div>
        <p className="mt-3 text-[11px] leading-snug text-on-surface-variant">
          Полная анкета — основная: эксперт получит полную картину после её отправки. Ответы быстрого старта уже в ней —{' '}
          <Link href="/client/onboarding?step=1" className="text-primary hover:underline">открыть полную анкету</Link>.
        </p>
      </section>
    </div>
  )
}
