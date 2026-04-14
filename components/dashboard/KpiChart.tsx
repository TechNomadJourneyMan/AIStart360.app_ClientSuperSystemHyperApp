'use client'

import { useState } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { PERIODS, PERIOD_CONFIG, DEFAULT_PERIOD } from '@/types/periods'
import type { Period } from '@/types/periods'
import { useTimeseries } from '@/hooks/useTimeseries'

const METRIC_DEFS = [
  { key: 'revenue',   label: 'Revenue (₸M)',   color: '#6effc0', unit: '₸M' },
  { key: 'margin',    label: 'Margin (%)',     color: '#bcc7de', unit: '%'  },
  { key: 'clients',   label: 'Clients',       color: '#ffbd60', unit: ''   },
  { key: 'avg_check', label: 'Avg. Check',   color: '#c9a6ff', unit: '₸M' },
]

const CustomTooltip = ({ active, payload, label, unit }: {
  active?: boolean
  payload?: { dataKey: string; value: number; color: string; name: string }[]
  label?: string
  unit: string
}) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-surface-container-high border border-white/10 rounded-xl px-4 py-3 shadow-modal text-xs">
      <p className="font-mono text-on-surface-variant mb-2">{label}</p>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: p.color }} />
          <span className="text-on-surface-variant">{p.name}:</span>
          <span className="font-mono font-bold text-on-surface">{p.value}{unit}</span>
        </div>
      ))}
    </div>
  )
}

function ChartSkeleton() {
  return (
    <div className="animate-pulse bg-surface-container-low rounded-2xl p-5 h-[236px] flex flex-col gap-4">
      <div className="flex justify-between">
        <div className="flex gap-1.5">
          {[1, 2, 3].map((i) => <div key={i} className="h-6 w-20 bg-white/[0.06] rounded-lg" />)}
        </div>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-6 w-8 bg-white/[0.04] rounded-md" />)}
        </div>
      </div>
      <div className="flex-1 bg-white/[0.04] rounded-xl" />
    </div>
  )
}

export function KpiChart({ initialMetric = 'revenue' }: { initialMetric?: string }) {
  const [period, setPeriod] = useState<Period>(DEFAULT_PERIOD)
  const [activeMetric, setActiveMetric] = useState(initialMetric)

  const metricDef = METRIC_DEFS.find((m) => m.key === activeMetric) ?? METRIC_DEFS[0]
  const { data: tsData, isLoading } = useTimeseries(activeMetric, period)
  const chartData = tsData?.data?.map((p) => ({ date: p.label, value: p.value })) ?? []

  if (isLoading) return <ChartSkeleton />

  return (
    <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-1.5 flex-wrap">
          {METRIC_DEFS.map((m) => (
            <button
              key={m.key}
              onClick={() => setActiveMetric(m.key)}
              className={`px-3 py-1 rounded-lg text-[11px] font-mono transition-all duration-150 ${
                activeMetric === m.key
                  ? 'font-bold'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
              }`}
              style={
                activeMetric === m.key
                  ? { background: m.color + '22', color: m.color, border: `1px solid ${m.color}33` }
                  : {}
              }
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 bg-surface-container rounded-lg p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 rounded-md text-[11px] font-mono transition-all duration-150 ${
                period === p
                  ? 'bg-surface-container-high text-on-surface'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {PERIOD_CONFIG[p].labelRu}
            </button>
          ))}
        </div>
      </div>

      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="colorMetricKpi" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={metricDef.color} stopOpacity={0.18} />
                <stop offset="95%" stopColor={metricDef.color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fill: '#84958a', fontSize: 10, fontFamily: 'JetBrains Mono' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: '#84958a', fontSize: 10, fontFamily: 'JetBrains Mono' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              content={<CustomTooltip unit={metricDef.unit} />}
              cursor={{ stroke: 'rgba(255,255,255,0.08)', strokeWidth: 1 }}
            />
            <Area
              type="monotone"
              dataKey="value"
              name={metricDef.label}
              stroke={metricDef.color}
              strokeWidth={2}
              fill="url(#colorMetricKpi)"
              dot={false}
              activeDot={{ r: 4, fill: metricDef.color, strokeWidth: 0 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
