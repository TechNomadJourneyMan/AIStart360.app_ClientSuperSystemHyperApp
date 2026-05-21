'use client'

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

interface TrendPoint {
  attempt: number
  gri: number
  label: string
}

export default function GRIAssessmentTrendChart({ data }: { data: TrendPoint[] }) {
  return (
    <div style={{ width: '100%', height: 120 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -10 }}>
          <XAxis
            dataKey="label"
            tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}
            axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
            tickLine={false}
          />
          <YAxis
            domain={[0, 10]}
            tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}
            axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
            tickLine={false}
            width={28}
          />
          <Tooltip
            contentStyle={{
              background: 'rgba(10,11,15,0.95)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 12,
              fontSize: 12,
              fontFamily: 'JetBrains Mono, monospace',
            }}
            labelStyle={{ color: 'rgba(255,255,255,0.7)' }}
            formatter={(value: number) => [value.toFixed(1), 'GRI']}
          />
          <Line
            type="monotone"
            dataKey="gri"
            stroke="#6effc0"
            strokeWidth={2}
            dot={{ r: 3, fill: '#6effc0', strokeWidth: 0 }}
            activeDot={{ r: 5, fill: '#6effc0', stroke: 'rgba(110,255,192,0.3)', strokeWidth: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
