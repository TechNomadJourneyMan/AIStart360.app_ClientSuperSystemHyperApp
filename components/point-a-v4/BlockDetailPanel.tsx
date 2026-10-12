'use client'

/**
 * «Подробнее» of a Point A block: what the section is, how its score was
 * made (every check: answered or not, points, what was found), the section's
 * real metrics (value, period · source, dynamics, norm, what / why / how),
 * what is missing and what to do. A side sheet on desktop, a bottom sheet on
 * mobile.
 */
import { useEffect } from 'react'
import Link from 'next/link'
import { useBlockDetail } from '@/hooks/usePointAState'
import type { BlockDetail } from '@/lib/point-a/v4/metric-views'
import { CHECK_LABELS } from '@/lib/point-a/v4/check-labels'
import { CHIP, ConfidenceBar, Icon, toneColor } from './ui'
import { MetricRow } from './MetricParts'
import { cn } from '@/lib/utils'

function Body({ d }: { d: BlockDetail }) {
  const b = d.block
  const withValue = d.metrics.filter((m) => m.value !== null)
  const without = d.metrics.filter((m) => m.value === null)
  return (
    <div className="space-y-5">
      <p className="text-sm text-on-surface-variant">{d.description}</p>

      {b && (
        <div className="grid grid-cols-[auto_1fr] items-center gap-4">
          <div className="text-center">
            {b.score !== null
              ? <span className="font-mono text-4xl font-bold" style={{ color: toneColor(b.score) }}>{b.score}</span>
              : b.hypothesis
                ? <span className="font-mono text-4xl font-bold text-on-surface-variant">~{b.hypothesis.score}</span>
                : <span className="font-mono text-2xl text-on-surface-variant">—</span>}
            <p className="font-mono text-[10px] text-on-surface-variant">из 100</p>
          </div>
          <div className="space-y-2">
            <ConfidenceBar value={b.coverage} label="Полнота данных" />
            <ConfidenceBar value={b.confidence} label="Достоверность" />
            {!b.informational && <p className="text-[11px] text-on-surface-variant">Вес в общем балле: {Math.round(b.weight * 100)}%</p>}
          </div>
        </div>
      )}
      {b?.hypothesis && (
        <div className="rounded-xl border border-violet-400/20 bg-violet-400/[0.05] p-3 text-xs text-on-surface">
          <span className={cn(CHIP, 'mb-1 bg-violet-400/10 text-violet-200')}>гипотеза AI · не факт</span>
          <p>{b.hypothesis.rationale}</p>
        </div>
      )}
      {b && b.conflicts.length > 0 && (
        <p className="rounded-xl border border-amber-300/20 bg-amber-300/[0.05] p-3 text-xs text-amber-100">
          По показателям раздела есть расхождение в данных — достоверность снижена. Решите его в блоке «Требует внимания».
        </p>
      )}

      <section>
        <h3 className="mb-2 font-mono text-[11px] uppercase tracking-wider text-on-surface-variant">Показатели раздела · {withValue.length} из {d.metrics.length} с данными</h3>
        {withValue.length > 0 ? (
          <ul className="space-y-2">{withValue.map((m) => <MetricRow key={m.id} m={m} />)}</ul>
        ) : <p className="text-sm text-on-surface-variant">По этому разделу пока нет значений.</p>}
        {without.length > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs font-mono text-primary/80 hover:text-primary">Без данных: {without.length} — где взять</summary>
            <ul className="mt-2 space-y-2">{without.map((m) => <MetricRow key={m.id} m={m} />)}</ul>
          </details>
        )}
      </section>

      {b && (
        <section>
          <h3 className="mb-2 font-mono text-[11px] uppercase tracking-wider text-on-surface-variant">Из чего сложился балл</h3>
          <ul className="space-y-1.5">
            {b.checks.filter((c) => !c.excluded).map((c) => (
              <li key={c.id} className="flex items-start gap-2 text-sm">
                <Icon
                  name={!c.answered ? 'help' : c.earned === c.max ? 'check_circle' : c.earned > 0 ? 'adjust' : 'cancel'}
                  className={cn('mt-0.5 text-[16px]', !c.answered ? 'text-on-surface-variant' : c.earned === c.max ? 'text-primary' : c.earned > 0 ? 'text-amber-300' : 'text-red-300')}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between gap-2">
                    <span className="text-on-surface">{CHECK_LABELS[c.id] ?? c.id}</span>
                    <span className="font-mono text-xs text-on-surface-variant">{c.answered ? `${c.earned}/${c.max}` : 'нет ответа'}</span>
                  </div>
                  {c.answered && c.issue && <p className="text-xs text-amber-100/90">{c.issue}</p>}
                  {!c.answered && c.missing && <p className="text-xs text-on-surface-variant">{c.missing}</p>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {b && b.recommendations.length > 0 && (
        <section>
          <h3 className="mb-2 font-mono text-[11px] uppercase tracking-wider text-on-surface-variant">Что сделать</h3>
          <ul className="space-y-1.5">{b.recommendations.map((r, i) => <li key={i} className="flex gap-2 text-sm text-on-surface"><Icon name="bolt" className="mt-0.5 text-[16px] text-primary" />{r}</li>)}</ul>
        </section>
      )}

      {b && b.needs.length > 0 && (
        <section className="flex flex-wrap gap-2">
          <Link href="/client/onboarding" className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-xs text-on-surface-variant hover:text-on-surface"><Icon name="edit_note" className="text-[16px]" />Ответить в анкете</Link>
          <Link href="/client/onboarding/documents" className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-xs text-on-surface-variant hover:text-on-surface"><Icon name="upload_file" className="text-[16px]" />Загрузить документы</Link>
        </section>
      )}
    </div>
  )
}

export function BlockDetailPanel({ blockKey, title, onClose, preview }: { blockKey: string; title: string; onClose: () => void; preview?: BlockDetail }) {
  const live = useBlockDetail(preview ? null : blockKey)
  const data = preview ?? live.data
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-stretch sm:justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <aside role="dialog" aria-modal="true" aria-label={`Раздел «${title}»`} onClick={(e) => e.stopPropagation()}
        className="relative z-10 w-full sm:max-w-xl max-h-[92vh] sm:max-h-none sm:h-full overflow-y-auto bg-surface-container-low border-t sm:border-t-0 sm:border-l border-white/[0.08] rounded-t-2xl sm:rounded-none p-5">
        <div className="sticky -top-5 -mx-5 -mt-5 mb-4 flex items-center justify-between bg-surface-container-low/95 px-5 py-4 backdrop-blur">
          <h2 className="font-headline text-lg font-bold text-on-surface">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="h-9 w-9 rounded-lg text-on-surface-variant hover:bg-white/[0.06]"><Icon name="close" className="text-xl" /></button>
        </div>
        {data ? <Body d={data} /> : live.isError ? (
          <p className="text-sm text-on-surface" role="alert">Не удалось загрузить раздел.</p>
        ) : (
          <div className="space-y-3" aria-busy="true">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 rounded-xl bg-white/[0.03] animate-pulse" />)}</div>
        )}
      </aside>
    </div>
  )
}
