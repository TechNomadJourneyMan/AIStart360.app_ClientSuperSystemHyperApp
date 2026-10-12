'use client'

/** History and dynamics (spec §2.5/§4.8): the score over snapshots and «что изменилось и почему». */
import type { PointAPageState } from '@/hooks/usePointAState'
import { CARD, SectionTitle } from './ui'

function Sparkline({ points }: { points: Array<{ t: string; v: number }> }) {
  if (points.length < 2) return null
  const w = 320
  const h = 64
  const xs = points.map((_, i) => (i / (points.length - 1)) * (w - 8) + 4)
  const min = Math.min(...points.map((p) => p.v))
  const max = Math.max(...points.map((p) => p.v))
  const span = Math.max(1, max - min)
  const ys = points.map((p) => h - 6 - ((p.v - min) / span) * (h - 12))
  const d = xs.map((x, i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet" role="img" aria-label={`Динамика балла: от ${points[0].v} до ${points[points.length - 1].v}`}>
      <path d={d} fill="none" stroke="#6effc0" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {xs.map((x, i) => <circle key={i} cx={x} cy={ys[i]} r={2.5} fill="#6effc0" />)}
    </svg>
  )
}

export function HistorySection({ history }: { history: PointAPageState['history'] }) {
  if (!history.length) return null
  const chrono = history.slice().reverse()
  const points = chrono.filter((h) => h.overall !== null).map((h) => ({ t: h.createdAt, v: h.overall as number }))
  return (
    <section className={CARD} aria-labelledby="pa-history">
      <SectionTitle icon="history"><span id="pa-history">История и динамика</span></SectionTitle>
      <Sparkline points={points} />
      <ol className="mt-3 space-y-3">
        {history.slice(0, 8).map((h) => (
          <li key={h.id} className="border-l-2 border-primary/30 pl-3">
            <p className="text-[11px] font-mono text-on-surface-variant">
              {new Date(h.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
              {h.overall !== null && <span className="ml-2 text-on-surface">балл {h.overall}</span>}
            </p>
            <ul className="mt-0.5 space-y-0.5">
              {(h.changes.length ? h.changes : ['Пересчёт без изменений в баллах']).slice(0, 5).map((c, i) => <li key={i} className="text-xs text-on-surface">{c}</li>)}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  )
}
