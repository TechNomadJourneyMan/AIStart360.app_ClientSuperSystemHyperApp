'use client'

/**
 * components/point-b/WhatIfChart.tsx — the annual run-rate of revenue by month: without changes, with the
 * changes and the goal line (plan Ф4 Task 4, spec §15.2). A touch or a pointer reads both values of the nearest
 * month. Plain SVG; the geometry comes from whatIfModel (pure, no NaN). Colours come from the project tokens
 * through currentColor; the two lines differ in dash as well, not only in colour.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Icon } from '@/components/point-a-v4/ui'
import type { WhatIfResult } from '@/lib/point-b/model/whatif'
import { fmtMoney } from './overviewModel'
import { chartReadout, chartSummary, nearestPoint, whatIfChartGeometry } from './whatIfModel'

const HEIGHT = 260

export default function WhatIfChart({ series }: { series: WhatIfResult['series'] }) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(560)
  const [index, setIndex] = useState<number | null>(null)

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

  const geo = useMemo(() => whatIfChartGeometry(series, width, HEIGHT), [series, width])

  if (!geo) {
    return (
      <div className="rounded-xl border border-dashed border-white/[0.1] p-4 text-center text-xs text-on-surface-variant">
        <Icon name="show_chart" className="mb-1 block text-2xl text-on-surface-variant/50" />
        График недоступен: нет данных по месяцам.
      </div>
    )
  }

  const onPointer = (e: ReactPointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const scale = r.width > 0 ? geo.width / r.width : 1
    setIndex(nearestPoint(geo, (e.clientX - r.left) * scale))
  }
  const hoverX = index === null ? null : geo.xs[index]

  return (
    <figure className="space-y-2">
      <div ref={box} className="w-full">
        <svg
          role="img"
          aria-label={chartSummary(series)}
          width={geo.width}
          height={geo.height}
          viewBox={`0 0 ${geo.width} ${geo.height}`}
          className="block max-w-full touch-pan-y select-none"
          onPointerMove={onPointer}
          onPointerDown={onPointer}
          onPointerLeave={() => setIndex(null)}
        >
          <g className="text-outline-variant">
            {geo.yTicks.map((t, i) => (
              <line key={i} x1={geo.plot.left} x2={geo.plot.right} y1={t.y} y2={t.y} stroke="currentColor" strokeOpacity={0.4} strokeDasharray="2 4" />
            ))}
          </g>
          <g className="font-mono text-on-surface-variant" fill="currentColor" fontSize={10}>
            {geo.yTicks.map((t, i) => <text key={i} x={geo.plot.left - 8} y={t.y + 3} textAnchor="end">{t.label}</text>)}
            {geo.xTicks.map((t, i) => <text key={i} x={t.x} y={geo.plot.bottom + 16} textAnchor={i === 0 ? 'start' : 'middle'}>{t.label}</text>)}
          </g>

          {/* the goal */}
          {geo.targetY !== null && (
            <g className="text-tertiary-fixed-dim">
              <line x1={geo.plot.left} x2={geo.plot.right} y1={geo.targetY} y2={geo.targetY} stroke="currentColor" strokeWidth={1.5} strokeDasharray="8 4" />
              <text x={geo.plot.right} y={geo.targetY - 5} textAnchor="end" fontSize={11} fill="currentColor" className="font-mono">
                Цель {series.target !== null ? fmtMoney(series.target) : ''}
              </text>
            </g>
          )}

          {/* without changes: thin, dashed */}
          <path d={geo.baseLine} fill="none" stroke="currentColor" strokeWidth={2} strokeDasharray="2 4" strokeLinejoin="round" className="text-on-surface-variant" />
          {/* with the changes */}
          <path d={geo.changedLine} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinejoin="round" className="text-primary" />

          {hoverX !== null && (
            <line x1={hoverX} x2={hoverX} y1={geo.plot.top} y2={geo.plot.bottom} stroke="currentColor" strokeOpacity={0.5} className="text-on-surface" />
          )}
        </svg>
      </div>

      <p className="min-h-[1.25rem] text-xs text-on-surface" aria-live="polite">
        {index !== null
          ? chartReadout(series, index)
          : <span className="text-on-surface-variant">Коснитесь графика, чтобы увидеть значения по месяцам.</span>}
      </p>

      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-on-surface-variant">
        <li className="flex items-center gap-1.5"><span aria-hidden className="h-0 w-4 border-t-2 border-dotted border-on-surface-variant" />Сейчас (без изменений)</li>
        <li className="flex items-center gap-1.5"><span aria-hidden className="h-0.5 w-4 bg-primary" />При изменении</li>
        {geo.targetY !== null && <li className="flex items-center gap-1.5"><span aria-hidden className="h-0 w-4 border-t-2 border-dashed border-tertiary-fixed-dim" />Цель</li>}
      </ul>
    </figure>
  )
}
