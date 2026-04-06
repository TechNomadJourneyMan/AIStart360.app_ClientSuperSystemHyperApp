'use client'

import { useState } from 'react'
import type { PointA } from '@/types/onboarding'

interface Props {
  pointA: PointA
  orgName?: string
}

// ── Radar geometry (5-axis variant of GriDiagramWidget) ───────────────────────
const N       = 5
const SVG_W   = 240
const SVG_H   = 220
const CX      = 120
const CY      = 110
const R_MAX   = 72
const R_LABEL = 90

const LABELS = ['Финансы', 'Продажи', 'Операции', 'Маркетинг', 'Стратегия']
const KEYS   = ['finance', 'sales', 'operations', 'marketing', 'strategy'] as const

function angle(i: number) { return (Math.PI * 2 * i) / N - Math.PI / 2 }

function pt(r: number, i: number) {
  const a = angle(i)
  return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) }
}

function polyPoints(values: number[]) {
  return values.map((v, i) => {
    const p = pt((v / 10) * R_MAX, i)
    return `${p.x.toFixed(1)},${p.y.toFixed(1)}`
  }).join(' ')
}

function gridPoints(frac: number) {
  return Array.from({ length: N }, (_, i) => {
    const p = pt(frac * R_MAX, i)
    return `${p.x.toFixed(1)},${p.y.toFixed(1)}`
  }).join(' ')
}

function textAnchor(i: number) {
  const { x } = pt(R_LABEL, i)
  if (x < CX - 12) return 'end'
  if (x > CX + 12) return 'start'
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

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase() || '?'
}

const TT_W = 90
const TT_H = 26
function ttX(px: number) { return Math.max(2, Math.min(SVG_W - TT_W - 2, px - TT_W / 2)) }
function ttY(py: number) { return py < 40 ? py + 10 : py - TT_H - 8 }

