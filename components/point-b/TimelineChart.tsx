/**
 * components/point-b/TimelineChart.tsx — the timeline of the roadmap by quarters (plan Ф5 Task 5, spec §11):
 * a bar per strategy / initiative over the dates of its tasks (the filled part is the progress), diamonds for
 * the milestones, a line for today. Plain SVG; the geometry is strategyModel.timelineGeometry (pure, no NaN).
 *
 * The chart is a picture of what the list under it says in words (the quarter list in RoadmapTab): it has a text
 * alternative, and on a phone it is not shown at all — the list is the phone version. Project tokens only.
 */
import { DASH } from './overviewModel'
import { fmtDay, roadmapSummary, timelineGeometry, type Roadmap } from './strategyModel'

export default function TimelineChart({ roadmap, className }: { roadmap: Roadmap; className?: string }) {
  const geo = timelineGeometry(roadmap)
  if (!geo) return null

  return (
    <figure className={className}>
      <svg
        role="img"
        aria-label={roadmapSummary(roadmap)}
        viewBox={`0 0 ${geo.width} ${geo.height}`}
        className="block h-auto w-full"
      >
        {/* quarters */}
        {geo.quarters.map((q, i) => (
          <g key={q.key} className="text-outline-variant">
            <rect x={q.x} y={geo.plot.top - 26} width={q.w} height={geo.plot.bottom - geo.plot.top + 26} fill="currentColor" fillOpacity={i % 2 === 0 ? 0.06 : 0} />
            <line x1={q.x} x2={q.x} y1={geo.plot.top - 50} y2={geo.plot.bottom} stroke="currentColor" strokeOpacity={0.4} />
            <text x={q.x + q.w / 2} y={16} textAnchor="middle" fontSize={11} className={q.current ? 'font-mono text-primary' : 'font-mono text-on-surface-variant'} fill="currentColor">{q.label}</text>
          </g>
        ))}

        {/* milestone lane */}
        <text x={geo.plot.left - 10} y={geo.milestoneLane.y + 17} textAnchor="end" fontSize={11} fill="currentColor" className="text-on-surface-variant">Контрольные точки</text>
        {geo.milestones.map((m) => (
          <g key={m.key} className="text-tertiary-fixed-dim">
            <title>{`${m.title || DASH} · ${fmtDay(m.date)}`}</title>
            <path d={`M ${m.x} ${m.y - 8} L ${m.x + 8} ${m.y} L ${m.x} ${m.y + 8} L ${m.x - 8} ${m.y} Z`} fill="currentColor" fillOpacity={0.35} stroke="currentColor" strokeWidth={1.5} />
          </g>
        ))}

        {/* rows */}
        {geo.rows.map((r) => (
          <g key={r.key}>
            <title>{r.full}</title>
            <text
              x={r.kind === 'strategy' ? 4 : 16}
              y={r.y + 17}
              fontSize={11}
              fontWeight={r.kind === 'strategy' ? 700 : 400}
              fill="currentColor"
              className="text-on-surface"
            >
              {r.label}
            </text>
            {r.bar ? (
              <g className={r.kind === 'strategy' ? 'text-secondary' : 'text-primary'}>
                <rect x={r.bar.x1} y={r.y + 6} width={r.bar.x2 - r.bar.x1} height={r.kind === 'strategy' ? 14 : 10} rx={3} fill="currentColor" fillOpacity={0.18} stroke="currentColor" strokeOpacity={0.7} />
                {r.bar.fillX > r.bar.x1 && (
                  <rect x={r.bar.x1} y={r.y + 6} width={r.bar.fillX - r.bar.x1} height={r.kind === 'strategy' ? 14 : 10} rx={3} fill="currentColor" fillOpacity={0.7} />
                )}
                <text x={Math.min(r.bar.x2 + 6, geo.plot.right - 4)} y={r.y + 17} fontSize={10} textAnchor={r.bar.x2 + 6 > geo.plot.right - 90 ? 'end' : 'start'} fill="currentColor" className="font-mono text-on-surface-variant">
                  {r.percent === null ? (r.state === 'no_tasks' ? 'нет задач' : DASH) : `${r.percent}%`}
                </text>
              </g>
            ) : (
              <text x={geo.plot.left + 6} y={r.y + 17} fontSize={10} fill="currentColor" className="font-mono text-on-surface-variant">без срока</text>
            )}
          </g>
        ))}

        {/* today */}
        {geo.todayX !== null && (
          <g className="text-error">
            <line x1={geo.todayX} x2={geo.todayX} y1={geo.plot.top - 26} y2={geo.plot.bottom} stroke="currentColor" strokeWidth={1.5} strokeDasharray="4 3" />
            <text x={geo.todayX + 4} y={geo.plot.bottom + 13} fontSize={10} fill="currentColor" className="font-mono">сегодня</text>
          </g>
        )}
      </svg>

      <figcaption>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-on-surface-variant">
          <li className="flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-4 rounded-sm border border-secondary bg-secondary/40" />Стратегия</li>
          <li className="flex items-center gap-1.5"><span aria-hidden className="h-2 w-4 rounded-sm border border-primary bg-primary/40" />Инициатива (закрашено — выполнено)</li>
          <li className="flex items-center gap-1.5"><span aria-hidden className="inline-block h-2.5 w-2.5 rotate-45 border border-tertiary-fixed-dim" />Контрольная точка</li>
          {geo.todayX !== null && <li className="flex items-center gap-1.5"><span aria-hidden className="h-3 w-0 border-l-2 border-dashed border-error" />Сегодня</li>}
        </ul>
      </figcaption>
    </figure>
  )
}
