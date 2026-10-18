'use client'

/**
 * components/point-b/CorridorChart.tsx — the revenue trajectory with a corridor (plan Phase 2
 * Task 8, spec §15.2): the low–high band, the base line, the "at the current pace" dashed
 * line with its range at the deadline, the goal line and the deadline mark. Plain SVG, no
 * library; the geometry is computed by overviewModel.corridorGeometry (pure, no NaN).
 *
 * The SVG is laid out for the measured width, so the text keeps its size on a phone. A touch
 * or a pointer over the plot reads the values of the nearest month below the chart.
 * Colours come from the project tokens through currentColor.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Icon } from '@/components/point-a-v4/ui'
import {
  chartSummary, corridorGeometry, fmtMoney, nearestPoint, pointReadout, xForMonth,
  type CorridorChartData, type TrajPoint,
} from './overviewModel'

const HEIGHT = 260

function Legend({ swatch, children }: { swatch: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-1.5">
      {swatch}
      <span>{children}</span>
    </li>
  )
}

export default function CorridorChart({
  data,
  scenarioLabel,
  placeholder,
}: {
  data: CorridorChartData
  scenarioLabel: string
  /** Shown instead of the chart when the geometry cannot be built. */
  placeholder: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  const [hover, setHover] = useState<TrajPoint | null>(null)

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

  const geo = useMemo(() => corridorGeometry(data, width, HEIGHT), [data, width])

  if (!geo) {
    return (
      <div className="rounded-xl border border-dashed border-white/[0.1] p-6 text-center text-sm text-on-surface-variant">
        <Icon name="show_chart" className="mb-1 block text-2xl text-on-surface-variant/50" />
        {placeholder}
      </div>
    )
  }

  const onPointer = (e: ReactPointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const scale = r.width > 0 ? geo.width / r.width : 1
    setHover(nearestPoint(data, geo, (e.clientX - r.left) * scale))
  }

  return (
    <figure className="space-y-3">
      <div ref={box} className="w-full">
        <svg
          role="img"
          aria-label={chartSummary(data, scenarioLabel)}
          width={geo.width}
          height={geo.height}
          viewBox={`0 0 ${geo.width} ${geo.height}`}
          className="block max-w-full touch-pan-y select-none"
          onPointerMove={onPointer}
          onPointerDown={onPointer}
          onPointerLeave={() => setHover(null)}
        >
          {/* grid and axes */}
          <g className="text-outline-variant">
            {geo.yTicks.map((t, i) => (
              <line key={i} x1={geo.plot.left} x2={geo.plot.right} y1={t.y} y2={t.y} stroke="currentColor" strokeOpacity={0.5} strokeDasharray={i === 0 ? undefined : '2 4'} />
            ))}
          </g>
          <g className="font-mono text-on-surface-variant" fill="currentColor" fontSize={10}>
            {geo.yTicks.map((t, i) => (
              <text key={i} x={geo.plot.left - 8} y={t.y + 3} textAnchor="end">{t.label}</text>
            ))}
            {geo.xTicks.map((t, i) => (
              <text key={i} x={t.x} y={geo.plot.bottom + 16} textAnchor={i === 0 ? 'start' : 'middle'}>{t.label}</text>
            ))}
          </g>

          {/* deadline mark */}
          {geo.deadlineX !== null && (
            <g className="text-on-surface-variant">
              <line x1={geo.deadlineX} x2={geo.deadlineX} y1={geo.plot.top} y2={geo.plot.bottom} stroke="currentColor" strokeOpacity={0.6} strokeDasharray="3 3" />
              <text x={geo.deadlineX - 4} y={geo.plot.top + 10} textAnchor="end" fontSize={10} fill="currentColor" className="font-mono">срок цели</text>
            </g>
          )}

          {/* corridor and base line */}
          {geo.band && <path d={geo.band} fill="currentColor" fillOpacity={0.14} className="text-primary" />}
          {geo.baseLine && <path d={geo.baseLine} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" className="text-primary" />}

          {/* at the current pace */}
          {geo.paceLine && <path d={geo.paceLine} fill="none" stroke="currentColor" strokeWidth={2} strokeDasharray="6 4" className="text-secondary" />}
          {geo.paceEnd && (
            <g className="text-secondary">
              {geo.paceEnd.yLow !== null && geo.paceEnd.yHigh !== null && (
                <line x1={geo.paceEnd.x} x2={geo.paceEnd.x} y1={geo.paceEnd.yLow} y2={geo.paceEnd.yHigh} stroke="currentColor" strokeWidth={2} />
              )}
              <circle cx={geo.paceEnd.x} cy={geo.paceEnd.y} r={4} fill="currentColor" />
            </g>
          )}

          {/* goal */}
          {geo.targetY !== null && data.target !== null && (
            <g className="text-tertiary-fixed-dim">
              <line x1={geo.plot.left} x2={geo.plot.right} y1={geo.targetY} y2={geo.targetY} stroke="currentColor" strokeWidth={1.5} strokeDasharray="8 4" />
              <text x={geo.plot.right} y={geo.targetY - 5} textAnchor="end" fontSize={11} fill="currentColor" className="font-mono">Цель {fmtMoney(data.target)}</text>
            </g>
          )}

          {/* pointer marker */}
          {hover && (
            <g className="text-on-surface">
              <line x1={xForMonth(geo, hover.month)} x2={xForMonth(geo, hover.month)} y1={geo.plot.top} y2={geo.plot.bottom} stroke="currentColor" strokeOpacity={0.5} />
            </g>
          )}
        </svg>
      </div>

      <p className="min-h-[1.25rem] text-xs text-on-surface" aria-live="polite">
        {hover ? pointReadout(hover) : <span className="text-on-surface-variant">Коснитесь графика или наведите курсор, чтобы увидеть значения по месяцам.</span>}
      </p>

      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-on-surface-variant">
        <Legend swatch={<span aria-hidden className="h-2.5 w-4 rounded-sm bg-primary/30" />}>Коридор «{scenarioLabel}»</Legend>
        <Legend swatch={<span aria-hidden className="h-0.5 w-4 bg-primary" />}>Базовая траектория</Legend>
        {geo.paceLine && <Legend swatch={<span aria-hidden className="h-0 w-4 border-t-2 border-dashed border-secondary" />}>При текущем ходе</Legend>}
        {geo.targetY !== null && <Legend swatch={<span aria-hidden className="h-0 w-4 border-t-2 border-dashed border-tertiary-fixed-dim" />}>Цель</Legend>}
      </ul>
    </figure>
  )
}
