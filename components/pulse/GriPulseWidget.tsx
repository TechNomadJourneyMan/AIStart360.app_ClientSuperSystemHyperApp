'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { GRI_SECTIONS } from '@/lib/gri-assessment/sections'
import { MascotEmptyHint } from '@/components/assistant/mascot/MascotEmptyHint'

// ─── Types (mirror the /api/v1/gri/pulse envelope) ──────────────────────────
type PulseScores = Record<string, number>

interface PulseRow {
  id: string
  user_id: string
  company_id: string | null
  week_start: string
  scores: PulseScores
  pulse_index: number
  note: string | null
  created_at: string
}

interface PulseBaseline {
  gri_index: number | null
  section_avgs: Record<string, number> | null
  created_at: string
}

interface PulseGetData {
  week_start: string
  section_ids: string[]
  current_week: PulseRow | null
  history: PulseRow[]
  baseline: PulseBaseline | null
}

// Russian block labels (one per GRI section), keyed by section id.
const SECTION_LABELS: Record<string, string> = {
  'product-demand': 'Продукт и спрос',
  'trust-positioning': 'Доверие и позиционирование',
  'business-model': 'Бизнес-модель',
  'cash-stability': 'Денежная стабильность',
  operations: 'Операции',
  team: 'Команда',
  'owner-readiness': 'Готовность собственника',
}

const SECTIONS = GRI_SECTIONS.map((s) => ({
  id: s.id as string,
  label: SECTION_LABELS[s.id] ?? s.shortTitle,
}))

function defaultScores(): PulseScores {
  const out: PulseScores = {}
  for (const s of SECTIONS) out[s.id] = 5
  return out
}

function formatWeek(iso: string): string {
  // iso = YYYY-MM-DD (Monday). Render «дд.мм».
  const d = new Date(`${iso}T00:00:00Z`)
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', timeZone: 'UTC' })
}

// ─── Sub-components ──────────────────────────────────────────────────────────
function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-primary" />
    </div>
  )
}

function BlockSlider({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: number
  onChange: (id: string, v: number) => void
}) {
  return (
    <div className="bg-surface-container rounded-xl p-3.5">
      <div className="flex items-center justify-between mb-2.5">
        <p className="text-[11px] font-mono text-on-surface-variant uppercase tracking-widest leading-tight pr-2">
          {label}
        </p>
        <span className="text-base font-mono font-bold text-primary tabular-nums">{value}</span>
      </div>
      <input
        type="range"
        min={1}
        max={10}
        step={1}
        value={value}
        onChange={(e) => onChange(id, Number(e.target.value))}
        aria-label={label}
        className="w-full accent-primary cursor-pointer"
      />
    </div>
  )
}

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta === null) {
    return <span className="text-[10px] font-mono text-on-surface-variant/40">— нет базы</span>
  }
  const rounded = Math.round(delta * 10) / 10
  if (rounded === 0) {
    return <span className="text-[10px] font-mono text-on-surface-variant/60">= 0.0</span>
  }
  const up = rounded > 0
  return (
    <span className={`text-[10px] font-mono font-bold ${up ? 'text-primary' : 'text-error'}`}>
      {up ? '▲' : '▼'} {Math.abs(rounded).toFixed(1)}
    </span>
  )
}

