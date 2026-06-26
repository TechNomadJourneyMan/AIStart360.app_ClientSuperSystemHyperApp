import { useMemo, useState } from 'react';
import type { DistributionBucket } from '@/hooks/useAnalytics';

export interface IndustryTreemapProps {
  buckets: DistributionBucket[];
  width?: number;
  height?: number;
  onSelect: (bucket: DistributionBucket) => void;
}

interface TreemapTile {
  bucket: DistributionBucket;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Hand-rolled squarified treemap. ~80 lines vs. recharts' Treemap which
 * needs heavy custom-content overrides to look acceptable on a hero page.
 *
 * Renders up to N tiles (sorted by count desc). Click → onSelect(bucket).
 */
export function IndustryTreemap({
  buckets,
  width = 1100,
  height = 360,
  onSelect,
}: IndustryTreemapProps): JSX.Element {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const tiles = useMemo<TreemapTile[]>(() => {
    const top = [...buckets]
      .filter((b) => b.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 16);
    if (top.length === 0) return [];
    return squarify(top, 0, 0, width, height);
  }, [buckets, width, height]);

  if (tiles.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-dashed border-[color:var(--border)] text-sm text-[color:var(--muted-foreground)]"
        style={{ height }}
      >
        No industry data
      </div>
    );
  }

  return (
    <div className="relative w-full overflow-hidden rounded-lg border border-[color:var(--border)] bg-[color:var(--card)]">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label="Industry distribution treemap"
        preserveAspectRatio="none"
      >
        {tiles.map((t, idx) => {
          const isHover = hoverIdx === idx;
          const fill = paletteColor(idx, tiles.length);
          const showLabel = t.w > 70 && t.h > 30;
          const showCount = t.w > 90 && t.h > 50;
          return (
            <g
              key={t.bucket.key}
              role="button"
              tabIndex={0}
              aria-label={`${t.bucket.label ?? t.bucket.key}: ${t.bucket.count}`}
              onClick={() => onSelect(t.bucket)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(t.bucket);
                }
              }}
              onMouseEnter={() => setHoverIdx(idx)}
              onMouseLeave={() => setHoverIdx((cur) => (cur === idx ? null : cur))}
              style={{ cursor: 'pointer' }}
            >
              <rect
                x={t.x + 1}
                y={t.y + 1}
                width={Math.max(0, t.w - 2)}
                height={Math.max(0, t.h - 2)}
                fill={fill}
                opacity={isHover ? 1 : 0.92}
                rx={4}
              />
              {showLabel ? (
                <text
                  x={t.x + 10}
                  y={t.y + 22}
                  fontSize={12}
                  fontWeight={600}
                  fill="#fff"
                  style={{ pointerEvents: 'none' }}
                >
                  {truncate(t.bucket.label ?? t.bucket.key, Math.max(6, Math.floor(t.w / 7)))}
                </text>
              ) : null}
              {showCount ? (
                <text
                  x={t.x + 10}
                  y={t.y + 40}
                  fontSize={11}
                  fill="#fff"
                  opacity={0.85}
                  style={{ pointerEvents: 'none' }}
                >
                  {t.bucket.count.toLocaleString()}
                </text>
              ) : null}
              <title>
                {(t.bucket.label ?? t.bucket.key) + ': ' + t.bucket.count.toLocaleString()}
              </title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s;
}

/**
 * Squarified treemap (Bruls/Huijing/van Wijk 2000) — simplified single-pass
 * variant. Inputs are sorted by count desc; outputs are tile rects that
 * tile [x..x+w] × [y..y+h] without overlap.
 */
function squarify(
  buckets: DistributionBucket[],
  x: number,
  y: number,
  w: number,
  h: number,
): TreemapTile[] {
  const total = buckets.reduce((s, b) => s + b.count, 0);
  if (total <= 0 || w <= 0 || h <= 0) return [];
  const area = w * h;
  const items = buckets.map((b) => ({ bucket: b, weight: (b.count / total) * area }));

  const tiles: TreemapTile[] = [];
  let cx = x;
  let cy = y;
  let cw = w;
  let ch = h;
  let i = 0;

  while (i < items.length) {
    const horizontal = cw >= ch;
    const span = horizontal ? ch : cw;
    let row: Array<{ bucket: DistributionBucket; weight: number }> = [];
    let bestRatio = Infinity;

    // Greedy: add items to the current row until the worst aspect ratio gets worse.
    while (i + row.length < items.length) {
      const next = items[i + row.length];
      if (!next) break;
      const candidate = [...row, next];
      const sum = candidate.reduce((s, it) => s + it.weight, 0);
      const length = sum / span;
      const worst = candidate.reduce((m, it) => {
        const side = it.weight / length;
        const r = Math.max(side / length, length / side);
        return Math.max(m, r);
      }, 1);
      if (worst > bestRatio && row.length > 0) break;
      bestRatio = worst;
      row = candidate;
    }
    if (row.length === 0) {
      const head = items[i];
      if (!head) break;
      row = [head];
    }

    const rowSum = row.reduce((s, it) => s + it.weight, 0);
    const length = rowSum / span;

    let offset = 0;
    for (const it of row) {
      const side = it.weight / length;
      if (horizontal) {
        tiles.push({ bucket: it.bucket, x: cx, y: cy + offset, w: length, h: side });
        offset += side;
      } else {
        tiles.push({ bucket: it.bucket, x: cx + offset, y: cy, w: side, h: length });
        offset += side;
      }
    }

    if (horizontal) {
      cx += length;
      cw -= length;
    } else {
      cy += length;
      ch -= length;
    }
    i += row.length;
  }

  return tiles;
}

function paletteColor(idx: number, total: number): string {
  // Indigo → cyan spectrum at high saturation; deterministic across renders.
  const hue = 220 + ((idx / Math.max(1, total - 1)) * 80 - 40);
  return `hsl(${hue.toFixed(0)} 60% 42%)`;
}

export default IndustryTreemap;
