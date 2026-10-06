import Link from 'next/link'
import { PORTFOLIO_GRI_DOMAINS, type PortfolioGRI } from '@/lib/portfolio-gri'
import { plural } from '@/lib/crm/digest'

/**
 * Portfolio GRI on the staff dashboard: mean of the clients' current GRI
 * assessments (lib/portfolio-gri.ts). A section without answers is shown as
 * «нет данных», not as 0; no benchmark polygon — there is no measured target
 * to compare with.
 */
interface Props {
  data: PortfolioGRI | null
  /** The read failed — say so instead of showing an empty portfolio. */
  failed?: boolean
}

const N = 7
const SIZE = 220
const C = SIZE / 2
const R_MAX = 72
const R_LABEL = 92

function point(r: number, i: number) {
  const a = (Math.PI * 2 * i) / N - Math.PI / 2
  return { x: C + r * Math.cos(a), y: C + r * Math.sin(a) }
}

function ring(frac: number) {
  return Array.from({ length: N }, (_, i) => {
    const p = point(frac * R_MAX, i)
    return `${p.x.toFixed(1)},${p.y.toFixed(1)}`
  }).join(' ')
}

function anchor(i: number): 'start' | 'middle' | 'end' {
  const { x } = point(R_LABEL, i)
  if (x < C - 12) return 'end'
  if (x > C + 12) return 'start'
  return 'middle'
}

function scoreColor(s: number) {
  if (s < 3) return '#ff6b6b'
  if (s < 6) return '#ffbd60'
  return '#6effc0'
}

function scoreLabel(s: number) {
  if (s < 3) return 'Критично'
  if (s < 5) return 'Низкий'
  if (s < 7) return 'Средний'
  if (s < 9) return 'Высокий'
  return 'Отлично'
}

function Header({ overall, count }: { overall: number | null; count: number | null }) {
  const color = overall !== null ? scoreColor(overall) : undefined
  return (
    <div className="flex items-start justify-between gap-3 mb-3">
      <div>
        <p className="text-[10px] font-mono text-primary/60 uppercase tracking-widest">GRI портфеля</p>
        <div className="flex items-baseline gap-1.5 mt-0.5">
          {overall !== null ? (
            <>
              <span className="text-xl font-mono font-bold" style={{ color }}>{overall.toFixed(2)}</span>
              <span className="text-xs text-on-surface-variant">/ 10</span>
              <span
                className="text-[10px] font-mono px-1.5 py-0.5 rounded-full border"
                style={{ color, borderColor: `${color}33`, background: `${color}11` }}
              >
                {scoreLabel(overall)}
              </span>
            </>
          ) : (
            <>
              <span className="text-xl font-mono font-bold text-on-surface-variant/40">—</span>
              <span className="text-xs text-on-surface-variant/40">/ 10</span>
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3">
        {count !== null && (
          <span className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider">
            {count} {plural(count, 'оценка', 'оценки', 'оценок')}
          </span>
        )}
        <Link
          href="/gri"
          className="flex items-center gap-0.5 text-xs text-on-surface-variant hover:text-primary transition-colors rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          Подробнее
          <span className="material-symbols-outlined text-sm" aria-hidden="true">arrow_forward</span>
        </Link>
      </div>
    </div>
  )
}

export function PortfolioGriPanel({ data, failed = false }: Props) {
  if (failed || !data) {
    return (
      <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-4 min-h-[260px] flex flex-col">
        <Header overall={null} count={null} />
        <div className="flex-1 flex flex-col items-center justify-center text-center py-8" role={failed ? 'alert' : undefined}>
          <span className={`material-symbols-outlined text-5xl mb-3 ${failed ? 'text-error/60' : 'text-on-surface-variant/20'}`} aria-hidden="true">
            {failed ? 'error' : 'analytics'}
          </span>
          <p className="text-sm font-medium text-on-surface-variant mb-1">
            {failed ? 'Не удалось загрузить оценки GRI' : 'Оценок GRI пока нет'}
          </p>
          <p className="text-xs text-on-surface-variant/60 max-w-xs leading-relaxed">
            {failed
              ? 'Попробуйте обновить страницу. Остальные данные дашборда от этого не зависят.'
              : 'Индекс портфеля появится, когда клиенты пройдут оценку GRI.'}
          </p>
        </div>
      </div>
    )
  }

  const domains = PORTFOLIO_GRI_DOMAINS.map((d) => ({ ...d, score: data[d.key] }))
  const complete = domains.every((d) => d.score !== null)
  const polygon = complete
    ? domains.map((d, i) => {
        const p = point(((d.score as number) / 10) * R_MAX, i)
        return `${p.x.toFixed(1)},${p.y.toFixed(1)}`
      }).join(' ')
    : null

  return (
    <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-4">
      <Header overall={data.overall} count={data.reportCount} />

      <div className="flex flex-col sm:flex-row gap-4 items-start">
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="flex-shrink-0 overflow-visible mx-auto sm:mx-0"
          role="img"
          aria-label="Радар GRI портфеля по семи разделам"
        >
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <polygon key={f} points={ring(f)} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
          ))}
          {domains.map((_, i) => {
            const end = point(R_MAX, i)
            return <line key={i} x1={C} y1={C} x2={end.x} y2={end.y} stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
          })}
          {polygon && (
            <polygon points={polygon} fill="rgba(110,255,192,0.10)" stroke="#6effc0" strokeWidth="1.5" />
          )}
          {domains.map((d, i) => {
            if (d.score === null) return null
            const p = point((d.score / 10) * R_MAX, i)
            return <circle key={d.key} cx={p.x} cy={p.y} r={3.5} fill={scoreColor(d.score)} stroke="#0e0f14" strokeWidth="1.5" />
          })}
          {domains.map((d, i) => {
            const lp = point(R_LABEL, i)
            return (
              <text
                key={d.key}
                x={lp.x}
                y={lp.y}
                textAnchor={anchor(i)}
                dominantBaseline="middle"
                fontSize="8"
                fontFamily="monospace"
                fill={d.score === null ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.40)'}
              >
                {d.short}
              </text>
            )
          })}
          <text x={C} y={C - 4} textAnchor="middle" fontSize="12" fill="rgba(255,255,255,0.9)" fontFamily="monospace" fontWeight="bold">
            {data.overall !== null ? data.overall.toFixed(1) : '—'}
          </text>
          <text x={C} y={C + 9} textAnchor="middle" fontSize="6" fill="rgba(255,255,255,0.25)" fontFamily="monospace">
            GRI
          </text>
        </svg>

        <div className="flex-1 w-full flex flex-col gap-2 pt-1">
          {domains.map((d) => (
            <div key={d.key}>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[11px] text-on-surface-variant">{d.label}</span>
                {d.score !== null ? (
                  <span className="text-[11px] font-mono font-bold" style={{ color: scoreColor(d.score) }}>
                    {d.score.toFixed(1)}
                  </span>
                ) : (
                  <span className="text-[10px] font-mono text-on-surface-variant/50">нет данных</span>
                )}
              </div>
              <div className="h-1 bg-surface-container rounded-full overflow-hidden">
                {d.score !== null && (
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.round((d.score / 10) * 100)}%`, background: scoreColor(d.score), opacity: 0.8 }}
                  />
                )}
              </div>
            </div>
          ))}
          <p className="text-[10px] text-on-surface-variant/60 leading-relaxed mt-1">
            Среднее по актуальным оценкам GRI клиентов (одна на клиента). Разделы без ответов в среднее не входят.
          </p>
        </div>
      </div>
    </div>
  )
}
