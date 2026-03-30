import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Analytics' }

const PERIOD_OPTIONS = ['7 дней', '30 дней', '90 дней', '12 месяцев']

export default function AnalyticsPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-headline text-3xl font-bold text-on-surface">Analytics</h1>
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
          { label: 'Avg GRI Score', value: '763', change: '+24', positive: true },
          { label: 'Portfolio GMV', value: '$12.4M', change: '+3.1%', positive: true },
          { label: 'Active Clients', value: '38', change: '+2', positive: true },
          { label: 'Churn Rate', value: '4.2%', change: '-0.8%', positive: true },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-surface-container-low p-5 rounded-xl">
            <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-2">{kpi.label}</p>
            <p className="text-3xl font-mono font-bold text-on-surface">{kpi.value}</p>
            <p className={`text-xs font-mono mt-2 flex items-center gap-1 ${kpi.positive ? 'text-primary' : 'text-error'}`}>
              <span className="material-symbols-outlined text-sm">{kpi.positive ? 'trending_up' : 'trending_down'}</span>
              {kpi.change}
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
          {/* Chart area — подключить ResponsiveContainer + LineChart из Recharts */}
          <div className="h-48 flex items-end gap-1.5">
            {[42, 58, 51, 65, 70, 63, 75, 68, 72, 80, 76, 84, 79, 88, 85, 90, 87, 92, 89, 95, 91, 97, 94, 96, 93, 98, 95, 97, 99, 100].map((v, i) => (
              <div
                key={i}
                className="flex-1 bg-primary/20 rounded-sm hover:bg-primary/40 transition-colors"
                style={{ height: `${v}%` }}
              />
            ))}
          </div>
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
          <div className="space-y-4">
            {[
              { name: 'FinTech', value: 4.2, total: 12.4, color: 'bg-primary' },
              { name: 'E-commerce', value: 3.1, total: 12.4, color: 'bg-primary-fixed-dim' },
              { name: 'SaaS', value: 2.8, total: 12.4, color: 'bg-secondary' },
              { name: 'Healthcare', value: 1.4, total: 12.4, color: 'bg-tertiary-container' },
              { name: 'Other', value: 0.9, total: 12.4, color: 'bg-outline' },
            ].map((item) => (
              <div key={item.name}>
                <div className="flex justify-between text-sm mb-1.5">
                  <span className="text-on-surface-variant">{item.name}</span>
                  <span className="font-mono text-on-surface">${item.value}M</span>
                </div>
                <div className="h-2 bg-surface-container-high rounded-full overflow-hidden">
                  <div
                    className={`h-full ${item.color} rounded-full transition-all`}
                    style={{ width: `${(item.value / item.total) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
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
              {[
                { name: 'Vortex Labs', industry: 'FinTech', gri: 892, gmv: '$1.2M', growth: '+18%', status: 'Strong' },
                { name: 'Calyx Digital', industry: 'E-commerce', gri: 734, gmv: '$890K', growth: '+12%', status: 'Active' },
                { name: 'Nexum Systems', industry: 'SaaS', gri: 621, gmv: '$540K', growth: '+5%', status: 'Developing' },
                { name: 'PulseCore', industry: 'Healthcare', gri: 480, gmv: '$230K', growth: '-2%', status: 'Critical' },
              ].map((row, i) => (
                <tr key={i} className="border-b border-outline-variant/10 table-row-hover">
                  <td className="px-5 py-3.5 text-sm font-medium text-on-surface">{row.name}</td>
                  <td className="px-5 py-3.5 text-sm text-on-surface-variant">{row.industry}</td>
                  <td className="px-5 py-3.5">
                    <span className={`font-mono text-sm font-bold ${
                      row.gri >= 800 ? 'text-primary' : row.gri >= 700 ? 'text-primary-fixed-dim' : row.gri >= 600 ? 'text-tertiary-container' : 'text-error'
                    }`}>{row.gri}</span>
                  </td>
                  <td className="px-5 py-3.5 font-mono text-sm text-on-surface">{row.gmv}</td>
                  <td className={`px-5 py-3.5 font-mono text-sm ${row.growth.startsWith('+') ? 'text-primary' : 'text-error'}`}>
                    {row.growth}
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
