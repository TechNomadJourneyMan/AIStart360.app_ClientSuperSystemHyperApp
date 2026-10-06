'use client'

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fmtTokens, fmtUsd, type DayPoint } from './model'

/** Daily AI spend. Styling follows the other dark recharts panels (grid 6 % white, dark tooltip). */
export function CostChart({ points }: { points: DayPoint[] }) {
  const label = `Расход ИИ по дням: ${points.length} дн., всего ${fmtUsd(points.reduce((s, p) => s + p.cost, 0))}`
  return (
    <figure aria-label={label} className="h-56 w-full">
      <ResponsiveContainer>
        <BarChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: 'rgba(148,163,184,0.8)', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={16}
          />
          <YAxis
            width={56}
            tick={{ fill: 'rgba(148,163,184,0.8)', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => fmtUsd(v)}
          />
          <Tooltip
            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
            contentStyle={{ background: '#0a1024', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, fontSize: 12 }}
            labelStyle={{ color: '#e2e8f0' }}
            content={({ active, payload }) => {
              const p = active && payload?.[0] ? (payload[0].payload as DayPoint) : null
              if (!p) return null
              return (
                <div className="rounded-xl border border-white/[0.1] bg-[#0a1024] px-3 py-2 text-[11px] shadow-2xl">
                  <p className="font-medium text-slate-100">{p.day}</p>
                  <p className="mt-1 font-mono text-blue-200">{fmtUsd(p.cost)}</p>
                  <p className="text-slate-400">запусков: {p.runs}</p>
                  <p className="text-slate-400">токены: {fmtTokens(p.tokensIn)} вх. · {fmtTokens(p.tokensOut)} вых.</p>
                </div>
              )
            }}
          />
          <Bar dataKey="cost" fill="#60a5fa" fillOpacity={0.75} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </figure>
  )
}
