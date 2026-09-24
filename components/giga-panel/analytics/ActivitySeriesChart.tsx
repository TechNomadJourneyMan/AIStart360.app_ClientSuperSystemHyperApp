'use client'

/**
 * DAU / WAU / MAU by day as layered CSS columns (no chart library, like the
 * rest of the GIGA kit): the faint column is MAU, the middle one WAU, the solid
 * one DAU — all on the same scale, so the gaps between them read as
 * «how many of the monthly audience come back weekly / daily».
 */
import type { ActivityPoint } from '@/lib/analytics/reports'
import { fmtPct } from '@/lib/analytics/reports'

const dayLabel = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })

export function ActivitySeriesChart({ points, height = 140 }: { points: ActivityPoint[]; height?: number }) {
  const rolled = points.filter((p) => p.rolled)
  if (!rolled.length) {
    return (
      <p className="py-8 text-center text-xs text-slate-600">
        Данных ещё нет: ежедневная свёртка активности запускается ночью (03:00 по Алматы) и догоняет последние 90 дней.
      </p>
    )
  }
  const max = Math.max(1, ...points.map((p) => p.mau))
  const last = rolled[rolled.length - 1]
  const h = (v: number) => `${Math.max(v ? 3 : 0, (v / max) * 100)}%`

  return (
    <figure aria-label="Активные пользователи по дням: DAU, WAU, MAU">
      <div className="mb-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
        <Metric label="DAU" value={last.dau} tone="bg-blue-400" />
        <Metric label="WAU (7 дн)" value={last.wau} tone="bg-blue-400/50" />
        <Metric label="MAU (30 дн)" value={last.mau} tone="bg-blue-400/20" />
        <div title="Stickiness = DAU / MAU: какая доля месячной аудитории заходит каждый день">
          <p className="text-lg font-bold tabular-nums text-slate-100">{fmtPct(last.stickiness)}</p>
          <p className="text-[10px] text-slate-500">DAU / MAU</p>
        </div>
      </div>
      <div className="flex items-end gap-[2px]" style={{ height }}>
        {points.map((p) => (
          <div
            key={p.day}
            className="group relative flex h-full flex-1 items-end"
            title={p.rolled
              ? `${dayLabel(p.day)}: DAU ${p.dau} · WAU ${p.wau} · MAU ${p.mau} · stickiness ${fmtPct(p.stickiness)}`
              : `${dayLabel(p.day)}: ещё не свёрнут`}
          >
            {p.rolled ? (
              <>
                <div className="absolute bottom-0 left-0 right-0 rounded-t bg-blue-400/15" style={{ height: h(p.mau) }} />
                <div className="absolute bottom-0 left-0 right-0 rounded-t bg-blue-400/35" style={{ height: h(p.wau) }} />
                <div className="absolute bottom-0 left-0 right-0 rounded-t bg-blue-400 transition-colors group-hover:bg-blue-300" style={{ height: h(p.dau) }} />
              </>
            ) : (
              <div className="w-full border-b border-dashed border-white/[0.12]" />
            )}
          </div>
        ))}
      </div>
      <figcaption className="mt-1 flex justify-between text-[10px] text-slate-600">
        <span>{dayLabel(points[0].day)}</span>
        <span>макс. MAU {max}</span>
        <span>{dayLabel(points[points.length - 1].day)}</span>
      </figcaption>
    </figure>
  )
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div>
      <p className="text-lg font-bold tabular-nums text-slate-100">{value.toLocaleString('ru-RU')}</p>
      <p className="flex items-center justify-center gap-1 text-[10px] text-slate-500">
        <span className={`inline-block h-2 w-2 rounded-sm ${tone}`} aria-hidden />
        {label}
      </p>
    </div>
  )
}
