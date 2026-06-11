'use client'

import React, { useState } from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { TrendingUp, Users, Activity, BarChart3, RefreshCw, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { MOCK_MARKET_DATA, formatKZT, type MarketData } from './mock-data'

/**
 * Market Overview view — volume, YoY growth, active players, PESTEL breakdown.
 *
 * TODO(supabase): Replace `useState(MOCK_MARKET_DATA)` with a read from the
 * `market_overview` table (singleton row keyed by niche + region). The Sync
 * button should POST to a future /api/market/sync-macro route that populates
 * that table from eGov / Adata.
 */
export function MarketOverview() {
  const [data] = useState<MarketData>(MOCK_MARKET_DATA)
  const [syncing, setSyncing] = useState(false)

  const isEmpty = data.totalVolume === 0 && data.chartData.length === 0

  const handleSync = async () => {
    // No real backend feed yet — do not fabricate a refresh.
    setSyncing(true)
    try {
      // TODO(supabase): POST to /api/market/sync-macro and re-read live data.
    } finally {
      setSyncing(false)
    }
  }

  const trendBadge = (trend: 'positive' | 'negative' | 'neutral') => {
    if (trend === 'positive') return <Badge variant="primary">positive</Badge>
    if (trend === 'negative') return <Badge variant="error">negative</Badge>
    return <Badge variant="default">neutral</Badge>
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
        <div className="flex flex-col gap-2">
          <h2 className="font-headline text-3xl font-extrabold tracking-tight text-on-surface">
            IT Consulting (Kazakhstan)
          </h2>
          <p className="text-on-surface-variant text-sm">Market Overview & Macro Trends</p>
        </div>
        <Button
          variant="outline"
          onClick={handleSync}
          disabled={syncing}
          className="shrink-0"
        >
          {syncing ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Sync Macro Data
        </Button>
      </div>

      {isEmpty ? (
        <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-12 text-center">
          <BarChart3 className="h-12 w-12 text-on-surface-variant/40 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-on-surface mb-2">Анализ рынка</h3>
          <p className="text-on-surface-variant max-w-md mx-auto">
            Данные рынка ещё не подключены. Здесь появится объём рынка, динамика и PESTEL после
            интеграции источников.
          </p>
        </div>
      ) : (
        <>
          {/* KPI grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Total Volume"
              value={formatKZT(data.totalVolume)}
              hint={`+${data.yoyGrowth}% YoY`}
              hintTone="primary"
              icon={<BarChart3 className="h-4 w-4 text-primary" />}
            />
            <StatCard
              label="YoY Growth"
              value={`${data.yoyGrowth}%`}
              hint="Consistent upward trend"
              icon={<TrendingUp className="h-4 w-4 text-primary" />}
            />
            <StatCard
              label="Active Players"
              value={String(data.activePlayers)}
              hint="Registered entities"
              icon={<Users className="h-4 w-4 text-primary" />}
            />
            <StatCard
              label="Market Temp"
              value={data.marketTemp}
              valueTone="error"
              hint="High competition & activity"
              icon={<Activity className="h-4 w-4 text-error" />}
            />
          </div>

          {/* Chart + PESTEL */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="col-span-1 lg:col-span-2 bg-surface-container-low rounded-2xl border border-white/[0.04] p-6">
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-6">
                5-Year Growth Trajectory
              </p>
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorVolume" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6effc0" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#6effc0" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="year"
                      stroke="#84958a"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      stroke="#84958a"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => `${v}B`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#1a1b20',
                        borderColor: '#3b4a41',
                        color: '#e3e2e8',
                        borderRadius: 12,
                      }}
                      itemStyle={{ color: '#6effc0' }}
                    />
                    <Area
                      type="monotone"
                      dataKey="volume"
                      stroke="#6effc0"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#colorVolume)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6">
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-4">
                PESTEL Factors
              </p>
              <div className="space-y-4">
                {data.pestel.map((item) => (
                  <div
                    key={item.factor}
                    className="flex flex-col gap-1 border-b border-white/[0.05] pb-3 last:border-0 last:pb-0"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-on-surface">{item.factor}</span>
                      {trendBadge(item.trend)}
                    </div>
                    <p className="text-xs text-on-surface-variant">{item.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

interface StatCardProps {
  label: string
  value: string
  hint: string
  hintTone?: 'primary' | 'muted'
  valueTone?: 'default' | 'error'
  icon: React.ReactNode
}

function StatCard({ label, value, hint, hintTone = 'muted', valueTone = 'default', icon }: StatCardProps) {
  return (
    <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] hover:border-primary/20 p-6 transition-colors group">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-mono text-on-surface-variant uppercase tracking-widest">{label}</p>
        {icon}
      </div>
      <div
        className={`text-2xl font-mono font-bold tabular-nums ${
          valueTone === 'error' ? 'text-error' : 'text-on-surface'
        }`}
      >
        {value}
      </div>
      <p
        className={`text-xs mt-1 ${
          hintTone === 'primary' ? 'text-primary' : 'text-on-surface-variant'
        }`}
      >
        {hint}
      </p>
    </div>
  )
}
