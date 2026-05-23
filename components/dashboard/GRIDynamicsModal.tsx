'use client'

import { useEffect, useMemo, useState } from 'react'
import { OnboardingStatusBadges } from './OnboardingStatusBadges'

interface AssessmentRow {
  id: string
  gri_index: number
  section_avgs: Record<string, number>
  created_at: string
}

interface Props {
  open: boolean
  onClose: () => void
}

type PeriodKey = '7d' | '30d' | '90d' | '1y' | 'all'

const PERIODS: { key: PeriodKey; label: string; days: number | null }[] = [
  { key: '7d',  label: '7 дней',  days: 7   },
  { key: '30d', label: '30 дней', days: 30  },
  { key: '90d', label: '90 дней', days: 90  },
  { key: '1y',  label: '1 год',   days: 365 },
  { key: 'all', label: 'Всё',     days: null },
]

const SECTION_LABELS: Record<string, string> = {
  'product-demand':     'Продукт и Спрос',
  'trust-positioning':  'Доверие и Позиционирование',
  'business-model':     'Бизнес-модель',
  'cash-stability':     'Финансовая Устойчивость',
  'operations':         'Операции',
  'team':               'Команда',
  'owner-readiness':    'Готовность Основателя',
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

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: '2-digit' })
}

export function GRIDynamicsModal({ open, onClose }: Props) {
  const [rows, setRows] = useState<AssessmentRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [period, setPeriod] = useState<PeriodKey>('30d')

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch('/api/v1/gri/assessment?history=1', { credentials: 'include' })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return
        if (j.ok) {
          const history = (j.data?.history ?? []) as AssessmentRow[]
          setRows([...history].reverse())
        } else {
          setError(j.error || 'Ошибка загрузки')
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Ошибка сети')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const filtered = useMemo(() => {
    const p = PERIODS.find((x) => x.key === period)!
    if (p.days === null) return rows
    const cutoff = Date.now() - p.days * 24 * 60 * 60 * 1000
    return rows.filter((r) => new Date(r.created_at).getTime() >= cutoff)
  }, [rows, period])

  const latest = filtered[filtered.length - 1] ?? rows[rows.length - 1] ?? null
  const earliest = filtered[0] ?? null
  const delta = latest && earliest ? latest.gri_index - earliest.gri_index : 0

  if (!open) return null

  const series = filtered.map((r) => r.gri_index)
  const maxVal = 10
  const minVal = 0
  const W = 640
  const H = 180
  const PAD_X = 24
  const PAD_Y = 16
  const innerW = W - PAD_X * 2
  const innerH = H - PAD_Y * 2

  const points = series.map((v, i) => {
    const x = series.length <= 1 ? W / 2 : PAD_X + (i / (series.length - 1)) * innerW
    const y = PAD_Y + innerH - ((v - minVal) / (maxVal - minVal)) * innerH
    return { x, y, v }
  })

  const path = points.map((p, i) => (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`)).join(' ')
  const areaPath =
    points.length > 0
      ? `${path} L${points[points.length - 1].x},${PAD_Y + innerH} L${points[0].x},${PAD_Y + innerH} Z`
      : ''

  const sections = latest ? Object.entries(latest.section_avgs ?? {}) : []

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-surface-container rounded-2xl border border-white/[0.06] w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-surface-container/95 backdrop-blur border-b border-white/[0.04] p-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-mono text-primary/70 uppercase tracking-[0.2em] mb-1">
              GRI Assessment · Динамика
            </p>
            <h2 className="font-headline text-lg font-bold text-on-surface">
              Готовность к росту во времени
            </h2>
            <p className="text-xs text-on-surface-variant mt-1">
              Индекс собирается по 7 разделам анкеты — обновляется при каждом сохранении.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Закрыть"
            className="w-8 h-8 rounded-lg bg-surface-container-high hover:bg-white/[0.08] flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-colors flex-shrink-0"
          >
            <span className="material-symbols-outlined text-base">close</span>
          </button>
        </div>

        <div className="p-4 space-y-5">
          {/* Period filter */}
          <div className="flex flex-wrap items-center gap-1.5">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={`text-[11px] font-mono px-3 py-1.5 rounded-lg border transition-all ${
                  period === p.key
                    ? 'bg-primary/15 text-primary border-primary/40'
                    : 'bg-surface-container-high text-on-surface-variant border-white/[0.04] hover:border-white/15'
                }`}
              >
                {p.label}
              </button>
            ))}
            <span className="ml-auto text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">
              {filtered.length} {filtered.length === 1 ? 'запись' : 'записей'}
            </span>
          </div>

          {/* Summary */}
          {latest && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="bg-surface-container-low rounded-xl p-3 border border-white/[0.04]">
                <p className="text-[9px] font-mono text-on-surface-variant uppercase tracking-widest mb-1">Текущий GRI</p>
                <p className="text-xl font-mono font-bold" style={{ color: scoreColor(latest.gri_index) }}>
                  {latest.gri_index.toFixed(1)}
                </p>
                <p className="text-[10px] font-mono mt-1" style={{ color: scoreColor(latest.gri_index) }}>
                  {scoreLabel(latest.gri_index)}
                </p>
              </div>
              <div className="bg-surface-container-low rounded-xl p-3 border border-white/[0.04]">
                <p className="text-[9px] font-mono text-on-surface-variant uppercase tracking-widest mb-1">Изменение</p>
                <p
                  className="text-xl font-mono font-bold"
                  style={{ color: delta > 0 ? '#6effc0' : delta < 0 ? '#ff6b6b' : '#9bb0c5' }}
                >
                  {delta > 0 ? '+' : ''}
                  {delta.toFixed(1)}
                </p>
                <p className="text-[10px] font-mono text-on-surface-variant mt-1">за период</p>
              </div>
              <div className="bg-surface-container-low rounded-xl p-3 border border-white/[0.04]">
                <p className="text-[9px] font-mono text-on-surface-variant uppercase tracking-widest mb-1">Обновлено</p>
                <p className="text-sm font-mono font-bold text-on-surface">{formatDate(latest.created_at)}</p>
                <p className="text-[10px] font-mono text-on-surface-variant mt-1">последняя оценка</p>
              </div>
              <div className="bg-surface-container-low rounded-xl p-3 border border-white/[0.04]">
                <p className="text-[9px] font-mono text-on-surface-variant uppercase tracking-widest mb-1">Эталон</p>
                <p className="text-xl font-mono font-bold text-primary">8.0</p>
                <p className="text-[10px] font-mono text-on-surface-variant mt-1">целевой уровень</p>
              </div>
            </div>
          )}

          {/* Chart */}
          <div className="bg-surface-container-low rounded-xl border border-white/[0.04] p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-mono text-primary/70 uppercase tracking-widest">
                Динамика GRI-индекса
              </p>
              <p className="text-[10px] font-mono text-on-surface-variant">0–10</p>
            </div>
            {loading ? (
              <div className="h-[180px] flex items-center justify-center text-xs text-on-surface-variant">
                Загрузка…
              </div>
            ) : error ? (
              <div className="h-[180px] flex items-center justify-center text-xs text-error">
                {error}
              </div>
            ) : filtered.length === 0 ? (
              <div className="h-[180px] flex items-center justify-center text-xs text-on-surface-variant">
                Нет данных за выбранный период
              </div>
            ) : (
              <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
                <defs>
                  <linearGradient id="gri-dyn-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6effc0" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#6effc0" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {[2.5, 5, 7.5].map((v) => {
                  const y = PAD_Y + innerH - ((v - minVal) / (maxVal - minVal)) * innerH
                  return (
                    <g key={v}>
                      <line x1={PAD_X} y1={y} x2={W - PAD_X} y2={y} stroke="rgba(255,255,255,0.05)" strokeDasharray="2 2" />
                      <text x={4} y={y + 3} fontSize="9" fill="rgba(255,255,255,0.25)" fontFamily="monospace">{v}</text>
                    </g>
                  )
                })}
                {/* benchmark 8.0 */}
                {(() => {
                  const y = PAD_Y + innerH - ((8 - minVal) / (maxVal - minVal)) * innerH
                  return (
                    <g>
                      <line x1={PAD_X} y1={y} x2={W - PAD_X} y2={y} stroke="rgba(110,255,192,0.35)" strokeDasharray="3 3" />
                      <text x={W - PAD_X + 4} y={y + 3} fontSize="9" fill="rgba(110,255,192,0.6)" fontFamily="monospace">8.0</text>
                    </g>
                  )
                })()}
                {areaPath && <path d={areaPath} fill="url(#gri-dyn-grad)" />}
                {path && <path d={path} fill="none" stroke="#6effc0" strokeWidth="2" />}
                {points.map((p, i) => (
                  <g key={i}>
                    <circle cx={p.x} cy={p.y} r="4" fill={scoreColor(p.v)} stroke="#0e0f14" strokeWidth="1.5" />
                  </g>
                ))}
                {/* x-axis dates: first / mid / last */}
                {filtered.length > 0 && (
                  <>
                    <text x={PAD_X} y={H - 2} fontSize="9" fill="rgba(255,255,255,0.3)" fontFamily="monospace">
                      {formatDate(filtered[0].created_at)}
                    </text>
                    {filtered.length > 2 && (
                      <text x={W / 2} y={H - 2} fontSize="9" fill="rgba(255,255,255,0.3)" fontFamily="monospace" textAnchor="middle">
                        {formatDate(filtered[Math.floor(filtered.length / 2)].created_at)}
                      </text>
                    )}
                    <text x={W - PAD_X} y={H - 2} fontSize="9" fill="rgba(255,255,255,0.3)" fontFamily="monospace" textAnchor="end">
                      {formatDate(filtered[filtered.length - 1].created_at)}
                    </text>
                  </>
                )}
              </svg>
            )}
          </div>

          {/* Section breakdown */}
          {latest && sections.length > 0 && (
            <div className="bg-surface-container-low rounded-xl border border-white/[0.04] p-4">
              <p className="text-[10px] font-mono text-primary/70 uppercase tracking-widest mb-3">
                Разделы · последнее значение
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {sections.map(([id, score]) => {
                  const color = scoreColor(score)
                  const pct = Math.min(100, Math.round((score / 10) * 100))
                  return (
                    <div key={id} className="flex items-center gap-2">
                      <span className="text-xs text-on-surface flex-1 truncate">
                        {SECTION_LABELS[id] ?? id}
                      </span>
                      <div className="h-1 w-24 bg-surface-container rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${pct}%`, background: color }}
                        />
                      </div>
                      <span className="text-xs font-mono font-bold w-8 text-right tabular-nums" style={{ color }}>
                        {score.toFixed(1)}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Indicator badges */}
          <OnboardingStatusBadges />

          {/* Footer CTAs */}
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/[0.04]">
            <a
              href="/gri"
              className="inline-flex items-center gap-1.5 text-xs font-mono text-primary hover:text-primary/80 transition-colors px-3 py-2 rounded-lg bg-primary/10 hover:bg-primary/15 border border-primary/20"
            >
              <span className="material-symbols-outlined text-[14px]">open_in_full</span>
              Открыть полную страницу GRI
            </a>
            <a
              href="https://tidycal.com/istart/gtm"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-mono text-on-primary bg-primary hover:bg-primary/90 px-3 py-2 rounded-lg ml-auto transition-colors"
              title="Разобрать GRI с экспертом и составить план улучшения"
            >
              <span className="material-symbols-outlined text-[14px]">insights</span>
              Разобрать GRI с экспертом
              <span className="material-symbols-outlined text-[12px] opacity-70">open_in_new</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
