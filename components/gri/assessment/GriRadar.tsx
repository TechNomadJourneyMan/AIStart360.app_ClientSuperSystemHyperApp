'use client'

import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Legend,
  Tooltip,
} from 'recharts'

export default function GriRadar({
  data,
  height = 360,
}: {
  data: { subject: string; score: number; benchmark: number }[]
  height?: number
}) {
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <RadarChart data={data} outerRadius="75%">
          <PolarGrid stroke="rgba(255,255,255,0.15)" />
          <PolarAngleAxis
            dataKey="subject"
            tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 11 }}
          />
          <PolarRadiusAxis angle={30} domain={[0, 10]} tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} />
          <Tooltip
            contentStyle={{
              background: 'rgba(0,0,0,0.85)',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Radar
            name="Ваш бизнес"
            dataKey="score"
            stroke="#60a5fa"
            fill="#60a5fa"
            fillOpacity={0.35}
          />
          <Radar
            name="Эталон $2M"
            dataKey="benchmark"
            stroke="#34d399"
            fill="#34d399"
            fillOpacity={0.15}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}
