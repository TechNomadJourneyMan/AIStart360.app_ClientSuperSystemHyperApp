'use client'

import Link from 'next/link'
import type { PointAPageState } from '@/hooks/usePointAState'
import { formatRelativeRuLong } from '@/components/point-a/executive-overview-model'
import { CARD, CARD_TITLE, Icon, toneColor } from './ui'

/** GRI — readiness for growth, a separate indicator (spec §4.6), on the same 0–100 scale. */
export function GriCard({ gri }: { gri: PointAPageState['gri'] }) {
  return (
    <section className={CARD} aria-labelledby="pa-gri">
      <p id="pa-gri" className={CARD_TITLE}>GRI — готовность к росту</p>
      <div className="mt-2 flex items-end gap-2">
        <span className="font-mono text-3xl font-bold" style={{ color: toneColor(gri.index100) }}>{gri.index100 ?? '—'}</span>
        <span className="mb-1 font-mono text-[10px] text-on-surface-variant">из 100</span>
      </div>
      <p className="mt-2 text-xs text-on-surface-variant">
        Точка А — где бизнес сейчас. GRI — насколько он готов расти. Это разные показатели: сильная Точка А не гарантирует готовность к рывку.
      </p>
      <Link href="/gri" className="mt-3 inline-flex text-xs font-mono text-primary/80 hover:text-primary">
        {gri.index100 === null ? 'Пройти оценку GRI →' : `Оценка ${formatRelativeRuLong(gri.assessedAt)} · открыть →`}
      </Link>
    </section>
  )
}

export function BenchmarksCard({ benchmarks }: { benchmarks: PointAPageState['benchmarks'] }) {
  if (!benchmarks) return null
  return (
    <section className={CARD} aria-labelledby="pa-bench">
      <p id="pa-bench" className={CARD_TITLE}>Сравнение с отраслью</p>
      <p className="mt-1 text-[11px] text-on-surface-variant">{benchmarks.industry} · {benchmarks.source}</p>
      <ul className="mt-3 space-y-2">
        {benchmarks.blocks.map((b) => (
          <li key={b.key} className="text-xs">
            <div className="flex justify-between text-on-surface"><span>{b.title}</span><span className="font-mono">{b.score ?? '—'} / {b.benchmark}</span></div>
            <div className="relative mt-1 h-1.5 rounded-full bg-white/[0.06]">
              {b.score !== null && <div className="absolute inset-y-0 left-0 rounded-full bg-primary/70" style={{ width: `${b.score}%` }} />}
              <div className="absolute -top-0.5 h-2.5 w-0.5 bg-on-surface" style={{ left: `${b.benchmark}%` }} title={`Отрасль: ${b.benchmark}`} />
            </div>
            {b.rating && <p className="mt-0.5 text-[10px] text-on-surface-variant">{b.rating}</p>}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function SourcesCard({ sources }: { sources: PointAPageState['sources'] }) {
  return (
    <section className={CARD} aria-labelledby="pa-sources">
      <p id="pa-sources" className={CARD_TITLE}>Мои данные</p>
      <ul className="mt-3 space-y-2 text-sm">
        <li className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-on-surface"><Icon name="edit_note" className="text-[16px] text-primary/70" />Анкета</span>
          <Link href="/client/onboarding" className="font-mono text-xs text-primary/80 hover:text-primary">{sources.survey.completed}/{sources.survey.total} шагов</Link>
        </li>
        <li className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-on-surface"><Icon name="description" className="text-[16px] text-primary/70" />Документы</span>
          <Link href="/client/onboarding/documents" className="font-mono text-xs text-primary/80 hover:text-primary">
            {sources.documents.parsed} обработано{sources.documents.processing ? ` · ${sources.documents.processing} в работе` : ''}{sources.documents.failed ? ` · ${sources.documents.failed} с ошибкой` : ''}
          </Link>
        </li>
        <li className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-on-surface"><Icon name="monitoring" className="text-[16px] text-primary/70" />Метрики</span>
          <Link href="/metrics" className="font-mono text-xs text-primary/80 hover:text-primary">{sources.metrics}</Link>
        </li>
      </ul>
    </section>
  )
}
