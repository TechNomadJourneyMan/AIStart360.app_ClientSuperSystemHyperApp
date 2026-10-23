'use client'

// The mini chart under a field calculation (spec 2026-10-23 §9.3). recharts
// lives only here; FieldCalc loads this file with next/dynamic({ ssr:false }),
// so the step forms' first-load JS does not carry it. No animation (also for
// prefers-reduced-motion); the numbers are in a hidden table next to it.
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { CalcChart } from '@/lib/survey/calcs'
import { formatChartValue } from '@/lib/survey/calcs'

// Design tokens (tailwind.config.ts): primary, tertiary-container, secondary, on-surface-variant.
const PRIMARY = '#6effc0'
const ACCENT = '#ffbd60'
const SECOND = '#bcc7de'
const AXIS = '#bacbbf'

function compact(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e9) return `${(v / 1e9).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млрд`
  if (a >= 1e6) return `${(v / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млн`
  if (a >= 1e3) return `${(v / 1e3).toLocaleString('ru-RU', { maximumFractionDigits: 0 })} тыс`
  return v.toLocaleString('ru-RU', { maximumFractionDigits: 1 })
}

export default function FieldCalcChart({ chart }: { chart: Exclude<CalcChart, { kind: 'share' }> }) {
  const unit = chart.unit
  const tooltip = (
    <Tooltip
      cursor={{ fill: 'rgba(255,255,255,0.04)' }}
      contentStyle={{ background: '#1e2026', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, fontSize: 11 }}
      labelStyle={{ color: AXIS }}
      formatter={(v: number | string) => formatChartValue(Number(v), unit)}
    />
  )
  const axes = (
    <>
      <XAxis dataKey="label" tick={{ fill: AXIS, fontSize: 10 }} axisLine={false} tickLine={false} interval={0} />
      <YAxis tick={{ fill: AXIS, fontSize: 10 }} axisLine={false} tickLine={false} width={64} tickFormatter={compact} />
    </>
  )
  return (
    <div className="h-[120px] w-full" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        {chart.kind === 'pairs' ? (
          <BarChart data={chart.series} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            {axes}
            {tooltip}
            <Bar dataKey="a" name={chart.names[0]} fill={SECOND} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="b" name={chart.names[1]} fill={PRIMARY} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        ) : (
          <BarChart data={chart.series} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            {axes}
            {tooltip}
            <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {chart.series.map((p) => <Cell key={p.label} fill={p.mark ? ACCENT : PRIMARY} />)}
            </Bar>
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}