// ─── Main widget ─────────────────────────────────────────────────────────────
export default function GriPulseWidget() {
  const [data, setData] = useState<PulseGetData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [scores, setScores] = useState<PulseScores>(defaultScores)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/gri/pulse', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        throw new Error(json?.error || 'Не удалось загрузить пульс')
      }
      const payload = json.data as PulseGetData
      setData(payload)
      if (payload.current_week) {
        setScores({ ...defaultScores(), ...payload.current_week.scores })
        setNote(payload.current_week.note ?? '')
      }
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const setScore = useCallback((id: string, v: number) => {
    setScores((prev) => ({ ...prev, [id]: v }))
    setJustSaved(false)
  }, [])

  const handleSubmit = useCallback(async () => {
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await fetch('/api/v1/gri/pulse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scores, note }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        throw new Error(json?.error || 'Не удалось сохранить пульс')
      }
      setJustSaved(true)
      await load()
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setSubmitting(false)
    }
  }, [scores, note, load])

  const alreadySubmitted = Boolean(data?.current_week)
  const hasBaseline = Boolean(data?.baseline?.section_avgs)

  const trendData = useMemo(() => {
    if (!data?.history) return []
    return data.history.map((row) => ({
      label: formatWeek(row.week_start),
      pulse: row.pulse_index,
    }))
  }, [data])

  if (loading) {
    return (
      <section className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6">
        <Spinner />
      </section>
    )
  }

  if (error) {
    return (
      <section className="bg-error/10 rounded-2xl border border-error/20 p-6 text-center">
        <span className="material-symbols-outlined text-2xl text-error block mb-2">error</span>
        <p className="text-error font-medium text-sm">{error}</p>
        <button
          onClick={() => {
            setLoading(true)
            load()
          }}
          className="mt-3 text-xs font-mono text-on-surface-variant hover:text-on-surface transition-colors"
        >
          Повторить
        </button>
      </section>
    )
  }

  return (
    <div className="space-y-5">
      {/* ── Section header ── */}
      <div className="flex flex-col lg:flex-row justify-between items-start gap-3">
        <div>
          <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-2">
            GRI Pulse · Пульс готовности к росту
          </p>
          <h2 className="font-headline text-xl md:text-2xl font-extrabold text-on-surface">
            Пульс недели
          </h2>
          <p className="text-on-surface-variant mt-1.5 text-sm max-w-2xl">
            Лёгкий еженедельный чек-ин: переоцените 7 блоков готовности (1–10), чтобы видеть динамику
            между полными GRI-диагностиками.
          </p>
        </div>
        {data?.current_week && (
          <div className="bg-surface-container-low rounded-xl border border-primary/20 px-4 py-3 text-right flex-shrink-0">
            <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">
              Пульс-индекс недели
            </p>
            <p className="text-2xl font-mono font-bold text-primary leading-none mt-1">
              {data.current_week.pulse_index.toFixed(2)}
            </p>
          </div>
        )}
      </div>

      {/* ── No baseline CTA ── */}
      {!hasBaseline && (
        <MascotEmptyHint
          title="Сначала — полная GRI-диагностика"
          text="Пульс отслеживает динамику относительно неё. Отметить пульс можно и сейчас, но дельты по блокам появятся после первой диагностики."
          cta={{ label: 'Пройти GRI-диагностику', href: '/gri?tab=assess' }}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* ── Weekly check-in card ── */}
        <section className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">
              {data?.week_start ? `Неделя с ${formatWeek(data.week_start)}` : 'Пульс недели'}
            </p>
            {alreadySubmitted && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-primary/30 bg-primary/10 text-[10px] font-mono text-primary">
                <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                Снят
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {SECTIONS.map((s) => (
              <BlockSlider
                key={s.id}
                id={s.id}
                label={s.label}
                value={scores[s.id] ?? 5}
                onChange={setScore}
              />
            ))}
          </div>

          <div className="mt-4">
            <label className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest block mb-1.5">
              Заметка (необязательно)
            </label>
            <textarea
              value={note}
              onChange={(e) => {
                setNote(e.target.value)
                setJustSaved(false)
              }}
              rows={2}
              placeholder="Что повлияло на готовность на этой неделе..."
              className="w-full bg-surface-container border border-white/[0.06] rounded-xl px-3 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/30 resize-none"
            />
          </div>

          {submitError && (
            <div className="flex items-center gap-2 bg-error/10 border border-error/20 rounded-xl px-3 py-2.5 mt-3">
              <span className="material-symbols-outlined text-sm text-error">error</span>
              <p className="text-xs text-error">{submitError}</p>
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full mt-4 px-4 py-2.5 rounded-xl bg-primary/15 border border-primary/30 text-sm text-primary font-medium hover:bg-primary/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                Сохранение...
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <span className="material-symbols-outlined text-sm">
                  {alreadySubmitted ? 'refresh' : 'check'}
                </span>
                {alreadySubmitted ? 'Обновить пульс недели' : 'Отправить пульс недели'}
              </span>
            )}
          </button>
          {justSaved && !submitting && (
            <p className="text-[11px] font-mono text-primary text-center mt-2">Пульс сохранён</p>
          )}
        </section>

        {/* ── Dynamics card ── */}
        <section className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5">
          <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-4">
            Динамика
          </p>

          {trendData.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-10">
              <span className="material-symbols-outlined text-3xl text-on-surface-variant/30 mb-2">
                show_chart
              </span>
              <p className="text-sm text-on-surface-variant max-w-xs">
                Пульс ещё не снимался. Отметьте первый пульс недели — график появится здесь.
              </p>
            </div>
          ) : (
            <>
              <div style={{ width: '100%', height: 140 }}>
                <ResponsiveContainer>
                  <LineChart data={trendData} margin={{ top: 8, right: 12, bottom: 4, left: -10 }}>
                    <XAxis
                      dataKey="label"
                      tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}
                      axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                      tickLine={false}
                    />
                    <YAxis
                      domain={[0, 10]}
                      tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}
                      axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                      tickLine={false}
                      width={28}
                    />
                    <Tooltip
                      contentStyle={{
                        background: 'rgba(10,11,15,0.95)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 12,
                        fontSize: 12,
                        fontFamily: 'JetBrains Mono, monospace',
                      }}
                      labelStyle={{ color: 'rgba(255,255,255,0.7)' }}
                      formatter={(value: number) => [value.toFixed(2), 'Пульс']}
                    />
                    <Line
                      type="monotone"
                      dataKey="pulse"
                      stroke="#6effc0"
                      strokeWidth={2}
                      dot={{ r: 3, fill: '#6effc0', strokeWidth: 0 }}
                      activeDot={{ r: 5, fill: '#6effc0', stroke: 'rgba(110,255,192,0.3)', strokeWidth: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Per-block deltas vs baseline */}
              <div className="mt-4 space-y-1.5">
                <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-2">
                  Дельта к диагностике
                </p>
                {SECTIONS.map((s) => {
                  const current = data?.current_week?.scores[s.id]
                  const base = data?.baseline?.section_avgs?.[s.id]
                  const delta =
                    typeof current === 'number' && typeof base === 'number' ? current - base : null
                  return (
                    <div
                      key={s.id}
                      className="flex items-center justify-between gap-2 bg-surface-container rounded-lg px-3 py-2"
                    >
                      <span className="text-[11px] text-on-surface-variant truncate">{s.label}</span>
                      <DeltaBadge delta={delta} />
                    </div>
                  )
                })}
                {!data?.current_week && (
                  <p className="text-[10px] font-mono text-on-surface-variant/50 mt-1">
                    Снимите пульс этой недели, чтобы увидеть дельты.
                  </p>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
