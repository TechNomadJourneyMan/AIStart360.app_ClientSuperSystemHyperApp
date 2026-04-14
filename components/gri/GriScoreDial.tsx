interface GriScoreDialProps {
  score: number
  previousScore?: number
  label?: string
}

function getScoreLevel(score: number): {
  label: string
  color: string
  ringColor: string
  bgColor: string
} {
  if (score >= 9)   return { label: 'Excellent',   color: 'text-primary',            ringColor: '#6effc0', bgColor: 'bg-primary/10' }
  if (score >= 7)   return { label: 'Strong',      color: 'text-primary-fixed-dim',  ringColor: '#00e29e', bgColor: 'bg-primary-fixed-dim/10' }
  if (score >= 5)   return { label: 'Developing',  color: 'text-tertiary-container', ringColor: '#ffbd60', bgColor: 'bg-tertiary-container/10' }
  return              { label: 'Critical',    color: 'text-error',              ringColor: '#ffb4ab', bgColor: 'bg-error/10' }
}

export function GriScoreDial({ score, previousScore, label = 'GRI Score' }: GriScoreDialProps) {
  const level = getScoreLevel(score)
  const pct = score * 10
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
          <span className={`font-mono text-4xl font-bold leading-none ${level.color}`}>{score}</span>
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
          {delta >= 0 ? '+' : ''}{delta} from last period
        </div>
      )}

      {/* Score Range Legend */}
      <div className="mt-5 w-full space-y-1.5">
        {[
          { range: '9–10',   label: 'Excellent',  color: 'bg-primary' },
          { range: '7–8.9',  label: 'Strong',     color: 'bg-primary-fixed-dim' },
          { range: '5–6.9',  label: 'Developing', color: 'bg-tertiary-container' },
          { range: '< 5',    label: 'Critical',   color: 'bg-error' },
        ].map((item) => (
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
