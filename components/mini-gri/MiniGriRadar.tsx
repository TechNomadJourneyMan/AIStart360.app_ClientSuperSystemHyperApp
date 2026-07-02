'use client'

import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from 'recharts'

/**
 * Recharts radar for the free Mini-GRI result. Split into its own module so it
 * can be loaded via next/dynamic — keeps recharts (~heavy) out of the gri-free
 * first-load JS; the chart only appears on the result step anyway.
 */
export interface MiniGriRadarPoint {
  block: string
  score: number
}

export default function MiniGriRadar({ data }: { data: MiniGriRadarPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <RadarChart data={data} outerRadius="72%">
        <PolarGrid stroke="rgba(255,255,255,0.08)" />
        <PolarAngleAxis dataKey="block" tick={{ fill: '#bacbbf', fontSize: 11 }} />
        <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
        <Radar
          name="GRI"
          dataKey="score"
          stroke="#6effc0"
          fill="#6effc0"
          fillOpacity={0.22}
          strokeWidth={2}
        />
      </RadarChart>
    </ResponsiveContainer>
  )
}
