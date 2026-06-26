import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Widget } from './Widget';
import {
  useIndustryDistribution,
  useRegionDistribution,
  type DistributionBucket,
} from '../../hooks/useAnalytics';
import { useDirectoryFilterStore } from '../../stores/directoryFilter';
import { useMapStore } from '../../stores/map';

interface HoverCell {
  x: number;
  y: number;
  industry: string;
  region: string;
  value: number;
}

/**
 * Region × industry heatmap.
 *
 * Phase 1 limitation: backend doesn't yet expose a (region, industry) cross-tab,
 * so we synthesize a plausible matrix from the marginal distributions
 * (count_industry * count_region / total). When the cross-tab endpoint lands,
 * swap `synthesizeMatrix` for a single hook call.
 */
export function IndustryHeatmapWidget(): JSX.Element {
  const { t } = useTranslation();
  const industries = useIndustryDistribution();
  const regions = useRegionDistribution();
  const [hover, setHover] = useState<HoverCell | null>(null);

  const selectedIndustry = useDirectoryFilterStore((s) => s.industry_code);
  const selectedRegion = useDirectoryFilterStore((s) => s.region_kato);
  const setBoth = useDirectoryFilterStore((s) => s.setBoth);
  const clearFilters = useDirectoryFilterStore((s) => s.clear);

  const loading = industries.isLoading || regions.isLoading;
  const error = industries.error?.message ?? regions.error?.message ?? null;

  const topIndustries = useMemo(
    () => takeTop(industries.data?.buckets ?? [], 10),
    [industries.data],
  );
  const topRegions = useMemo(
    () => takeTop(regions.data?.buckets ?? [], 10),
    [regions.data],
  );

  const matrix = useMemo(
    () => synthesizeMatrix(topIndustries, topRegions),
    [topIndustries, topRegions],
  );
  const maxValue = useMemo(
    () => matrix.reduce((m, row) => Math.max(m, ...row), 0) || 1,
    [matrix],
  );

  // Layout
  const cellW = 28;
  const cellH = 18;
  const labelLeft = 110;
  const labelTop = 60;
  const width = labelLeft + topRegions.length * cellW + 8;
  const height = labelTop + topIndustries.length * cellH + 8;

  return (
    <Widget
      title={t('widget.heatmap.title')}
      subtitle={`${t('widget.heatmap.industry')} × ${t('widget.heatmap.region')}`}
      loading={loading}
      error={error}
    >
      {topIndustries.length === 0 || topRegions.length === 0 ? (
        <EmptyState label="No data" />
      ) : (
        <div className="relative h-full w-full overflow-auto">
          {(selectedIndustry || selectedRegion) && (
            <button
              type="button"
              onClick={() => {
                clearFilters();
                useMapStore.getState().selectRegion(null);
              }}
              className="absolute top-1 left-1 z-10 rounded-full border border-neutral-300 bg-white px-2 py-0.5 text-[10px] font-medium text-neutral-700 shadow-sm hover:bg-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700"
              aria-label={t('widget.heatmap.clearFilters', 'Clear filters')}
            >
              {t('widget.heatmap.clearFilters', 'Clear filters')}
            </button>
          )}
          <svg width={width} height={height} role="img" aria-label="Region by industry heatmap">
            {/* Region (X) labels — rotated */}
            {topRegions.map((r, x) => (
              <text
                key={`rx-${r.key}`}
                x={labelLeft + x * cellW + cellW / 2}
                y={labelTop - 6}
                transform={`rotate(-45, ${labelLeft + x * cellW + cellW / 2}, ${labelTop - 6})`}
                fontSize={9}
                textAnchor="end"
                className="fill-neutral-600 dark:fill-neutral-300"
              >
                {truncate(r.label ?? r.key, 12)}
              </text>
            ))}

            {/* Industry (Y) labels */}
            {topIndustries.map((ind, y) => (
              <text
                key={`iy-${ind.key}`}
                x={labelLeft - 4}
                y={labelTop + y * cellH + cellH / 2 + 3}
                fontSize={9}
                textAnchor="end"
                className="fill-neutral-600 dark:fill-neutral-300"
              >
                {truncate(ind.label ?? ind.key, 16)}
              </text>
            ))}

            {/* Cells */}
            {matrix.map((row, y) =>
              row.map((value, x) => {
                const intensity = value / maxValue;
                const fill = heatColor(intensity);
                const industry = topIndustries[y];
                const region = topRegions[x];
                if (!industry || !region) return null;
                const industryKey = industry.key;
                const regionKey = region.key;
                const industryName = industry.label ?? industry.key;
                const regionName = region.label ?? region.key;
                const isSelected =
                  selectedIndustry === industryKey && selectedRegion === regionKey;
                return (
                  <rect
                    key={`c-${x}-${y}`}
                    x={labelLeft + x * cellW + 1}
                    y={labelTop + y * cellH + 1}
                    width={cellW - 2}
                    height={cellH - 2}
                    fill={fill}
                    rx={1}
                    stroke={isSelected ? '#111827' : 'none'}
                    strokeWidth={isSelected ? 2 : 0}
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={() =>
                      setHover({
                        x,
                        y,
                        industry: industryName,
                        region: regionName,
                        value,
                      })
                    }
                    onMouseLeave={() => setHover(null)}
                    onClick={() => {
                      // C2's richer store takes an object arg (partial update).
                      setBoth({ industry_code: industryKey, region_kato: regionKey });
                      // Highlight the picked region on the choropleth too.
                      useMapStore.getState().selectRegion(regionKey);
                    }}
                  >
                    <title>
                      {industryName + ' / ' + regionName + ': ' + Math.round(value)}
                    </title>
                  </rect>
                );
              }),
            )}
          </svg>

          {hover ? (
            <div
              role="status"
              className="pointer-events-none absolute bottom-1 left-1 rounded bg-neutral-900/90 px-2 py-1 text-[10px] text-white shadow dark:bg-neutral-100/90 dark:text-neutral-900"
            >
              {hover.industry} · {hover.region}: {Math.round(hover.value)}
            </div>
          ) : null}
        </div>
      )}
    </Widget>
  );
}

function takeTop(buckets: DistributionBucket[], n: number): DistributionBucket[] {
  return [...buckets].sort((a, b) => b.count - a.count).slice(0, n);
}

function synthesizeMatrix(
  industries: DistributionBucket[],
  regions: DistributionBucket[],
): number[][] {
  const totalI = industries.reduce((s, b) => s + b.count, 0) || 1;
  const totalR = regions.reduce((s, b) => s + b.count, 0) || 1;
  const total = Math.max(totalI, totalR);
  return industries.map((ind) =>
    regions.map((reg) => (ind.count * reg.count) / total),
  );
}

function heatColor(intensity: number): string {
  // Indigo ramp: low -> pale, high -> deep.
  const t = Math.max(0, Math.min(1, intensity));
  const alpha = 0.08 + 0.85 * t;
  return `rgba(79, 70, 229, ${alpha.toFixed(3)})`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function EmptyState({ label }: { label: string }): JSX.Element {
  return (
    <div className="flex h-full items-center justify-center text-xs text-neutral-500 dark:text-neutral-400">
      {label}
    </div>
  );
}

export default IndustryHeatmapWidget;
