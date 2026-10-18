'use client'

/**
 * components/point-b/CashChart.tsx — the cash of one scenario by month (plan Ф3 Task 5, spec
 * §15.2): the cash line, the zero line, the liquidity reserve, the lowest point and the first
 * month below zero. A touch or a pointer reads the cash AND the profit of the nearest month — they
 * differ on purpose. Plain SVG; the geometry comes from cashChartModel (pure, no NaN).
 * Colours come from the project tokens through currentColor.
 */
import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Icon } from '@/components/point-a-v4/ui'
import type { ScenarioFinance } from '@/lib/point-b/model/types'
import { cashGeometry, cashReadout, cashSummary, nearestCashMonth } from './cashChartModel'
import { fmtMoney } from './overviewModel'

const HEIGHT = 240

export default function CashChart({ finance, scenarioLabel }: { finance: ScenarioFinance; scenarioLabel: string }) {
  const uid = useId()
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(560)
  const [month, setMonth] = useState<number | null>(null)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => { if (el.clientWidth > 0) setWidth(Math.round(el.clientWidth)) }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const geo = useMemo(() => cashGeometry(finance, width, HEIGHT), [finance, width])

  if (!geo) {
    return (
      <div className="rounded-xl border border-dashed border-white/[0.1] p-4 text-center text-xs text-on-surface-variant">
        <Icon name="show_chart" className="mb-1 block text-2xl text-on-surface-variant/50" />
        График кассы недоступен: нет данных по месяцам.
      </div>
    )
  }

  const onPointer = (e: ReactPointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const scale = r.width > 0 ? geo.width / r.width : 1
    setMonth(nearestCashMonth(geo, (e.clientX - r.left) * scale))
  }
  const hoverX = month === null ? null : geo.plot.left + ((month - 1) / (geo.months - 1)) * (geo.plot.right - geo.plot.left)
  const clip = `${uid}-below-zero`

  return (
    <figure className="space-y-2">
      <div ref={box} className="w-full">
        <svg
          role="img"
          aria-label={cashSummary(finance, scenarioLabel)}
          width={geo.width}
          height={geo.height}
          viewBox={`0 0 ${geo.width} ${geo.height}`}
          className="block max-w-full touch-pan-y select-none"
          onPointerMove={onPointer}
          onPointerDown={onPointer}
          onPointerLeave={() => setMonth(null)}
        >
          <defs>
            <clipPath id={clip}>
              <rect x={geo.plot.left} y={geo.zeroY} width={geo.plot.right - geo.plot.left} height={Math.max(0, geo.plot.bottom - geo.zeroY)} />
            </clipPath>
          </defs>

          <g className="text-outline-variant">
            {geo.yTicks.map((t, i) => (
              <line key={i} x1={geo.plot.left} x2={geo.plot.right} y1={t.y} y2={t.y} stroke="currentColor" strokeOpacity={0.4} strokeDasharray="2 4" />
            ))}
          </g>
          <g className="font-mono text-on-surface-variant" fill="currentColor" fontSize={10}>
            {geo.yTicks.map((t, i) => <text key={i} x={geo.plot.left - 8} y={t.y + 3} textAnchor="end">{t.label}</text>)}
            {geo.xTicks.map((t, i) => <text key={i} x={t.x} y={geo.plot.bottom + 16} textAnchor={i === 0 ? 'start' : 'middle'}>{t.label}</text>)}
          </g>

          {/* zero */}
          <g className="text-on-surface-variant">
            <line x1={geo.plot.left} x2={geo.plot.right} y1={geo.zeroY} y2={geo.zeroY} stroke="currentColor" strokeWidth={1.5} />
            <text x={geo.plot.right} y={geo.zeroY - 4} textAnchor="end" fontSize={10} fill="currentColor" className="font-mono">0</text>
          </g>

          {/* reserve */}
          {geo.reserveY !== null && (
            <g className="text-tertiary-fixed-dim">
              <line x1={geo.plot.left} x2={geo.plot.right} y1={geo.reserveY} y2={geo.reserveY} stroke="currentColor" strokeWidth={1.5} strokeDasharray="8 4" />
              <text x={geo.plot.right} y={geo.reserveY - 5} textAnchor="end" fontSize={11} fill="currentColor" className="font-mono">Резерв {fmtMoney(finance.reserveRequired)}</text>
            </g>
          )}

          {/* cash, and the part below zero in the alarm colour */}
          <path d={geo.line} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" className="text-primary" />
          <path d={geo.line} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinejoin="round" clipPath={`url(#${clip})`} className="text-error" />

          {/* first month below zero */}
          {geo.gap && (
            <g className="text-error">
              <line x1={geo.gap.x} x2={geo.gap.x} y1={geo.plot.top} y2={geo.plot.bottom} stroke="currentColor" strokeOpacity={0.7} strokeDasharray="3 3" />
              <text x={Math.min(geo.gap.x + 4, geo.plot.right - 80)} y={geo.plot.top + 10} fontSize={10} fill="currentColor" className="font-mono">разрыв: мес. {geo.gap.month}</text>
            </g>
          )}

          {/* the lowest point */}
          <g className={finance.minCash.value < 0 ? 'text-error' : 'text-on-surface'}>
            <circle cx={geo.min.x} cy={geo.min.y} r={4} fill="currentColor" />
          </g>

          {hoverX !== null && (
            <line x1={hoverX} x2={hoverX} y1={geo.plot.top} y2={geo.plot.bottom} stroke="currentColor" strokeOpacity={0.5} className="text-on-surface" />
          )}
        </svg>
      </div>

      <p className="min-h-[1.25rem] text-xs text-on-surface" aria-live="polite">
        {month !== null
          ? cashReadout(finance, month)
          : <span className="text-on-surface-variant">Коснитесь графика, чтобы увидеть кассу и прибыль по месяцам.</span>}
      </p>

      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-on-surface-variant">
        <li className="flex items-center gap-1.5"><span aria-hidden className="h-0.5 w-4 bg-primary" />Касса</li>
        <li className="flex items-center gap-1.5"><span aria-hidden className="h-0.5 w-4 bg-error" />Ниже нуля</li>
        {geo.reserveY !== null && <li className="flex items-center gap-1.5"><span aria-hidden className="h-0 w-4 border-t-2 border-dashed border-tertiary-fixed-dim" />Резерв ликвидности</li>}
      </ul>
    </figure>
  )
}
