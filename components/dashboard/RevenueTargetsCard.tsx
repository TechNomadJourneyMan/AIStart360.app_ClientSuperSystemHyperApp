'use client'

import { useEffect, useState, useCallback } from 'react'

// ─── Helpers ──────────────────────────────────────────────────────────────

const FX_RATE_USD_KZT = 450

/**
 * Parse a Russian/English revenue string into KZT.
 * Accepts:
 *   "360 млн ₸"  → 360_000_000
 *   "1.5 млрд"    → 1_500_000_000
 *   "$2M ARR"     → 900_000_000 (via FX)
 *   "200000000"   → 200_000_000
 */
function parseAmount(raw: string): number | null {
  if (!raw.trim()) return null
  const cleaned = raw.replace(/\s/g, '').toLowerCase()
  const numMatch = cleaned.match(/([0-9]+([.,][0-9]+)?)/)
  if (!numMatch) return null
  const n = parseFloat(numMatch[1].replace(',', '.'))
  if (!Number.isFinite(n)) return null

  let multiplier = 1
  if (/млрд|b(?!yte)|bn|billion/i.test(cleaned)) multiplier = 1_000_000_000
  else if (/млн|m(?!s)|million/i.test(cleaned)) multiplier = 1_000_000
  else if (/тыс|k(?!g)/i.test(cleaned)) multiplier = 1_000

  let kzt = n * multiplier
  if (/\$|usd|долл/i.test(cleaned)) kzt *= FX_RATE_USD_KZT
  return Math.round(kzt)
}

function formatKzt(value: number | null): string {
  if (value === null) return ''
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1).replace('.0', '')} млрд ₸`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(0)} млн ₸`
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)} тыс ₸`
  return `${value.toLocaleString('ru-RU')} ₸`
}

// ─── Component ────────────────────────────────────────────────────────────

interface TargetsData {
  target_revenue_12m_kzt: number | null
  target_revenue_3y_kzt: number | null
}

export default function RevenueTargetsCard() {
  const [data, setData] = useState<TargetsData | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft12m, setDraft12m] = useState('')
  const [draft3y, setDraft3y] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/v1/companies/targets', { credentials: 'include' })
      const j = await r.json()
      if (j.ok) setData(j.data)
    } catch {
      // empty state — let user enter targets
    }
  }, [])

  useEffect(() => { load() }, [load])

  const startEdit = () => {
    setDraft12m(data?.target_revenue_12m_kzt ? formatKzt(data.target_revenue_12m_kzt) : '')
    setDraft3y(data?.target_revenue_3y_kzt ? formatKzt(data.target_revenue_3y_kzt) : '')
    setError(null)
    setEditing(true)
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const parsed12 = parseAmount(draft12m)
      const parsed3 = parseAmount(draft3y)
      const body = {
        target_revenue_12m_kzt: parsed12,
        target_revenue_3y_kzt: parsed3,
      }
      const r = await fetch('/api/v1/companies/targets', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await r.json()
      if (!j.ok) throw new Error(j.error || 'Ошибка сохранения')
      setData(j.data)
      setEditing(false)
      // Trigger a global re-fetch by reloading the page once.
      if (typeof window !== 'undefined') {
        // Use a soft reload — keeps scroll position, refreshes server data.
        window.location.reload()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section
      className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5"
      aria-label="Цели по выручке"
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-[10px] font-mono text-primary/70 uppercase tracking-widest mb-1">
            Цели · план роста
          </p>
          <h3 className="font-headline text-base font-bold text-on-surface">
            Целевая выручка
          </h3>
          <p className="text-xs text-on-surface-variant mt-1">
            Без целей таблица «План vs Факт» не сможет посчитать % выполнения.
          </p>
        </div>
        {!editing && (
          <button
            type="button"
            onClick={startEdit}
            className="inline-flex items-center gap-1.5 text-xs font-mono text-primary hover:text-primary/80 transition-colors px-3 py-1.5 rounded-lg border border-primary/30 hover:border-primary/60"
          >
            <span className="material-symbols-outlined text-base">
              {data?.target_revenue_12m_kzt || data?.target_revenue_3y_kzt ? 'edit' : 'add'}
            </span>
            {data?.target_revenue_12m_kzt || data?.target_revenue_3y_kzt ? 'Изменить' : 'Задать цели'}
          </button>
        )}
      </div>

      {!editing ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-surface-container rounded-xl p-4 border border-white/[0.03]">
            <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-2">
              План на 12 месяцев
            </p>
            <p className="text-xl font-mono font-bold text-primary">
              {data?.target_revenue_12m_kzt ? formatKzt(data.target_revenue_12m_kzt) : '—'}
            </p>
            <p className="text-[10px] text-on-surface-variant mt-1.5 font-mono">
              {data?.target_revenue_12m_kzt
                ? `${formatKzt(Math.round(data.target_revenue_12m_kzt / 12))} в месяц`
                : 'Не задано'}
            </p>
          </div>
          <div className="bg-surface-container rounded-xl p-4 border border-white/[0.03]">
            <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-2">
              План на 3 года
            </p>
            <p className="text-xl font-mono font-bold text-primary">
              {data?.target_revenue_3y_kzt ? formatKzt(data.target_revenue_3y_kzt) : '—'}
            </p>
            <p className="text-[10px] text-on-surface-variant mt-1.5 font-mono">
              {data?.target_revenue_3y_kzt
                ? `${formatKzt(Math.round(data.target_revenue_3y_kzt / 36))} в месяц (средн.)`
                : 'Не задано'}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-1.5">
                План на 12 месяцев
              </label>
              <input
                type="text"
                value={draft12m}
                onChange={(e) => setDraft12m(e.target.value)}
                placeholder="360 млн или $2M или 360000000"
                className="w-full bg-surface-container border border-white/[0.06] rounded-xl px-3 py-2 text-sm font-mono text-on-surface focus:outline-none focus:border-primary/40"
              />
              <p className="text-[10px] text-on-surface-variant mt-1 font-mono">
                {parseAmount(draft12m) !== null
                  ? `= ${formatKzt(parseAmount(draft12m))}`
                  : 'Введите сумму'}
              </p>
            </div>
            <div>
              <label className="block text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-1.5">
                План на 3 года
              </label>
              <input
                type="text"
                value={draft3y}
                onChange={(e) => setDraft3y(e.target.value)}
                placeholder="1.5 млрд или $5M или 1500000000"
                className="w-full bg-surface-container border border-white/[0.06] rounded-xl px-3 py-2 text-sm font-mono text-on-surface focus:outline-none focus:border-primary/40"
              />
              <p className="text-[10px] text-on-surface-variant mt-1 font-mono">
                {parseAmount(draft3y) !== null
                  ? `= ${formatKzt(parseAmount(draft3y))}`
                  : 'Введите сумму'}
              </p>
            </div>
          </div>

          {error && (
            <p className="text-xs text-error font-mono">{error}</p>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="px-4 py-2 rounded-xl bg-primary text-on-primary text-xs font-mono font-bold uppercase tracking-wide hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Сохраняем...' : 'Сохранить'}
            </button>
            <button
              type="button"
              onClick={() => { setEditing(false); setError(null) }}
              disabled={saving}
              className="px-4 py-2 rounded-xl text-xs font-mono text-on-surface-variant hover:text-on-surface transition-colors"
            >
              Отмена
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
