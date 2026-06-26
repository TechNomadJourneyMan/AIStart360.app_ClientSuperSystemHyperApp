export interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  /** Stroke width in pixels. */
  strokeWidth?: number;
  /** Optional accessible label. */
  ariaLabel?: string;
}

/**
 * Minimal dependency-free SVG sparkline.
 *
 * Renders a polyline scaled to fit `width`/`height`. Empty/flat arrays
 * render a single horizontal mid-line to avoid layout shift.
 */
export function Sparkline({
  values,
  width = 80,
  height = 24,
  color = 'currentColor',
  strokeWidth = 1.25,
  ariaLabel,
}: SparklineProps): JSX.Element {
  const n = values.length;
  if (n === 0) {
    return (
      <svg width={width} height={height} aria-hidden role="img">
        <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke={color} strokeWidth={strokeWidth} opacity={0.4} />
      </svg>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = n > 1 ? width / (n - 1) : 0;

  const points = values
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / span) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel ?? 'Trend sparkline'}
    >
      <polyline
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

export default Sparkline;
