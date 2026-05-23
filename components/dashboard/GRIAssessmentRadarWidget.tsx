'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { GRIDynamicsModal } from './GRIDynamicsModal'

interface GriAssessmentData {
  gri_index: number
  section_avgs: Record<string, number>
  created_at?: string
}

interface Props {
  data: GriAssessmentData
  orgName?: string
  stage?: string
}

const N = 7
const SVG_W = 240
const SVG_H = 240
const CX = 120
const CY = 120
const R_MAX = 78
const R_LABEL = 98

const AXES: { id: string; short: string; full: string }[] = [
  { id: 'product-demand', short: 'Продукт', full: 'Продукт и Спрос' },
  { id: 'trust-positioning', short: 'Доверие', full: 'Доверие и Позиционирование' },
  { id: 'business-model', short: 'Бизнес', full: 'Бизнес-модель' },
  { id: 'cash-stability', short: 'Финансы', full: 'Финансовая Устойчивость' },
  { id: 'operations', short: 'Операции', full: 'Операции' },
  { id: 'team', short: 'Команда', full: 'Команда' },
  { id: 'owner-readiness', short: 'Основатель', full: 'Готовность Основателя' },
]

function angle(i: number) {
  return (Math.PI * 2 * i) / N - Math.PI / 2
}

function pt(r: number, i: number) {
  const a = angle(i)
  return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) }
}