export function PointARadarWidget({ pointA, orgName }: Props) {
  const [hovered, setHovered] = useState<number | null>(null)

  // Convert 0-100 scores to 0-10 for radar
  const scores = KEYS.map(k => (pointA.blocks[k]?.score ?? 0) / 10)
  const totalScore10 = pointA.overall_score / 10
  const overallColor = scoreColor(totalScore10)
  const overallLabel = scoreLabel(totalScore10)

  const stageLabels: Record<string, string> = {
    seed: 'Seed', early: 'Early', growth: 'Growth', scale: 'Scale', mature: 'Mature'
  }

  return (
    <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-[10px] font-mono text-primary/60 uppercase tracking-widest">Point A — Точка А</p>
          <div className="flex items-baseline gap-1.5 mt-0.5">
            <span className="text-xl font-mono font-bold" style={{ color: overallColor }}>
              {totalScore10.toFixed(1)}
            </span>
            <span className="text-xs text-on-surface-variant">/ 10</span>
            <span
              className="text-[10px] font-mono px-1.5 py-0.5 rounded-full border"
              style={{ color: overallColor, borderColor: overallColor + '33', background: overallColor + '11' }}
            >
              {overallLabel}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {orgName && (
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 border border-primary/20"
              style={{ background: 'rgba(110,255,192,0.12)', color: '#6effc0' }}
              title={orgName}
            >
              {initials(orgName)}
            </div>
          )}
          <span className="text-xs font-mono text-on-surface-variant/40">
            {stageLabels[pointA.stage] ?? pointA.stage}
          </span>
        </div>
      </div>

      {/* Body: radar + bars */}
      <div className="flex gap-3 items-start">

        {/* SVG Radar */}
        <div className="flex-shrink-0">
          <svg
            width={SVG_W}
            height={SVG_H}
            viewBox={`0 0 ${SVG_W} ${SVG_H}`}
            className="overflow-visible"
          >
            <defs>
              <linearGradient id="pointa-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6effc0" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#6effc0" stopOpacity="0.04" />
              </linearGradient>
            </defs>

            {/* Grid rings */}
            {[0.25, 0.5, 0.75, 1].map(f => (
              <polygon key={f} points={gridPoints(f)}
                fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
            ))}

            {/* Axis lines */}
            {Array.from({ length: N }, (_, i) => {
              const end = pt(R_MAX, i)
              return (
                <line key={i} x1={CX} y1={CY} x2={end.x} y2={end.y}
                  stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
              )
            })}

            {/* Current polygon */}
            <polygon
              points={polyPoints(scores)}
              fill="url(#pointa-grad)"
              stroke="#6effc0"
              strokeWidth="1.5"
            />

            {/* Axis labels */}
            {Array.from({ length: N }, (_, i) => {
              const lp = pt(R_LABEL, i)
              const anchor = textAnchor(i)
              return (
                <text key={i} x={lp.x} y={lp.y}
                  textAnchor={anchor}
                  dominantBaseline="middle"
                  fontSize="7.5"
                  fill={hovered === i ? 'rgba(255,255,255,0.80)' : 'rgba(255,255,255,0.30)'}
                  fontFamily="monospace"
                  style={{ transition: 'fill 0.15s' }}
                >
                  {LABELS[i]}
                </text>
              )
            })}

            {/* Score dots */}
            {scores.map((score, i) => {
              const dotPt = pt((score / 10) * R_MAX, i)
              const color = scoreColor(score)
              const isHov = hovered === i
              return (
                <circle key={i}
                  cx={dotPt.x} cy={dotPt.y}
                  r={isHov ? 5.5 : 3.5}
                  fill={color}
                  stroke="#0e0f14"
                  strokeWidth="1.5"
                  className="cursor-pointer"
                  style={{ transition: 'r 0.12s' }}
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}
                />
              )
            })}

            {/* Tooltip */}
            {hovered !== null && (() => {
              const hp = pt((scores[hovered] / 10) * R_MAX, hovered)
              const tx = ttX(hp.x)
              const ty = ttY(hp.y)
              const color = scoreColor(scores[hovered])
              return (
                <g pointerEvents="none">
                  <rect x={tx} y={ty} width={TT_W} height={TT_H}
                    rx="5" fill="#1c1f2a" stroke="rgba(255,255,255,0.12)" strokeWidth="0.5" />
                  <text x={tx + TT_W / 2} y={ty + 9}
                    textAnchor="middle" fontSize="7" fill="rgba(255,255,255,0.45)" fontFamily="monospace">
                    {LABELS[hovered]}
                  </text>
                  <text x={tx + TT_W / 2} y={ty + 19}
                    textAnchor="middle" fontSize="9" fill={color}
                    fontFamily="monospace" fontWeight="bold">
                    {(scores[hovered]).toFixed(1)} / 10
                  </text>
                </g>
              )
            })()}

            {/* Center label */}
            <text x={CX} y={CY - 5} textAnchor="middle" fontSize="13"
              fill="rgba(255,255,255,0.9)" fontFamily="monospace" fontWeight="bold">
              {totalScore10.toFixed(1)}
            </text>
            <text x={CX} y={CY + 9} textAnchor="middle" fontSize="6"
              fill="rgba(255,255,255,0.25)" fontFamily="monospace">
              Точка А
            </text>
          </svg>

          {/* Legend */}
          <div className="flex items-center justify-center gap-4 -mt-1">
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-[1.5px] bg-[#6effc0]" />
              <span className="text-[9px] font-mono text-on-surface-variant/35">Текущий уровень</span>
            </div>
          </div>
        </div>

        {/* Compact bars */}
        <div className="flex-1 flex flex-col gap-1.5 pt-1">
          {KEYS.map((key, i) => {
            const score = scores[i]
            const pct = Math.round((score / 10) * 100)
            const color = scoreColor(score)
            const isHov = hovered === i
            return (
              <div key={key}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                className="cursor-default"
              >
                <div className="flex items-center justify-between mb-0.5">
                  <span
                    className="text-[11px] transition-colors"
                    style={{ color: isHov ? '#e2e8f0' : 'rgba(203,213,225,0.55)' }}
                  >
                    {LABELS[i]}
                  </span>
                  <span className="text-[11px] font-mono font-bold" style={{ color }}>
                    {score.toFixed(1)}
                  </span>
                </div>
                <div className="h-1 bg-surface-container rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${pct}%`, background: color, opacity: isHov ? 1 : 0.75 }}
                  />
                </div>
              </div>
            )
          })}

          {/* Health Index */}
          <div className="mt-2 pt-2 border-t border-white/[0.04]">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono text-on-surface-variant/50 uppercase tracking-widest">Health</span>
              <span className="text-[11px] font-mono font-bold" style={{ color: scoreColor(pointA.health_index / 10) }}>
                {(pointA.health_index / 10).toFixed(1)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
