'use client'

import { useEffect, useState, useCallback } from 'react'
import { parseAmount, formatKzt } from '@/lib/format/kzt'

interface TargetsData {
  target_revenue_12m_kzt: number | null
  target_revenue_3y_kzt: number | null
}

interface PeriodGoals {
  goal_week: string | null
  goal_month: string | null
}

export default function RevenueTargetsCard() {
  const [data, setData] = useState<TargetsData | null>(null)
  const [periodGoals, setPeriodGoals] = useState<PeriodGoals>({ goal_week: null, goal_month: null })
  const [editing, setEditing] = useState(false)
  const [editingGoals, setEditingGoals] = useState(false)
  const [draft12m, setDraft12m] = useState('')
  const [draft3y, setDraft3y] = useState('')
  const [draftWeek, setDraftWeek] = useState('')
  const [draftMonth, setDraftMonth] = useState('')
  const [saving, setSaving] = useState(false)
  const [savingGoals, setSavingGoals] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [targetsRes, goalsRes] = await Promise.all([
        fetch('/api/v1/companies/targets', { credentials: 'include' }),
        fetch('/api/v1/companies/period-goals', { credentials: 'include' }),
      ])
      const targetsJ = await targetsRes.json()
      const goalsJ = await goalsRes.json()
      if (targetsJ.ok) setData(targetsJ.data)
      if (goalsJ.ok) setPeriodGoals(goalsJ.data)
    } catch {
      // empty state
    }
  }, [])

  useEffect(() => { load() }, [load])

  const startEditGoals = () => {
    setDraftWeek(periodGoals.goal_week ?? '')
    setDraftMonth(periodGoals.goal_month ?? '')
    setEditingGoals(true)
  }

  const saveGoals = async () => {
    setSavingGoals(true)
    try {
      const r = await fetch('/api/v1/companies/period-goals', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goal_week: draftWeek.trim() || null,
          goal_month: draftMonth.trim() || null,
        }),
      })
      const j = await r.json()
      if (!j.ok) throw new Error(j.error || 'Ошибка сохранения')
      setPeriodGoals({
        goal_week: draftWeek.trim() || null,
        goal_month: draftMonth.trim() || null,
      })
      setEditingGoals(false)
    } catch (e) {
      console.error(e)
    } finally {
      setSavingGoals(false)
    }
  }

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
      if (typeof window !== 'undefined') window.location.reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setSaving(false)
    }
  }

  const hasTargets = Boolean(data?.target_revenue_12m_kzt || data?.target_revenue_3y_kzt)
  const hasGoals = Boolean(periodGoals.goal_week || periodGoals.goal_month)

  if (editing) {
    return (
      <section className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-3.5">
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
                {parseAmount(draft12m) !== null ? `= ${formatKzt(parseAmount(draft12m))}` : 'Введите сумму'}
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
                {parseAmount(draft3y) !== null ? `= ${formatKzt(parseAmount(draft3y))}` : 'Введите сумму'}
              </p>
            </div>
          </div>
          {error && <p className="text-xs text-error font-mono">{error}</p>}
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
      </section>
    )
  }

  return (
    <section
      aria-label="Цели по выручке"
      className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-3.5 space-y-2.5"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
            <span className="material-symbols-outlined text-[14px] text-primary">flag</span>
          </div>
          <div>
            <p className="text-[9px] font-mono text-primary/60 uppercase tracking-[0.18em]">Цели · план роста</p>
            <h3 className="font-headline text-[13px] font-bold text-on-surface leading-tight">Целевая выручка</h3>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[200px]">
          <div className="bg-surface-container rounded-xl px-3 py-2 border border-white/[0.03] min-w-[140px]">
            <span className="text-[9px] font-mono text-on-surface-variant uppercase tracking-widest block">12 мес</span>
            <span className="text-sm font-mono font-bold text-primary leading-tight block">
              {data?.target_revenue_12m_kzt ? formatKzt(data.target_revenue_12m_kzt) : '—'}
            </span>
            <span className="text-[9px] font-mono text-on-surface-variant/70 block">
              {data?.target_revenue_12m_kzt ? `${formatKzt(Math.round(data.target_revenue_12m_kzt / 12))} / мес` : 'Не задано'}
            </span>
          </div>
          <div className="bg-surface-container rounded-xl px-3 py-2 border border-white/[0.03] min-w-[140px]">
            <span className="text-[9px] font-mono text-on-surface-variant uppercase tracking-widest block">3 года</span>
            <span className="text-sm font-mono font-bold text-primary leading-tight block">
              {data?.target_revenue_3y_kzt ? formatKzt(data.target_revenue_3y_kzt) : '—'}
            </span>
            <span className="text-[9px] font-mono text-on-surface-variant/70 block">
              {data?.target_revenue_3y_kzt ? `${formatKzt(Math.round(data.target_revenue_3y_kzt / 36))} / мес (ср.)` : 'Не задано'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
          {hasTargets && (
            <a
              href="/point-b"
              className="inline-flex items-center gap-1 text-[11px] font-mono text-primary hover:text-primary/80 transition-colors px-2.5 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/15 border border-primary/20"
            >
              <span className="material-symbols-outlined text-[14px]">trending_up</span>
              План vs Факт
            </a>
          )}
          <button
            type="button"
            onClick={startEdit}
            className="inline-flex items-center gap-1 text-[11px] font-mono text-primary hover:text-primary/80 transition-colors px-2.5 py-1.5 rounded-lg border border-primary/30 hover:border-primary/60"
          >
            <span className="material-symbols-outlined text-[14px]">{hasTargets ? 'edit' : 'add'}</span>
            {hasTargets ? 'Изменить' : 'Задать'}
          </button>
          <a
            href="https://tidycal.com/istart/gtm"
            target="_blank"
            rel="noopener noreferrer"
            title="Спланировать рост и обсудить достижение целей с экспертом"
            className="inline-flex items-center gap-1 text-[11px] font-mono text-on-primary bg-primary hover:bg-primary/90 transition-colors px-2.5 py-1.5 rounded-lg"
          >
            <span className="material-symbols-outlined text-[14px]">trending_up</span>
            <span className="hidden sm:inline">Спланировать рост</span>
            <span className="sm:hidden">Рост</span>
            <span className="material-symbols-outlined text-[12px] opacity-70">open_in_new</span>
          </a>
        </div>
      </div>

      <div className="pt-2 border-t border-white/[0.04]">
        {editingGoals ? (
          <div className="space-y-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div>
                <label className="block text-[9px] font-mono text-on-surface-variant uppercase tracking-widest mb-1">
                  Цель · Неделя
                </label>
                <input
                  type="text"
                  value={draftWeek}
                  onChange={(e) => setDraftWeek(e.target.value)}
                  placeholder="например: закрыть 5 сделок"
                  className="w-full bg-surface-container border border-white/[0.06] rounded-lg px-2.5 py-1.5 text-xs text-on-surface focus:outline-none focus:border-primary/40"
                />
              </div>
              <div>
                <label className="block text-[9px] font-mono text-on-surface-variant uppercase tracking-widest mb-1">
                  Цель · Месяц
                </label>
                <input
                  type="text"
                  value={draftMonth}
                  onChange={(e) => setDraftMonth(e.target.value)}
                  placeholder="например: выручка 30 млн ₸"
                  className="w-full bg-surface-container border border-white/[0.06] rounded-lg px-2.5 py-1.5 text-xs text-on-surface focus:outline-none focus:border-primary/40"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={saveGoals}
                disabled={savingGoals}
                className="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-[11px] font-mono font-bold uppercase hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {savingGoals ? 'Сохраняем…' : 'Сохранить'}
              </button>
              <button
                type="button"
                onClick={() => setEditingGoals(false)}
                disabled={savingGoals}
                className="px-3 py-1.5 rounded-lg text-[11px] font-mono text-on-surface-variant hover:text-on-surface transition-colors"
              >
                Отмена
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex flex-wrap gap-3 flex-1 min-w-[200px]">
              <div className="flex items-start gap-2 min-w-[200px] flex-1">
                <span className="material-symbols-outlined text-[14px] text-primary/70 mt-0.5 flex-shrink-0">
                  calendar_view_week
                </span>
                <div className="min-w-0">
                  <p className="text-[9px] font-mono text-on-surface-variant uppercase tracking-widest mb-0.5">
                    Цель · Неделя
                  </p>
                  <p className="text-xs leading-snug">
                    {periodGoals.goal_week ? (
                      <span className="text-on-surface">{periodGoals.goal_week}</span>
                    ) : (
                      <span className="text-on-surface-variant/70">Не задана — нажмите «Изменить цели»</span>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2 min-w-[200px] flex-1">
                <span className="material-symbols-outlined text-[14px] text-primary/70 mt-0.5 flex-shrink-0">
                  calendar_month
                </span>
                <div className="min-w-0">
                  <p className="text-[9px] font-mono text-on-surface-variant uppercase tracking-widest mb-0.5">
                    Цель · Месяц
                  </p>
                  <p className="text-xs leading-snug">
                    {periodGoals.goal_month ? (
                      <span className="text-on-surface">{periodGoals.goal_month}</span>
                    ) : (
                      <span className="text-on-surface-variant/70">Не задана — нажмите «Изменить цели»</span>
                    )}
                  </p>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={startEditGoals}
              className="inline-flex items-center gap-1 text-[11px] font-mono text-primary hover:text-primary/80 transition-colors px-2.5 py-1.5 rounded-lg border border-primary/30 hover:border-primary/60 flex-shrink-0"
            >
              <span className="material-symbols-outlined text-[14px]">{hasGoals ? 'edit' : 'add'}</span>
              {hasGoals ? 'Изменить цели' : 'Задать цели'}
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
