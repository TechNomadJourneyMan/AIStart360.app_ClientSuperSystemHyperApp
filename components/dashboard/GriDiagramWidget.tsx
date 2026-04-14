'use client'

import { useState } from 'react'
import Link from 'next/link'

export interface GriDomainItem {
  label: string
  score: number // 0–10
}

interface Props {
  domains: GriDomainItem[]
  totalScore?: number
  orgName?: string
}

// ── Radar geometry ────────────────────────────────────────────
const N        = 7
const SVG_W    = 240
const SVG_H    = 220
const CX       = 120
const CY       = 108
const R_MAX    = 70
const R_LABEL  = 88
const BENCHMARK = 8.5

const SHORT = ['Product', 'Trust', 'Business', 'Finance', 'Operations', 'Team', 'Founder']

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

// ── Colour helpers ────────────────────────────────────────────
function scoreColor(s: number) {
  if (s < 3) return '#ff6b6b'
  if (s < 6) return '#ffbd60'
  return '#6effc0'
}

function scoreLabel(s: number) {
  if (s < 3) return 'Critical'
  if (s < 5) return 'Low'
  if (s < 7) return 'Medium'
  if (s < 9) return 'High'
  return 'Excellent'
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase() || '?'
}

// ── Tooltip clamp ─────────────────────────────────────────────
const TT_W = 82
const TT_H = 26

function ttX(px: number) { return Math.max(2, Math.min(SVG_W - TT_W - 2, px - TT_W / 2)) }
function ttY(py: number) { return py < 40 ? py + 10 : py - TT_H - 8 }

// ─────────────────────────────────────────────────────────────
export function GriDiagramWidget({ domains, totalScore, orgName }: Props) {
  const [hovered, setHovered] = useState<number | null>(null)

  const scores = Array.from({ length: N }, (_, i) => domains[i]?.score ?? 0)
  const benchScores = Array.from({ length: N }, () => BENCHMARK)

  const overallColor = totalScore !== undefined ? scoreColor(totalScore) : '#6effc0'
  const overallLabel = totalScore !== undefined ? scoreLabel(totalScore) : ''

  return (
    <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-[10px] font-mono text-primary/60 uppercase tracking-widest">GRI Index</p>
          {totalScore !== undefined && (
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-xl font-mono font-bold" style={{ color: overallColor }}>
                {totalScore.toFixed(2)}
              </span>
              <span className="text-xs text-on-surface-variant">/ 10</span>
              <span
                className="text-[10px] font-mono px-1.5 py-0.5 rounded-full border"
                style={{ color: overallColor, borderColor: overallColor + '33', background: overallColor + '11' }}
              >
                {overallLabel}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Company avatar — "photo" */}
          {orgName && (
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 border border-primary/20"
              style={{ background: 'rgba(110,255,192,0.12)', color: '#6effc0' }}
              title={orgName}
            >
              {initials(orgName)}
            </div>
          )}
          <Link
            href="/gri"
            className="flex items-center gap-0.5 text-xs text-on-surface-variant/40 hover:text-primary transition-colors"
          >
            Details
            <span className="material-symbols-outlined text-sm">arrow_forward</span>
          </Link>
        </div>
      </div>

      {/* Body: radar + bars */}
      <div className="flex gap-3 items-start">

        {/* ── SVG Radar ─────────────────────────────────────── */}
        <div className="flex-shrink-0">
          <svg
            width={SVG_W}
            height={SVG_H}
            viewBox={`0 0 ${SVG_W} ${SVG_H}`}
            className="overflow-visible"
          >
            <defs>
              <linearGradient id="gri-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#60a5fa" stopOpacity="0.04" />
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

            {/* Benchmark polygon — dashed green */}
            <polygon
              points={polyPoints(benchScores)}
              fill="none"
              stroke="#6effc0"
              strokeWidth="1"
              strokeDasharray="3 3"
              opacity="0.35"
            />

            {/* Current polygon */}
            <polygon
              points={polyPoints(scores)}
              fill="url(#gri-grad)"
              stroke="#60a5fa"
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
                  {SHORT[i]}
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
                    {SHORT[hovered]}
                  </text>
                  <text x={tx + TT_W / 2} y={ty + 19}
                    textAnchor="middle" fontSize="9" fill={color}
                    fontFamily="monospace" fontWeight="bold">
                    {scores[hovered].toFixed(1)} · Benchmark {BENCHMARK}
                  </text>
                </g>
              )
            })()}

            {/* Center label */}
            <text x={CX} y={CY - 5} textAnchor="middle" fontSize="12"
              fill="rgba(255,255,255,0.9)" fontFamily="monospace" fontWeight="bold">
              {totalScore?.toFixed(1) ?? '—'}
            </text>
            <text x={CX} y={CY + 8} textAnchor="middle" fontSize="6"
              fill="rgba(255,255,255,0.25)" fontFamily="monospace">
              GRI
            </text>
          </svg>

          {/* Legend */}
          <div className="flex items-center justify-center gap-4 -mt-1">
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-[1.5px] bg-[#60a5fa]" />
              <span className="text-[9px] font-mono text-on-surface-variant/35">Business</span>
            </div>
            <div className="flex items-center gap-1.5">
              <svg width="20" height="4"><line x1="0" y1="2" x2="20" y2="2" stroke="#6effc0" strokeWidth="1" strokeDasharray="3 2" opacity="0.5" /></svg>
              <span className="text-[9px] font-mono text-on-surface-variant/35">Benchmark $2M</span>
            </div>
          </div>
        </div>

        {/* ── Compact bars ──────────────────────────────────── */}
        <div className="flex-1 flex flex-col gap-1.5 pt-1">
          {domains.map((domain, i) => {
            const pct   = Math.round((domain.score / 10) * 100)
            const color = scoreColor(domain.score)
            const isHov = hovered === i
            return (
              <div key={domain.label}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                className="cursor-default"
              >
                <div className="flex items-center justify-between mb-0.5">
                  <span
                    className="text-[11px] transition-colors"
                    style={{ color: isHov ? '#e2e8f0' : 'rgba(203,213,225,0.55)' }}
                  >
                    {SHORT[i]}
                  </span>
                  <span className="text-[11px] font-mono font-bold" style={{ color }}>
                    {domain.score.toFixed(1)}
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
        </div>
      </div>
    </div>
  )
}
