'use client'

// «Приблизительный расчёт по вашим цифрам» under a questionnaire field
// (spec 2026-10-23 §9.3, PO decision 3). Only the owner's own numbers — no
// industry comparison; nothing is written anywhere.
//
//   <FieldCalc forKey="s7_leads_per_month" answers={data} />   — the calcs of that field
//   <FieldCalc ids={['goal_pace']} answers={data} />           — by id
//
// Recomputes 300 ms after the inputs stop changing (in the browser, no
// network). The chart is loaded lazily (next/dynamic, ssr:false) and has a
// hidden table with the same numbers for screen readers.
import { useEffect, useId, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import {
  calcsForKey, chartRows, computeCalcs, isCalcReady, type CalcChart, type CalcId, type CalcResult,
} from '@/lib/survey/calcs'

const FieldCalcChart = dynamic(() => import('./FieldCalcChart'), {
  ssr: false,
  loading: () => <div className="h-[120px] w-full animate-pulse rounded-lg bg-white/[0.03]" aria-hidden="true" />,
})

export const FIELD_CALC_CAPTION = 'Приблизительный расчёт по вашим цифрам'

/** The value 300 ms after it stopped changing; the first render uses it at once. */
function useSettled<T>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return settled
}

export interface FieldCalcProps {
  /** The wizard's flat answer map (the step form's `data`). */
  answers: Readonly<Record<string, unknown>>
  /** The field the block sits under: its calcs (lib/survey/calcs CALCS_BY_KEY). */
  forKey?: string
  /** Explicit calcs (instead of / together with `forKey` as the context key). */
  ids?: readonly CalcId[]
  className?: string
}

export function FieldCalc({ answers, forKey, ids, className = '' }: FieldCalcProps) {
  const settled = useSettled(answers)
  const idsKey = ids?.join(',') ?? ''
  const results = useMemo(
    () => (idsKey ? computeCalcs(idsKey.split(',') as CalcId[], settled, { key: forKey }) : forKey ? calcsForKey(forKey, settled) : []),
    [idsKey, forKey, settled],
  )
  if (results.length === 0) return null
  return (
    <div className={`mt-3 space-y-2 ${className}`}>
      {results.map((r) => <CalcCard key={r.id} result={r} />)}
    </div>
  )
}

const SHARE_COLORS = ['bg-primary', 'bg-tertiary-container', 'bg-secondary', 'bg-on-surface-variant/60', 'bg-primary/40']

function ShareStrip({ chart }: { chart: Extract<CalcChart, { kind: 'share' }> }) {
  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-white/[0.04]" aria-hidden="true">
        {chart.series.map((s, i) => (
          <div key={s.label} className={SHARE_COLORS[i % SHARE_COLORS.length]} style={{ width: `${Math.max(0, s.value)}%` }} />
        ))}
      </div>
      <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-on-surface-variant">
        {chart.series.map((s, i) => (
          <li key={s.label} className="flex items-center gap-1">
            <span className={`inline-block h-2 w-2 rounded-full ${SHARE_COLORS[i % SHARE_COLORS.length]}`} aria-hidden="true" />
            {s.label} — {String(s.value).replace('.', ',')} %
          </li>
        ))}
      </ul>
    </div>
  )
}

function ChartBlock({ result, chart }: { result: CalcResult; chart: CalcChart }) {
  if (chart.kind === 'share') return <figure className="mt-2"><ShareStrip chart={chart} /></figure>
  const table = chartRows(chart)
  return (
    <figure className="mt-2">
      <FieldCalcChart chart={chart} />
      {chart.kind === 'pairs' && (
        <figcaption className="mt-1 flex gap-3 text-[10px] text-on-surface-variant/80" aria-hidden="true">
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-secondary" />{chart.names[0]}</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-primary" />{chart.names[1]}</span>
        </figcaption>
      )}
      <table className="sr-only">
        <caption>{result.title}: цифры графика</caption>
        <thead>
          <tr>{table.head.map((h, i) => <th key={i} scope="col">{h}</th>)}</tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row[0]}>
              <th scope="row">{row[0]}</th>
              {row.slice(1).map((c, i) => <td key={i}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

function CalcCard({ result }: { result: CalcResult }) {
  const titleId = useId()
  if (!isCalcReady(result)) {
    return (
      <p data-calc={result.id} data-calc-state="hidden" className="flex items-start gap-1.5 text-[11px] leading-snug text-on-surface-variant/60">
        <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">calculate</span>
        <span>Чтобы увидеть расчёт «{result.title}», укажите: {result.missing.join(', ')}.</span>
      </p>
    )
  }
  const [headline, ...rest] = result.lines
  return (
    <section
      aria-labelledby={titleId}
      data-calc={result.id}
      data-calc-state="ready"
      className="min-w-0 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"
    >
      <p className="flex flex-wrap items-center gap-x-1.5 text-[10px] font-mono uppercase tracking-wider text-on-surface-variant/70">
        <span className="material-symbols-outlined text-sm leading-none text-primary/80" aria-hidden="true">calculate</span>
        <span id={titleId} className="text-on-surface-variant">{result.title}</span>
        <span aria-hidden="true">·</span>
        <span>{FIELD_CALC_CAPTION}</span>
      </p>
      <p className="mt-1 break-words text-sm font-semibold leading-snug text-on-surface">{headline}</p>
      {rest.map((l) => <p key={l} className="mt-0.5 break-words text-xs leading-snug text-on-surface-variant">{l}</p>)}
      {result.chart && <ChartBlock result={result} chart={result.chart} />}
      {result.missing.length > 0 && (
        <p className="mt-1.5 text-[11px] leading-snug text-on-surface-variant/60">Точнее, когда будет: {result.missing.join(', ')}.</p>
      )}
      <p className="mt-1.5 break-words text-[10px] leading-snug text-on-surface-variant/60">из: {result.sources.join(', ')}</p>
      <details className="mt-1 text-[11px] text-on-surface-variant/80">
        <summary className="inline-flex min-h-[24px] cursor-pointer select-none items-center text-primary/80 hover:text-primary">Как посчитано</summary>
        <p className="mt-1 leading-snug">{result.how} Это приблизительный расчёт: без сравнения с отраслью, эксперт может его уточнить.</p>
      </details>
    </section>
  )
}

export default FieldCalc
