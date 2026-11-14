import { formatGri, formatGriDelta, griZone, griPercentOfScale, GRI_TONE_HEX, GRI_ZONES, type GriTone } from '@/lib/format/gri'

interface GriScoreDialProps {
  score: number
  previousScore?: number
  label?: string
}

const TONE_STYLE: Record<GriTone, { color: string; bgColor: string; dot: string }> = {
  green: { color: 'text-primary', bgColor: 'bg-primary/10', dot: 'bg-primary' },
  amber: { color: 'text-tertiary-container', bgColor: 'bg-tertiary-container/10', dot: 'bg-tertiary-container' },
  red: { color: 'text-error', bgColor: 'bg-error/10', dot: 'bg-error' },
}

/** Level from the one set of GRI zones (lib/format/gri.ts, R-036). */
function getScoreLevel(score: number): {
  label: string
  color: string
  ringColor: string
  bgColor: string
} {
  const zone = griZone(score)
  if (!zone) return { label: 'нет данных', color: 'text-on-surface-variant', ringColor: 'rgba(255,255,255,0.2)', bgColor: 'bg-white/[0.04]' }
  return { label: zone.label, ...TONE_STYLE[zone.tone], ringColor: GRI_TONE_HEX[zone.tone] }
}

/** Legend rows straight from GRI_ZONES. */
const LEGEND = [...GRI_ZONES].reverse().map((z, i, arr) => {
  const upper = i === 0 ? 10 : arr[i - 1].min
  return { range: i === 0 ? `${z.min}–${upper}` : `${z.min}–<${upper}`, label: z.label, color: TONE_STYLE[z.tone].dot }
})

export function GriScoreDial({ score, previousScore, label = 'GRI Score' }: GriScoreDialProps) {
  const level = getScoreLevel(score)
  const pct = griPercentOfScale(score)
  // SVG arc for circular progress
  const r = 54
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - pct / 100)
  const delta = previousScore !== undefined ? score - previousScore : null

  return (
    <div className="bg-surface-container rounded-xl p-6 flex flex-col items-center">
      <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-4">{label}</p>

      {/* SVG Dial */}
      <div className="relative w-36 h-36">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 128 128">
          {/* Track */}
          <circle cx="64" cy="64" r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="10" />
          {/* Progress */}
          <circle
            cx="64" cy="64" r={r}
            fill="none"
            stroke={level.ringColor}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 1s ease-out' }}
          />
        </svg>
        {/* Center Score */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`font-mono text-4xl font-bold leading-none ${level.color}`}>{formatGri(score, { empty: '—' })}</span>
          <span className="font-mono text-[9px] text-on-surface-variant uppercase tracking-widest mt-1">/ 10</span>
        </div>
      </div>

      {/* Level Badge */}
      <span className={`mt-4 text-[10px] font-mono px-3 py-1 rounded-full border uppercase tracking-wider ${level.bgColor} ${level.color} border-current/20`}>
        {level.label}
      </span>

      {/* Delta */}
      {delta !== null && (
        <div className={`flex items-center gap-1 mt-3 text-xs font-mono ${delta >= 0 ? 'text-primary' : 'text-error'}`}>
          <span className="material-symbols-outlined text-sm">
            {delta >= 0 ? 'trending_up' : 'trending_down'}
          </span>
          {formatGriDelta(delta)} с прошлого периода
        </div>
      )}

      {/* Score Range Legend */}
      <div className="mt-5 w-full space-y-1.5">
        {LEGEND.map((item) => (
          <div key={item.range} className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${item.color}`} />
            <span className="text-[10px] font-mono text-on-surface-variant">{item.range}</span>
            <span className="text-[10px] font-mono text-on-surface-variant ml-auto">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
