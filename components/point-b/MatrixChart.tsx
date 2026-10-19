/**
 * components/point-b/MatrixChart.tsx — the «влияние × усилие» matrix of strategies and initiatives (plan Ф5
 * Task 5, spec §11). Plain SVG (viewBox, scales to the width), geometry from strategyModel (pure, no NaN).
 *
 * Accessibility: the SVG has a text alternative (aria-label with every point by quadrant) and the SAME points are
 * listed below it by quadrant with the numbers drawn on the chart — the list is the readable version on a phone.
 * A strategy is a square, an initiative a circle, so the kind is not told by colour alone. Only rated nodes are drawn;
 * how many are not rated is stated under the chart. Project tokens through currentColor.
 */
import { Icon } from '@/components/point-a-v4/ui'
import { DASH } from './overviewModel'
import { matrixGeometry, matrixGroups, matrixSummary, ratingText, unratedText, type MatrixGroup } from './strategyModel'
import type { MatrixPoint } from '@/lib/point-b/strategy/matrix'

const QUADRANT_TONE: Record<MatrixGroup['quadrant'], string> = {
  quick_wins: 'text-primary',
  big_bets: 'text-secondary',
  fill_ins: 'text-on-surface-variant',
  avoid: 'text-error',
}

export default function MatrixChart({ matrix, className }: { matrix: { points: MatrixPoint[]; unrated: number }; className?: string }) {
  const groups = matrixGroups(matrix.points)
  const geo = matrixGeometry(groups)

  if (matrix.points.length === 0) {
    return (
      <div className={className}>
        <div role="note" className="rounded-xl border border-dashed border-white/[0.1] p-4 text-center text-xs text-on-surface-variant">
          <Icon name="grid_view" className="mb-1 block text-2xl text-on-surface-variant/50" />
          Матрицу пока нечем заполнить: ни у одной стратегии или инициативы нет оценки влияния и усилия ({unratedText(matrix.unrated)}).
        </div>
      </div>
    )
  }

  return (
    <figure className={className}>
      <svg
        role="img"
        aria-label={matrixSummary(matrix)}
        viewBox={`0 0 ${geo.width} ${geo.height}`}
        className="mx-auto block h-auto w-full max-w-[480px]"
      >
        {geo.quadrants.map((q) => (
          <g key={q.quadrant} className={QUADRANT_TONE[q.quadrant]}>
            <rect x={q.x} y={q.y} width={q.w} height={q.h} fill="currentColor" fillOpacity={0.07} stroke="currentColor" strokeOpacity={0.25} />
            <text x={q.tx} y={q.ty} textAnchor={q.anchor} fontSize={10} fill="currentColor" className="font-mono uppercase" fillOpacity={0.9}>{q.label}</text>
          </g>
        ))}

        <g className="font-mono text-on-surface-variant" fill="currentColor" fontSize={10}>
          {geo.xTicks.map((t) => <text key={t.label} x={t.x} y={geo.plot.bottom + 14} textAnchor="middle">{t.label}</text>)}
          {geo.yTicks.map((t) => <text key={t.label} x={geo.plot.left - 8} y={t.y + 3} textAnchor="end">{t.label}</text>)}
          <text x={(geo.plot.left + geo.plot.right) / 2} y={geo.plot.bottom + 32} textAnchor="middle">Усилие →</text>
          <text transform={`translate(10 ${(geo.plot.top + geo.plot.bottom) / 2}) rotate(-90)`} textAnchor="middle">Влияние →</text>
        </g>

        {geo.points.map((p) => (
          <g key={p.key} className="text-primary">
            {p.kind === 'strategy'
              ? <rect x={p.x - 9} y={p.y - 9} width={18} height={18} rx={3} fill="currentColor" fillOpacity={0.25} stroke="currentColor" strokeWidth={1.5} />
              : <circle cx={p.x} cy={p.y} r={9} fill="currentColor" fillOpacity={0.25} stroke="currentColor" strokeWidth={1.5} />}
            <text x={p.x} y={p.y + 3.5} textAnchor="middle" fontSize={10} fontWeight={700} fill="currentColor" className="text-on-surface">{p.n}</text>
          </g>
        ))}
      </svg>

      <figcaption className="mt-3 space-y-3">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-on-surface-variant">
          <li className="flex items-center gap-1.5"><span aria-hidden className="h-3 w-3 rounded-[3px] border-2 border-primary" />Стратегия</li>
          <li className="flex items-center gap-1.5"><span aria-hidden className="h-3 w-3 rounded-full border-2 border-primary" />Инициатива</li>
          <li>{unratedText(matrix.unrated)}{matrix.unrated > 0 ? ' — в матрицу не попали' : ''}</li>
        </ul>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {groups.map((g) => (
            <section key={g.quadrant} aria-label={g.label}>
              <h4 className={`text-xs font-semibold ${QUADRANT_TONE[g.quadrant]}`}>{g.label}</h4>
              <p className="text-[11px] text-on-surface-variant">{g.hint}</p>
              {g.points.length === 0 ? (
                <p className="mt-1 text-xs text-on-surface-variant">{DASH}</p>
              ) : (
                <ol className="mt-1 space-y-0.5 text-xs text-on-surface">
                  {g.points.map((p) => (
                    <li key={p.key} className="flex gap-1.5">
                      <span className="w-5 shrink-0 text-right font-mono text-on-surface-variant">{p.n}.</span>
                      <span className="min-w-0 break-words">
                        {p.title || DASH}
                        <span className="text-on-surface-variant"> · {p.kind === 'strategy' ? 'стратегия' : 'инициатива'} · {ratingText('Влияние', p.impact)}, {ratingText('Усилие', p.effort).toLowerCase()}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          ))}
        </div>
      </figcaption>
    </figure>
  )
}
