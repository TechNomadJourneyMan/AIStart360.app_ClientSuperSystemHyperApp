'use client'

// components/gri/page/GriDynamicsPanel.tsx — вкладка «Динамика»: тренд GRI по
// диагностикам + недельный пульс на одном графике, дельты «текущая vs прошлая
// диагностика» по 7 блокам и последние сессии калькулятора. Компонент сам
// тянет свои данные (три self-scoped GET-а) — в отличие от «Результата».
import { useEffect, useMemo, useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts'
import { GRI_SECTIONS } from '@/lib/gri-assessment/sections'

interface HistoryRow {
  gri_index: number
  section_avgs: Record<string, number>
  created_at: string
}
interface CalcSession {
  id: string
  name: string
  gri_index: number
  created_at: string
}
interface PulseRow {
  week_start: string
  pulse_index: number
}

// Русские подписи 7 блоков GRI (sections.ts хранит английские shortTitle).
const BLOCK_RU: Record<string, string> = {
  'product-demand': 'Продукт и спрос',
  'trust-positioning': 'Доверие и позиционирование',
  'business-model': 'Бизнес-модель',
  'cash-stability': 'Денежная стабильность',
  operations: 'Операции',
  team: 'Команда',
  'owner-readiness': 'Готовность собственника',
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })

export default function GriDynamicsPanel() {
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [sessions, setSessions] = useState<CalcSession[]>([])
  const [pulse, setPulse] = useState<PulseRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    Promise.allSettled([
      fetch('/api/v1/gri/assessment?history=1', { credentials: 'include' }).then((r) => r.json()),
      fetch('/api/v1/gri/calc-sessions', { credentials: 'include' }).then((r) => r.json()),
      fetch('/api/v1/gri/pulse', { credentials: 'include' }).then((r) => r.json()),
    ]).then(([h, s, p]) => {
      if (!alive) return
      if (h.status === 'fulfilled') {
        const rows = h.value?.data?.history
        setHistory(Array.isArray(rows) ? rows : [])
      }
      if (s.status === 'fulfilled') {
        const rows = s.value?.data?.sessions
        setSessions(Array.isArray(rows) ? rows : [])
      }
      if (p.status === 'fulfilled') {
        const rows = p.value?.data?.history
        setPulse(Array.isArray(rows) ? rows : [])
      }
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [])

  // Diagnostics + weekly pulse merged into one time-sorted series.
  const chartData = useMemo(() => {
    const points: { date: string; ts: number; diagnostic?: number; pulse?: number }[] = []
    for (const h of history) {
      points.push({
        date: fmtDate(h.created_at),
        ts: +new Date(h.created_at),
        diagnostic: Number(h.gri_index),
      })
    }
    for (const p of pulse) {
      points.push({
        date: fmtDate(p.week_start),
        ts: +new Date(p.week_start),
        pulse: Number(p.pulse_index),
      })
    }
    return points.sort((a, b) => a.ts - b.ts)
  }, [history, pulse])

  // Per-block delta: current vs previous diagnostic (needs >= 2 diagnostics).
  const deltas = useMemo(() => {
    if (history.length < 2) return null
    const sorted = [...history].sort(
      (a, b) => +new Date(b.created_at) - +new Date(a.created_at),
    )
    const [cur, prev] = sorted
    return GRI_SECTIONS.map((s) => ({
      id: s.id,
      title: BLOCK_RU[s.id] ?? s.shortTitle,
      delta: Number(cur.section_avgs?.[s.id] ?? 0) - Number(prev.section_avgs?.[s.id] ?? 0),
    }))
  }, [history])

  if (loading) {
    return <div className="animate-pulse h-[360px] bg-white/[0.03] rounded-2xl" />
  }

  if (chartData.length === 0) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-10 text-center">
        <p className="text-on-surface font-semibold">Пока нет замеров</p>
        <p className="text-sm text-on-surface-variant mt-1.5 max-w-md mx-auto">
          Пройдите диагностику или снимите «Пульс недели» — динамика появится здесь.
        </p>
      </div>
    )
  }

  return (
    <div className="grid lg:grid-cols-[2fr,1fr] gap-4">
      <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
        <p className="text-xs font-mono uppercase tracking-widest text-on-surface-variant mb-4">
          Тренд GRI
        </p>
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="date" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }} />
            <YAxis
              domain={[0, 10]}
              tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }}
              width={26}
            />
            <Tooltip
              contentStyle={{
                background: '#12151c',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 12,
              }}
              labelStyle={{ color: 'rgba(255,255,255,0.7)' }}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="diagnostic"
              name="Диагностика"
              stroke="#6effc0"
              strokeWidth={2}
              connectNulls
              dot={{ r: 3 }}
            />
            <Line
              type="monotone"
              dataKey="pulse"
              name="Пульс недели"
              stroke="#7aa2ff"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              connectNulls
              dot={{ r: 2 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </section>

      <div className="space-y-4">
        <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
          <p className="text-xs font-mono uppercase tracking-widest text-on-surface-variant mb-3">
            Дельта к прошлой диагностике
          </p>
          {deltas ? (
            <ul className="space-y-1.5">
              {deltas.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-on-surface-variant truncate">{d.title}</span>
                  <span
                    className={`shrink-0 tabular-nums font-medium ${
                      d.delta > 0
                        ? 'text-primary'
                        : d.delta < 0
                          ? 'text-red-400'
                          : 'text-on-surface-variant'
                    }`}
                  >
                    {d.delta > 0 ? '▲' : d.delta < 0 ? '▼' : '•'} {Math.abs(d.delta).toFixed(1)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-on-surface-variant">Нужны минимум две диагностики.</p>
          )}
        </section>

        <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
          <p className="text-xs font-mono uppercase tracking-widest text-on-surface-variant mb-3">
            Сессии калькулятора
          </p>
          {sessions.length === 0 ? (
            <p className="text-sm text-on-surface-variant">Сохранённых сессий нет.</p>
          ) : (
            <ul className="space-y-1.5">
              {sessions.slice(0, 8).map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-on-surface truncate">{s.name || 'Без названия'}</span>
                  <span className="shrink-0 text-on-surface-variant tabular-nums">
                    {Number(s.gri_index).toFixed(1)} · {fmtDate(s.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
