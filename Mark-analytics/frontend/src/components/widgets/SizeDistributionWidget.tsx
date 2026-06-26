import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Widget } from './Widget';
import { useSizeDistribution, type DistributionBucket } from '../../hooks/useAnalytics';

const SIZE_ORDER = ['micro', 'small', 'medium', 'large', 'enterprise'] as const;
const SIZE_COLORS: Record<string, string> = {
  micro: '#94a3b8',
  small: '#60a5fa',
  medium: '#818cf8',
  large: '#a78bfa',
  enterprise: '#f472b6',
};

interface Slice {
  key: string;
  label: string;
  count: number;
  color: string;
  pct: number;
  startAngle: number;
  endAngle: number;
}

/**
 * Donut chart of company size distribution.
 *
 * Implemented as pure SVG (no recharts dependency) to avoid bundling overhead
 * for this single use-case and to keep the widget self-contained. If recharts
 * lands via another widget we can swap to <PieChart> later.
 */
export function SizeDistributionWidget(): JSX.Element {
  const { t } = useTranslation();
  const { data, isLoading, error } = useSizeDistribution();
  const [hovered, setHovered] = useState<string | null>(null);

  const slices = useMemo<Slice[]>(() => buildSlices(data?.buckets ?? []), [data]);
  const total = useMemo(() => slices.reduce((s, sl) => s + sl.count, 0), [slices]);

  return (
    <Widget
      title={t('widget.size.title')}
      subtitle={total > 0 ? `${total.toLocaleString()} total` : undefined}
      loading={isLoading}
      error={error?.message ?? null}
    >
      {slices.length === 0 ? (
        <div className="flex h-full items-center justify-center text-xs text-neutral-500 dark:text-neutral-400">
          No data
        </div>
      ) : (
        <div className="flex h-full items-center gap-3">
          <Donut slices={slices} hovered={hovered} setHovered={setHovered} />
          <ul className="flex min-w-0 flex-1 flex-col gap-1 text-[11px]">
            {slices.map((sl) => (
              <li
                key={sl.key}
                onMouseEnter={() => setHovered(sl.key)}
                onMouseLeave={() => setHovered(null)}
                className={`flex items-center gap-1.5 truncate ${hovered === sl.key ? 'font-semibold' : ''}`}
              >
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-sm"
                  style={{ backgroundColor: sl.color }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-neutral-700 dark:text-neutral-200">
                  {sl.label}
                </span>
                <span className="tabular-nums text-neutral-500 dark:text-neutral-400">
                  {(sl.pct * 100).toFixed(0)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Widget>
  );
}

interface DonutProps {
  slices: Slice[];
  hovered: string | null;
  setHovered: (k: string | null) => void;
}

function Donut({ slices, hovered, setHovered }: DonutProps): JSX.Element {
  const size = 120;
  const r = 50;
  const inner = 30;
  const cx = size / 2;
  const cy = size / 2;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Size distribution">
      {slices.map((sl) => (
        <path
          key={sl.key}
          d={describeArc(cx, cy, r, inner, sl.startAngle, sl.endAngle)}
          fill={sl.color}
          opacity={hovered && hovered !== sl.key ? 0.4 : 1}
          onMouseEnter={() => setHovered(sl.key)}
          onMouseLeave={() => setHovered(null)}
        >
          <title>{`${sl.label}: ${sl.count.toLocaleString()} (${(sl.pct * 100).toFixed(1)}%)`}</title>
        </path>
      ))}
    </svg>
  );
}

function buildSlices(buckets: DistributionBucket[]): Slice[] {
  if (buckets.length === 0) return [];
  // sort by canonical order, then any extras
  const map = new Map(buckets.map((b) => [b.key.toLowerCase(), b]));
  const ordered: DistributionBucket[] = [];
  for (const k of SIZE_ORDER) {
    const b = map.get(k);
    if (b) ordered.push(b);
    map.delete(k);
  }
  for (const b of map.values()) ordered.push(b);

  const total = ordered.reduce((s, b) => s + b.count, 0) || 1;
  let acc = 0;
  return ordered.map((b) => {
    const pct = b.count / total;
    const start = acc * 360;
    acc += pct;
    const end = acc * 360;
    return {
      key: b.key,
      label: b.label ?? b.key,
      count: b.count,
      color: SIZE_COLORS[b.key.toLowerCase()] ?? '#9ca3af',
      pct,
      startAngle: start,
      endAngle: end,
    };
  });
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number): { x: number; y: number } {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function describeArc(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  startAngle: number,
  endAngle: number,
): string {
  // single-slice edge case: full ring
  if (endAngle - startAngle >= 359.999) {
    return [
      `M ${cx - rOuter} ${cy}`,
      `A ${rOuter} ${rOuter} 0 1 0 ${cx + rOuter} ${cy}`,
      `A ${rOuter} ${rOuter} 0 1 0 ${cx - rOuter} ${cy}`,
      `M ${cx - rInner} ${cy}`,
      `A ${rInner} ${rInner} 0 1 1 ${cx + rInner} ${cy}`,
      `A ${rInner} ${rInner} 0 1 1 ${cx - rInner} ${cy}`,
      'Z',
    ].join(' ');
  }
  const startOuter = polarToCartesian(cx, cy, rOuter, endAngle);
  const endOuter = polarToCartesian(cx, cy, rOuter, startAngle);
  const startInner = polarToCartesian(cx, cy, rInner, endAngle);
  const endInner = polarToCartesian(cx, cy, rInner, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
  return [
    `M ${startOuter.x} ${startOuter.y}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 0 ${endOuter.x} ${endOuter.y}`,
    `L ${endInner.x} ${endInner.y}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 1 ${startInner.x} ${startInner.y}`,
    'Z',
  ].join(' ');
}

export default SizeDistributionWidget;
