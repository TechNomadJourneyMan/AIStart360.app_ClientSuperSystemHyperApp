'use client'

import { useState } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine
} from 'recharts'

const PERIODS = [
  { label: '7Д', key: '7d' },
  { label: '30Д', key: '30d' },
  { label: '3М', key: '3m' },
  { label: '1Г', key: '1y' },
]

const DATA: Record<string, { date: string; revenue: number; margin: number; clients: number }[]> = {
  '7d': [
    { date: '27 мар', revenue: 78.1, margin: 32.4, clients: 44 },
    { date: '28 мар', revenue: 79.5, margin: 33.1, clients: 45 },
    { date: '29 мар', revenue: 80.2, margin: 33.8, clients: 45 },
    { date: '30 мар', revenue: 81.4, margin: 33.5, clients: 46 },
    { date: '31 мар', revenue: 82.0, margin: 34.0, clients: 47 },
    { date: '01 апр', revenue: 83.1, margin: 34.1, clients: 47 },
    { date: '02 апр', revenue: 84.2, margin: 34.2, clients: 48 },
  ],
  '30d': [
    { date: '03 мар', revenue: 71.0, margin: 30.5, clients: 40 },
    { date: '08 мар', revenue: 73.2, margin: 31.2, clients: 41 },
    { date: '13 мар', revenue: 75.8, margin: 31.9, clients: 42 },
    { date: '18 мар', revenue: 77.4, margin: 32.5, clients: 43 },
    { date: '23 мар', revenue: 80.1, margin: 33.2, clients: 45 },
    { date: '28 мар', revenue: 82.0, margin: 33.8, clients: 47 },
    { date: '02 апр', revenue: 84.2, margin: 34.2, clients: 48 },
  ],
  '3m': [
    { date: 'Янв', revenue: 64.0, margin: 28.0, clients: 36 },
    { date: 'Фев', revenue: 70.5, margin: 30.1, clients: 40 },
    { date: 'Мар', revenue: 78.0, margin: 32.5, clients: 44 },
    { date: 'Апр', revenue: 84.2, margin: 34.2, clients: 48 },
  ],
  '1y': [
    { date: "Апр '25", revenue: 38.0, margin: 20.0, clients: 22 },
    { date: "Июн '25", revenue: 44.5, margin: 22.5, clients: 27 },
    { date: "Авг '25", revenue: 51.0, margin: 25.0, clients: 31 },
    { date: "Окт '25", revenue: 58.2, margin: 27.5, clients: 35 },
    { date: "Дек '25", revenue: 65.0, margin: 29.8, clients: 39 },
    { date: "Фев '26", revenue: 74.0, margin: 32.0, clients: 44 },
    { date: "Апр '26", revenue: 84.2, margin: 34.2, clients: 48 },
  ],
}

const METRICS = [
  { key: 'revenue', label: 'Доход (₸М)', color: '#6effc0', unit: '₸М' },
  { key: 'margin', label: 'Маржа (%)', color: '#bcc7de', unit: '%' },
  { key: 'clients', label: 'Клиенты', color: '#ffbd60', unit: '' },
]

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-surface-container-high border border-white/10 rounded-xl px-4 py-3 shadow-modal text-xs">
      <p className="font-mono text-on-surface-variant mb-2">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: p.color }} />
          <span className="text-on-surface-variant">{p.name}:</span>
          <span className="font-mono font-bold text-on-surface">{p.value}{p.unit}</span>
        </div>
      ))}
    </div>
  )
}

export function KpiChart() {
  const [period, setPeriod] = useState('30d')
  const [activeMetric, setActiveMetric] = useState('revenue')

  const data = DATA[period]
  const metric = METRICS.find(m => m.key === activeMetric)!

  return (
    <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-1.5">
          {METRICS.map(m => (
            <button
              key={m.key}
              onClick={() => setActiveMetric(m.key)}
              className={`
                px-3 py-1 rounded-lg text-[11px] font-mono transition-all duration-150
                ${activeMetric === m.key
                  ? 'text-on-primary font-bold'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'}
              `}
              style={activeMetric === m.key ? { background: m.color + '22', color: m.color, border: `1px solid ${m.color}33` } : {}}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 bg-surface-container rounded-lg p-0.5">
          {PERIODS.map(p => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`
                px-3 py-1 rounded-md text-[11px] font-mono transition-all duration-150
                ${period === p.key
                  ? 'bg-surface-container-high text-on-surface'
                  : 'text-on-surface-variant hover:text-on-surface'}
              `}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="colorMetric" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={metric.color} stopOpacity={0.18} />
                <stop offset="95%" stopColor={metric.color} stopOpacity={0} />
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
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.08)', strokeWidth: 1 }} />
            <Area
              type="monotone"
              dataKey={activeMetric}
              name={metric.label}
              stroke={metric.color}
              strokeWidth={2}
              fill="url(#colorMetric)"
              dot={false}
              activeDot={{ r: 4, fill: metric.color, strokeWidth: 0 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
