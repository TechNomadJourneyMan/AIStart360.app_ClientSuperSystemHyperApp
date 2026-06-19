'use client'

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import type { TrajectoryPoint } from '@/lib/point-b/engine'
import { formatMoney, EmptyState } from './shared'

const PRIMARY = '#6effc0'

function compactAxis(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1_000_000_000) return `${(v / 1_000_000_000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млрд`
  if (abs >= 1_000_000) return `${(v / 1_000_000).toLocaleString('ru-RU', { maximumFractionDigits: 0 })} млн`
  if (abs >= 1_000) return `${(v / 1_000).toLocaleString('ru-RU', { maximumFractionDigits: 0 })} тыс`
  return v.toLocaleString('ru-RU')
}

function ChartTooltip({
  active,
  payload,
  unitLabel,
}: {
  active?: boolean
  payload?: { value: number; payload: { label: string } }[]
  unitLabel: string
}) {
  if (!active || !payload?.length) return null
  const p = payload[0]
  return (
    <div className="bg-surface-container-high border border-white/10 rounded-xl px-4 py-3 shadow-modal text-xs">
      <p className="font-mono text-on-surface-variant mb-1">
        {unitLabel} {p.payload.label}
      </p>
      <p className="font-mono font-bold text-primary">{formatMoney(p.value)}</p>
    </div>
  )
}

export function TrajectoryChart({
  points,
  unitLabel,
  emptyText,
}: {
  points: TrajectoryPoint[]
  /** Singular axis unit prefix, e.g. "Месяц" or "Квартал". */
  unitLabel: string
  emptyText: string
}) {
  if (!points || points.length === 0) {
    return <EmptyState icon="show_chart" text={emptyText} />
  }

  const data = points.map((p) => ({
    x: p.month,
    label: String(p.month),
    value: p.target_revenue,
  }))

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          <defs>
            <linearGradient id="pointBTrajectory" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={PRIMARY} stopOpacity={0.22} />
              <stop offset="95%" stopColor={PRIMARY} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: '#84958a', fontSize: 10, fontFamily: 'JetBrains Mono' }}
            axisLine={false}
            tickLine={false}
            label={{
              value: unitLabel,
              position: 'insideBottomRight',
              offset: -2,
              fill: '#84958a',
              fontSize: 9,
              fontFamily: 'JetBrains Mono',
            }}
          />
          <YAxis
            tickFormatter={compactAxis}
            width={56}
            tick={{ fill: '#84958a', fontSize: 10, fontFamily: 'JetBrains Mono' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            content={<ChartTooltip unitLabel={unitLabel} />}
            cursor={{ stroke: 'rgba(110,255,192,0.25)', strokeWidth: 1 }}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={PRIMARY}
            strokeWidth={2}
            fill="url(#pointBTrajectory)"
            dot={false}
            activeDot={{ r: 4, fill: PRIMARY, strokeWidth: 0 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