function polyPoints(values: number[]) {
  return values
    .map((v, i) => {
      const p = pt((v / 10) * R_MAX, i)
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`
    })
    .join(' ')
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
  return (
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0] ?? '')
      .join('')
      .toUpperCase() || '?'
  )
}

const TT_W = 110
const TT_H = 28
function ttX(px: number) {
  return Math.max(2, Math.min(SVG_W - TT_W - 2, px - TT_W / 2))
}
function ttY(py: number) {
  return py < 40 ? py + 10 : py - TT_H - 8
}

export function GRIAssessmentRadarWidget({ data, orgName, stage }: Props) {
  const [hovered, setHovered] = useState<number | null>(null)
  const [dynamicsOpen, setDynamicsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const helpRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!helpOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setHelpOpen(false)
    }
    function onClick(e: MouseEvent) {
      if (helpRef.current && !helpRef.current.contains(e.target as Node)) {
        setHelpOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [helpOpen])

  const scores = AXES.map((a) => data.section_avgs[a.id] ?? 0)
  const overall = data.gri_index ?? 0
  const overallColor = scoreColor(overall)
  const overallLabel = scoreLabel(overall)
  const benchmark = 8

  const stageLabels: Record<string, string> = {
    seed: 'Seed',
    early: 'Early',
    growth: 'Growth',
    scale: 'Scale',
    mature: 'Mature',
  }

  return (
    <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-4 relative">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-[10px] font-mono text-primary/60 uppercase tracking-widest">
            GRI Assessment · Готовность к росту
          </p>
          <div className="flex items-baseline gap-1.5 mt-0.5">
            <span className="text-xl font-mono font-bold" style={{ color: overallColor }}>
              {overall.toFixed(1)}
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
          <button
            type="button"
            onClick={() => setHelpOpen((v) => !v)}
            aria-label="Что такое GRI"
            aria-expanded={helpOpen}
            className="w-6 h-6 rounded-full bg-surface-container-high hover:bg-primary/15 text-on-surface-variant hover:text-primary flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <span className="material-symbols-outlined text-[14px]">help</span>
          </button>
          <button
            type="button"
            onClick={() => setDynamicsOpen(true)}
            className="flex items-center gap-1.5 bg-primary/10 hover:bg-primary/15 border border-primary/20 hover:border-primary/40 text-primary text-[11px] font-mono px-2.5 py-1.5 rounded-lg transition-all group"
            title="Открыть динамику GRI и фильтры по периоду"
          >
            <span className="material-symbols-outlined text-[14px]">show_chart</span>
            <span className="hidden sm:inline">Динамика</span>
            <span className="material-symbols-outlined text-[12px] opacity-60 group-hover:opacity-100 transition-all">north_east</span>
          </button>
          {orgName && (
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 border border-primary/20"
              style={{ background: 'rgba(110,255,192,0.12)', color: '#6effc0' }}
              title={orgName}
            >
              {initials(orgName)}
            </div>
          )}
          {stage && (
            <span className="text-xs font-mono text-on-surface-variant/40">
              {stageLabels[stage] ?? stage}
            </span>
          )}
        </div>
      </div>

      <div className="flex gap-3 items-start">
        <div className="flex-shrink-0">
          <svg
            width={SVG_W}
            height={SVG_H}
            viewBox={`0 0 ${SVG_W} ${SVG_H}`}
            className="overflow-visible"
          >
            <defs>
              <linearGradient id="gri-radar-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6effc0" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#6effc0" stopOpacity="0.04" />
              </linearGradient>
            </defs>

            {[0.25, 0.5, 0.75, 1].map((f) => (
              <polygon
                key={f}
                points={gridPoints(f)}
                fill="none"
                stroke="rgba(255,255,255,0.06)"
                strokeWidth="1"
              />
            ))}

            {Array.from({ length: N }, (_, i) => {
              const end = pt(R_MAX, i)
              return (
                <line
                  key={i}
                  x1={CX}
                  y1={CY}
                  x2={end.x}
                  y2={end.y}
                  stroke="rgba(255,255,255,0.07)"
                  strokeWidth="1"
                />
              )
            })}

            <polygon
              points={polyPoints(Array(N).fill(benchmark))}
              fill="none"
              stroke="rgba(110,255,192,0.35)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />

            <polygon
              points={polyPoints(scores)}
              fill="url(#gri-radar-grad)"
              stroke="#6effc0"
              strokeWidth="1.5"
            />

            {AXES.map((axis, i) => {
              const lp = pt(R_LABEL, i)
              const anchor = textAnchor(i)
              return (
                <text
                  key={axis.id}
                  x={lp.x}
                  y={lp.y}
                  textAnchor={anchor}
                  dominantBaseline="middle"
                  fontSize="7.5"
                  fill={hovered === i ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.32)'}
                  fontFamily="monospace"
                  style={{ transition: 'fill 0.15s' }}
                >
                  {axis.short}
                </text>
              )
            })}

            {scores.map((score, i) => {
              const dotPt = pt((score / 10) * R_MAX, i)
              const color = scoreColor(score)
              const isHov = hovered === i
              return (
                <circle
                  key={i}
                  cx={dotPt.x}
                  cy={dotPt.y}
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

            {hovered !== null &&
              (() => {
                const hp = pt((scores[hovered] / 10) * R_MAX, hovered)
                const tx = ttX(hp.x)
                const ty = ttY(hp.y)
                const color = scoreColor(scores[hovered])
                return (
                  <g pointerEvents="none">
                    <rect
                      x={tx}
                      y={ty}
                      width={TT_W}
                      height={TT_H}
                      rx="5"
                      fill="#1c1f2a"
                      stroke="rgba(255,255,255,0.12)"
                      strokeWidth="0.5"
                    />
                    <text
                      x={tx + TT_W / 2}
                      y={ty + 10}
                      textAnchor="middle"
                      fontSize="7"
                      fill="rgba(255,255,255,0.45)"
                      fontFamily="monospace"
                    >
                      {AXES[hovered].full}
                    </text>
                    <text
                      x={tx + TT_W / 2}
                      y={ty + 21}
                      textAnchor="middle"
                      fontSize="9"
                      fill={color}
                      fontFamily="monospace"
                      fontWeight="bold"
                    >
                      {scores[hovered].toFixed(1)} / 10
                    </text>
                  </g>
                )
              })()}

            <text
              x={CX}
              y={CY - 5}
              textAnchor="middle"
              fontSize="13"
              fill="rgba(255,255,255,0.9)"
              fontFamily="monospace"
              fontWeight="bold"
            >
              {overall.toFixed(1)}
            </text>
            <text
              x={CX}
              y={CY + 9}
              textAnchor="middle"
              fontSize="6"
              fill="rgba(255,255,255,0.25)"
              fontFamily="monospace"
            >
              GRI
            </text>
          </svg>

          <div className="flex items-center justify-center gap-4 -mt-1">
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-[1.5px] bg-[#6effc0]" />
              <span className="text-[9px] font-mono text-on-surface-variant/35">Текущий</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-[1.5px] border-t border-dashed border-[#6effc0]/50" />
              <span className="text-[9px] font-mono text-on-surface-variant/35">Эталон 8.0</span>
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col gap-1.5 pt-1 min-w-0">
          {AXES.map((axis, i) => {
            const score = scores[i]
            const pct = Math.round((score / 10) * 100)
            const color = scoreColor(score)
            const isHov = hovered === i
            return (
              <div
                key={axis.id}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                className="cursor-default"
              >
                <div className="flex items-center justify-between mb-0.5 gap-2">
                  <span
                    className="text-[11px] transition-colors truncate"
                    style={{ color: isHov ? '#e2e8f0' : 'rgba(203,213,225,0.55)' }}
                  >
                    {axis.full}
                  </span>
                  <span className="text-[11px] font-mono font-bold flex-shrink-0" style={{ color }}>
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
        </div>
      </div>

      {/* Bottom CTA strip */}
      <div className="mt-4 pt-3 border-t border-white/[0.05] flex flex-wrap gap-2">
        <a
          href="https://tidycal.com/istart/gtm"
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 min-w-[140px] inline-flex items-center justify-center gap-1.5 bg-primary/10 hover:bg-primary/15 border border-primary/30 hover:border-primary/50 text-primary text-[11px] font-mono px-2.5 py-1.5 rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <span className="material-symbols-outlined text-[13px]">event_available</span>
          <span>Записаться на консультацию</span>
        </a>
        <Link
          href="/gri"
          className="flex-1 min-w-[120px] inline-flex items-center justify-center gap-1.5 bg-transparent hover:bg-white/[0.04] border border-white/10 hover:border-white/20 text-on-surface-variant hover:text-on-surface text-[11px] font-mono px-2.5 py-1.5 rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <span className="material-symbols-outlined text-[13px]">restart_alt</span>
          <span>Пройти GRI ещё раз</span>
        </Link>
      </div>

      {/* Help popover */}
      {helpOpen && (
        <div
          ref={helpRef}
          role="dialog"
          aria-label="Что такое GRI"
          className="absolute top-12 right-3 z-30 w-[340px] max-w-[calc(100vw-32px)] bg-surface-container-high border border-white/10 rounded-2xl shadow-modal p-4 animate-in fade-in slide-in-from-top-1 duration-150"
        >
          <button
            type="button"
            onClick={() => setHelpOpen(false)}
            aria-label="Закрыть"
            className="absolute top-2 right-2 w-6 h-6 rounded-full hover:bg-white/[0.06] text-on-surface-variant hover:text-on-surface flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
          <h4 className="font-headline text-base font-bold text-on-surface mb-2 pr-6">
            Что такое GRI?
          </h4>
          <div className="space-y-2.5 text-[12px] leading-relaxed text-on-surface-variant">
            <p>
              <span className="font-bold text-on-surface">GRI (Growth Readiness Index)</span> — индекс готовности
              бизнеса к масштабированию. Оценивает 7 блоков: продукт и спрос, доверие и позиционирование,
              бизнес-модель, финансовая устойчивость, операции, команда, готовность основателя.
            </p>
            <p>
              <span className="font-bold text-on-surface">Зачем это бизнесу:</span> GRI находит узкие места, которые
              ломаются при ускорении до $2M/год. Получаете TOP-5 ограничений с ценой недоработки и Action Plan на
              90 дней.
            </p>
          </div>
          <div className="mt-4 flex flex-col gap-2">
            <a
              href="https://tidycal.com/istart/gtm"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setHelpOpen(false)}
              className="inline-flex items-center justify-center gap-1.5 bg-primary hover:bg-primary/90 text-on-primary text-[12px] font-mono font-bold px-3 py-2 rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
              style={{ background: '#6effc0', color: '#0A0B0F' }}
            >
              <span className="material-symbols-outlined text-[14px]">event_available</span>
              Записаться на консультацию
            </a>
            <Link
              href="/gri"
              onClick={() => setHelpOpen(false)}
              className="inline-flex items-center justify-center gap-1.5 bg-transparent border border-primary/30 hover:border-primary/60 hover:bg-primary/10 text-primary text-[12px] font-mono px-3 py-2 rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <span className="material-symbols-outlined text-[14px]">play_arrow</span>
              Пройти тест GRI
            </Link>
          </div>
        </div>
      )}

      <GRIDynamicsModal open={dynamicsOpen} onClose={() => setDynamicsOpen(false)} />
    </div>
  )
}
