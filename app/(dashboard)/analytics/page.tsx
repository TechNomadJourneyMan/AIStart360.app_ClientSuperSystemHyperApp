export const dynamic = "force-dynamic"

import type { Metadata } from 'next'
import { getAnalyticsData } from '@/lib/analytics-data'

export const metadata: Metadata = { title: 'Аналитика' }

const PERIOD_OPTIONS = ['7 дней', '30 дней', '90 дней', '12 месяцев']

function formatMoney(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`
  return `$${value.toFixed(0)}`
}

export default async function AnalyticsPage() {
  const data = await getAnalyticsData()
  const totalIndustryValue = data.industryBreakdown.reduce((sum, item) => sum + item.value, 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-headline text-3xl font-bold text-on-surface">Аналитика</h1>
          <p className="text-on-surface-variant text-sm mt-1">Метрики и производительность портфеля</p>
        </div>
        <div className="flex gap-1 bg-surface-container rounded-lg p-1">
          {PERIOD_OPTIONS.map((period, i) => (
            <button
              key={period}
              className={`px-4 py-1.5 rounded text-xs font-mono font-medium transition-colors ${
                i === 1
                  ? 'bg-surface-container-high text-on-surface'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {period}
            </button>
          ))}
        </div>
      </div>

      {/* Top KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Avg GRI Score', value: String(data.kpis.avgGriScore), change: '', positive: true },
          { label: 'Portfolio GMV', value: formatMoney(data.kpis.portfolioGmv), change: '', positive: true },
          { label: 'Active Clients', value: String(data.kpis.activeClients), change: '', positive: true },
          { label: 'Churn Rate', value: `${data.kpis.churnRate}%`, change: '', positive: data.kpis.churnRate <= 10 },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-surface-container-low p-5 rounded-xl">
            <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-2">{kpi.label}</p>
            <p className="text-3xl font-mono font-bold text-on-surface">{kpi.value}</p>
            <p className={`text-xs font-mono mt-2 flex items-center gap-1 ${kpi.positive ? 'text-primary' : 'text-error'}`}>
              <span className="material-symbols-outlined text-sm">{kpi.positive ? 'trending_up' : 'trending_down'}</span>
              <span>{kpi.positive ? 'на основе реальных данных' : 'требует внимания'}</span>
            </p>
          </div>
        ))}
      </div>

      {/* Chart Placeholder (подключить Recharts) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-surface-container rounded-xl p-6">
          <div className="flex justify-between items-center mb-6">
            <h3 className="font-headline text-lg font-bold text-on-surface">GRI Trend</h3>
            <span className="text-xs font-mono text-on-surface-variant">30 дней</span>
          </div>
          {data.trend.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-sm text-on-surface-variant border border-dashed border-white/[0.08] rounded-xl">
              Нет данных GRI за выбранный период
            </div>
          ) : (
            <div className="h-48 flex items-end gap-1.5">
              {data.trend.map((value, index) => (
                <div
                  key={index}
                  className="flex-1 bg-primary/20 rounded-sm hover:bg-primary/40 transition-colors"
                  style={{ height: `${value}%` }}
                />
              ))}
            </div>
          )}
          <div className="flex justify-between text-[10px] font-mono text-on-surface-variant mt-3">
            <span>1 Mar</span>
            <span>15 Mar</span>
            <span>30 Mar</span>
          </div>
        </div>

        <div className="bg-surface-container rounded-xl p-6">
          <div className="flex justify-between items-center mb-6">
            <h3 className="font-headline text-lg font-bold text-on-surface">GMV by Industry</h3>
            <span className="text-xs font-mono text-on-surface-variant">Current</span>
          </div>
          {data.industryBreakdown.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-sm text-on-surface-variant border border-dashed border-white/[0.08] rounded-xl">
              Данные по отраслям пока отсутствуют
            </div>
          ) : (
            <div className="space-y-4">
              {data.industryBreakdown.map((item, index) => {
                const width = totalIndustryValue > 0 ? (item.value / totalIndustryValue) * 100 : 0
                const color = ['bg-primary', 'bg-primary-fixed-dim', 'bg-secondary', 'bg-tertiary-container', 'bg-outline'][index] ?? 'bg-primary'
                return (
                  <div key={item.name}>
                    <div className="flex justify-between text-sm mb-1.5">
                      <span className="text-on-surface-variant">{item.name}</span>
                      <span className="font-mono text-on-surface">{formatMoney(item.value)}</span>
                    </div>
                    <div className="h-2 bg-surface-container-high rounded-full overflow-hidden">
                      <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${width}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Client Performance Table */}
      <div className="bg-surface-container rounded-xl overflow-hidden">
        <div className="px-6 py-5 border-b border-outline-variant/10 flex justify-between items-center">
          <h3 className="font-headline text-lg font-bold text-on-surface">Client Performance</h3>
          <button className="text-xs font-mono text-primary hover:underline uppercase tracking-wider">Export CSV</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-surface-container-high">
                {['Client', 'Industry', 'GRI Score', 'GMV', 'Growth', 'Status'].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-[10px] font-mono uppercase tracking-widest text-on-surface-variant whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.clientPerformance.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-sm text-on-surface-variant">
                    Нет клиентских метрик для отображения
                  </td>
                </tr>
              ) : data.clientPerformance.map((row) => (
                <tr key={row.id} className="border-b border-outline-variant/10 table-row-hover">
                  <td className="px-5 py-3.5 text-sm font-medium text-on-surface">{row.name}</td>
                  <td className="px-5 py-3.5 text-sm text-on-surface-variant">{row.industry}</td>
                  <td className="px-5 py-3.5">
                    <span className={`font-mono text-sm font-bold ${
                      row.gri >= 800 ? 'text-primary' : row.gri >= 700 ? 'text-primary-fixed-dim' : row.gri >= 600 ? 'text-tertiary-container' : 'text-error'
                    }`}>{row.gri}</span>
                  </td>
                  <td className="px-5 py-3.5 font-mono text-sm text-on-surface">{formatMoney(row.gmv)}</td>
                  <td className={`px-5 py-3.5 font-mono text-sm ${row.growth >= 0 ? 'text-primary' : 'text-error'}`}>
                    {row.growth >= 0 ? '+' : ''}{row.growth}%
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={`text-[10px] font-mono px-2.5 py-1 rounded-full border ${
                      row.status === 'Strong' || row.status === 'Active' ? 'text-primary bg-primary/10 border-primary/20'
                      : row.status === 'Developing' ? 'text-tertiary-container bg-tertiary-container/10 border-tertiary-container/20'
                      : 'text-error bg-error/10 border-error/20'
                    }`}>
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
