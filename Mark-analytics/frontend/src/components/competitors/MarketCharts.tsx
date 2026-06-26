import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { formatCurrency, formatNumber, formatPercent } from '../../lib/format';
import type { MarketBlock } from '../../hooks/useCompetitors';

const PALETTE = [
  '#6366f1',
  '#818cf8',
  '#a78bfa',
  '#60a5fa',
  '#34d399',
  '#fbbf24',
  '#f472b6',
  '#94a3b8',
];

function paletteColor(i: number): string {
  return PALETTE[i % PALETTE.length] ?? '#94a3b8';
}

const TOOLTIP_STYLE = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  fontSize: 12,
  color: 'var(--card-foreground)',
} as const;

interface MarketChartsProps {
  market: MarketBlock | undefined;
}

export function MarketCharts({ market }: MarketChartsProps): JSX.Element {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  const shareData = useMemo(
    () =>
      (market?.top_shares ?? []).map((s) => ({
        name: s.name,
        value: s.share_pct ?? 0,
        revenue: s.revenue_usd ?? 0,
      })),
    [market?.top_shares],
  );

  const revenueData = useMemo(
    () => (market?.revenue_buckets ?? []).map((b) => ({ name: b.label, count: b.count })),
    [market?.revenue_buckets],
  );

  const sizeData = useMemo(
    () =>
      (market?.size_distribution ?? []).map((s) => ({
        name: s.label ?? s.key,
        count: s.count,
      })),
    [market?.size_distribution],
  );

  const regionData = useMemo(
    () =>
      [...(market?.region_distribution ?? [])]
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)
        .map((r) => ({ name: r.region_name, count: r.count })),
    [market?.region_distribution],
  );

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <ChartCard title={t('competitors.charts.shares')} empty={shareData.length === 0}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={shareData}
              dataKey="value"
              nameKey="name"
              innerRadius={45}
              outerRadius={80}
              paddingAngle={1}
            >
              {shareData.map((_, i) => (
                <Cell key={i} fill={paletteColor(i)} />
              ))}
            </Pie>
            <RTooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(value: number, _n, item) => {
                const rev = (item?.payload as { revenue?: number } | undefined)?.revenue ?? 0;
                return [`${formatPercent(value)} · ${formatCurrency(rev, lang)}`, ''];
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <ShareLegend
          items={shareData.map((d, i) => ({
            name: d.name,
            color: paletteColor(i),
            pct: d.value,
          }))}
        />
      </ChartCard>

      <ChartCard title={t('competitors.charts.revenue')} empty={revenueData.length === 0}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={revenueData} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
            <XAxis
              dataKey="name"
              tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
              width={32}
            />
            <RTooltip
              contentStyle={TOOLTIP_STYLE}
              cursor={{ fill: 'rgba(99,102,241,0.08)' }}
              formatter={(v: number) => [formatNumber(v, lang), t('competitors.charts.companies')]}
            />
            <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title={t('competitors.charts.size')} empty={sizeData.length === 0}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={sizeData} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
            <XAxis
              dataKey="name"
              tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
              width={32}
            />
            <RTooltip
              contentStyle={TOOLTIP_STYLE}
              cursor={{ fill: 'rgba(99,102,241,0.08)' }}
              formatter={(v: number) => [formatNumber(v, lang), t('competitors.charts.companies')]}
            />
            <Bar dataKey="count" fill="#a78bfa" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title={t('competitors.charts.regions')} empty={regionData.length === 0}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={regionData}
            layout="vertical"
            margin={{ top: 4, right: 12, bottom: 4, left: 4 }}
          >
            <XAxis type="number" hide allowDecimals={false} />
            <YAxis
              type="category"
              dataKey="name"
              width={96}
              tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
              axisLine={false}
              tickLine={false}
            />
            <RTooltip
              contentStyle={TOOLTIP_STYLE}
              cursor={{ fill: 'rgba(99,102,241,0.08)' }}
              formatter={(v: number) => [formatNumber(v, lang), t('competitors.charts.companies')]}
            />
            <Bar dataKey="count" fill="#60a5fa" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

interface ChartCardProps {
  title: string;
  empty: boolean;
  children: React.ReactNode;
}

function ChartCard({ title, empty, children }: ChartCardProps): JSX.Element {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {empty ? (
          <div className="flex h-[200px] items-center justify-center text-xs text-[color:var(--muted-foreground)]">
            {t('competitors.charts.noData')}
          </div>
        ) : (
          <div className="h-[200px] w-full">{children}</div>
        )}
      </CardContent>
    </Card>
  );
}

interface ShareLegendProps {
  items: Array<{ name: string; color: string; pct: number }>;
}

function ShareLegend({ items }: ShareLegendProps): JSX.Element {
  return (
    <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
      {items.map((it) => (
        <li key={it.name} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 shrink-0 rounded-sm"
            style={{ backgroundColor: it.color }}
            aria-hidden
          />
          <span className="text-[color:var(--muted-foreground)]">{it.name}</span>
          <span className="tabular-nums text-[color:var(--foreground)]">
            {formatPercent(it.pct, 0)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default MarketCharts;
