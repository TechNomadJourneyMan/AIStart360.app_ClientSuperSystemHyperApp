'use client'

/**
 * GrowthSnapshotHero — the new top-of-page hero for /dashboard, /point-a,
 * /client/dashboard, /client/point-a.
 *
 * Two columns on lg+:
 *   Left  → "Точка А · Снимок · {month}" card with 3 stacked tiles
 *           (current position, 12-month goal, 3-year goal)
 *   Right → AI Карта роста (goal-capture CTA) + GRI диагностика CTA
 *
 * If period-goals + targets are both empty, the left card collapses to
 * a single placeholder tile prompting the user to fill in goals on the
 * right.
 *
 * Replaces:
 *   - «Записаться на консультацию» / «Сформировать карту роста» / «План vs Факт»
 *   - «Изменить» / «Изменить цели» / «Спланировать рост»
 *   - the standalone RevenueTargetsCard at the top of PointADashboardSections
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  parseAmount,
  formatKzt,
  formatKztCompact,
  currentMonthLabel,
} from '@/lib/format/kzt'
import { GRIAssessmentRadarWidget } from './GRIAssessmentRadarWidget'

// ─── Types ────────────────────────────────────────────────────────────────────
interface TargetsData {
  target_revenue_12m_kzt: number | null
  target_revenue_3y_kzt: number | null
}

interface PeriodGoals {
  goal_week: string | null
  goal_month: string | null
}

interface OnboardingStatus {
  survey: {
    percent: number
    completed_steps: number
    total_steps: number
    /** Current monthly revenue typed on survey step 1 (₸), null when unknown. */
    current_revenue_month?: number | null
  }
  documents: { count: number; has_files: boolean }
}

interface GriAssessmentData {
  gri_index: number
  section_avgs: Record<string, number>
  created_at?: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function pct(value: number, max: number): number {
  if (!max || !Number.isFinite(max)) return 0
  return Math.max(0, Math.min(100, Math.round((value / max) * 100)))
}

function progressColor(p: number): string {
  if (p >= 75) return 'bg-primary'
  if (p >= 40) return 'bg-[#e87a35]'
  return 'bg-[#dc524b]'
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function GrowthSnapshotHero() {
  const router = useRouter()

  const [targets, setTargets] = useState<TargetsData | null>(null)
  const [periodGoals, setPeriodGoals] = useState<PeriodGoals>({
    goal_week: null,
    goal_month: null,
  })
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null)
  const [hasGri, setHasGri] = useState<boolean>(false)
  const [griData, setGriData] = useState<GriAssessmentData | null>(null)
  const [griModalOpen, setGriModalOpen] = useState(false)
  // Real monthly revenue from documents/metrics (not a heuristic)
  const [liveMonthlyRevenue, setLiveMonthlyRevenue] = useState<number | null>(null)

  // Inline goal-capture inputs (Card A)
  const [draft1y, setDraft1y] = useState('')
  const [draft3y, setDraft3y] = useState('')
  const [savingMap, setSavingMap] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)

  // Per-tile edit popovers (left column)
  const [editing12, setEditing12] = useState(false)
  const [editing3y, setEditing3y] = useState(false)
  const [draft12mEdit, setDraft12mEdit] = useState('')
  const [draft3yEdit, setDraft3yEdit] = useState('')
  const [savingTile, setSavingTile] = useState(false)

  const monthLabel = useMemo(() => currentMonthLabel(), [])

  const load = useCallback(async () => {
    try {
      const [tRes, gRes, oRes, griRes, mRes] = await Promise.all([
        fetch('/api/v1/companies/targets', { credentials: 'include' }),
        fetch('/api/v1/companies/period-goals', { credentials: 'include' }),
        fetch('/api/v1/onboarding/status', { credentials: 'include' }),
        fetch('/api/v1/gri/assessment', { credentials: 'include' }),
        fetch('/api/v1/metrics?keys=revenue,revenue_monthly,monthly_revenue', {
          credentials: 'include',
        }),
      ])

      const tJ = await tRes.json().catch(() => ({}))
      const gJ = await gRes.json().catch(() => ({}))
      const oJ = await oRes.json().catch(() => ({}))
      const griJ = await griRes.json().catch(() => ({}))
      const mJ = await mRes.json().catch(() => ({}))

      // Live monthly revenue — first hit among the candidate metric keys.
      const items: Array<{ id?: string; value?: number | null; unit?: string }> =
        (mJ?.ok && Array.isArray(mJ.data?.items) ? mJ.data.items : []) ?? []
      const revenueItem = items.find((it) => {
        const v = typeof it.value === 'number' ? it.value : null
        return v !== null && v > 0
      })
      if (revenueItem && typeof revenueItem.value === 'number') {
        setLiveMonthlyRevenue(revenueItem.value)
      }

      if (tJ?.ok) setTargets(tJ.data)
      if (gJ?.ok) setPeriodGoals(gJ.data)
      if (oJ?.ok) setOnboarding(oJ.data)
      if (griJ?.ok && griJ.data?.current) {
        setHasGri(true)
        const cur = griJ.data.current as {
          gri_index?: number
          section_avgs?: Record<string, number>
          created_at?: string
        }
        setGriData({
          gri_index: Number(cur.gri_index ?? 0),
          section_avgs: cur.section_avgs ?? {},
          created_at: cur.created_at,
        })
      }
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Bridge: `PointAQuickPills` dispatches this CustomEvent when the user
  // clicks the «GRI» pill so the modal can be opened from anywhere on the
  // page without prop-drilling.
  useEffect(() => {
    const onOpen = () => setGriModalOpen(true)
    window.addEventListener('aistart360:open-gri', onOpen)
    return () => window.removeEventListener('aistart360:open-gri', onOpen)
  }, [])

  // ── Derived values ────────────────────────────────────────────────────────
  const target12m = targets?.target_revenue_12m_kzt ?? null
  const target3y = targets?.target_revenue_3y_kzt ?? null
  const monthlyPlan12 = target12m ? Math.round(target12m / 12) : null
  // target_revenue_3y_kzt is the ANNUAL revenue goal for year 3 — every writer
  // (survey step 1 sync, this component's own editor, Point B) stores
  // month × 12. Dividing by 36 showed a 15 М/мес goal as 5 М/мес.
  const monthlyPlan3y = target3y ? Math.round(target3y / 12) : null

  // Current revenue: live metric (documents) → the owner's own answer on
  // survey step 1 → unknown. The old fallback «58 % of plan · оценка» showed a
  // made-up number next to the real one the owner had typed.
  const isLiveRevenue = liveMonthlyRevenue !== null && liveMonthlyRevenue > 0
  const surveyMonthly = onboarding?.survey?.current_revenue_month ?? null
  const isSurveyRevenue = !isLiveRevenue && surveyMonthly !== null && surveyMonthly > 0
  const currentMonthly: number | null = isLiveRevenue
    ? Math.round(liveMonthlyRevenue!)
    : isSurveyRevenue
      ? Math.round(surveyMonthly!)
      : null
  const runRate12 = currentMonthly ? currentMonthly * 12 : null

  const progressToPlan = currentMonthly && monthlyPlan12
    ? pct(currentMonthly, monthlyPlan12)
    : 0
  const progressTo12 = currentMonthly && monthlyPlan12
    ? pct(currentMonthly, monthlyPlan12)
    : 0
  const progressTo3y = currentMonthly && monthlyPlan3y
    ? pct(currentMonthly, monthlyPlan3y)
    : 0

  const gap12 = currentMonthly && monthlyPlan12
    ? currentMonthly - monthlyPlan12
    : null
  const gap3y = currentMonthly && monthlyPlan3y
    ? currentMonthly - monthlyPlan3y
    : null

  const hasAnyTarget = Boolean(target12m || target3y)
  const hasAnyPeriodGoal = Boolean(periodGoals.goal_week || periodGoals.goal_month)
  const hasGoalsSet = hasAnyTarget || hasAnyPeriodGoal

  // ── Card A — submit Карта роста ───────────────────────────────────────────
  const submitMap = async () => {
    setSavingMap(true)
    setSaveErr(null)
    try {
      const parsed1y = parseAmount(draft1y)
      const parsed3y = parseAmount(draft3y)
      if (!parsed1y && !parsed3y) {
        setSaveErr('Введите хотя бы одну цель')
        setSavingMap(false)
        return
      }
      const tasks: Promise<unknown>[] = []
      if (parsed1y !== null) {
        // Store as period-goals.goal_month (1-year monthly hand-typed value)
        // AND as target_revenue_12m_kzt (so dashboards see the annual plan).
        tasks.push(
          fetch('/api/v1/companies/period-goals', {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              goal_month: `${formatKzt(parsed1y)} / мес`,
            }),
          }),
          fetch('/api/v1/companies/targets', {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              target_revenue_12m_kzt: parsed1y * 12,
            }),
          }),
        )
      }
      if (parsed3y !== null) {
        tasks.push(
          fetch('/api/v1/companies/targets', {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              target_revenue_3y_kzt: parsed3y * 12,
            }),
          }),
        )
      }
      await Promise.all(tasks)
      router.push('/point-b')
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setSavingMap(false)
    }
  }

  // ── Tile edit popovers (left column) ──────────────────────────────────────
  const openEdit12 = () => {
    setDraft12mEdit(target12m ? formatKzt(target12m) : '')
    setEditing12(true)
    setEditing3y(false)
  }
  const openEdit3y = () => {
    setDraft3yEdit(target3y ? formatKzt(target3y) : '')
    setEditing3y(true)
    setEditing12(false)
  }
  const saveTile = async (which: '12' | '3y') => {
    setSavingTile(true)
    try {
      const value = which === '12'
        ? parseAmount(draft12mEdit)
        : parseAmount(draft3yEdit)
      const body = which === '12'
        ? { target_revenue_12m_kzt: value }
        : { target_revenue_3y_kzt: value }
      const r = await fetch('/api/v1/companies/targets', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await r.json()
      if (j?.ok) {
        setTargets((prev) => prev
          ? {
              ...prev,
              ...(which === '12'
                ? { target_revenue_12m_kzt: value }
                : { target_revenue_3y_kzt: value }),
            }
          : { target_revenue_12m_kzt: which === '12' ? value : null, target_revenue_3y_kzt: which === '3y' ? value : null }
        )
        setEditing12(false)
        setEditing3y(false)
      }
    } finally {
      setSavingTile(false)
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <section aria-label="Снимок роста — Точка А и карта роста" className="space-y-3">
      <style jsx>{`
        @keyframes pulseSlow {
          0%, 100% { box-shadow: 0 0 30px -10px rgba(110, 255, 192, 0.35); }
          50%      { box-shadow: 0 0 60px -10px rgba(110, 255, 192, 0.55); }
        }
        .pulse-slow {
          animation: pulseSlow 3s ease-in-out infinite;
        }
        @keyframes badgePulse {
          0%, 100% { opacity: 0.7; }
          50%      { opacity: 1; }
        }
        .badge-pulse { animation: badgePulse 1.8s ease-in-out infinite; }
      `}</style>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* ── LEFT: Снимок ─────────────────────────────────────────────── */}
        <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-mono text-primary/70 uppercase tracking-[0.2em]">
              Точка А · Снимок · {monthLabel}
            </p>
            <span className="material-symbols-outlined text-base text-primary/40">
              insights
            </span>
          </div>

          {!hasGoalsSet ? (
            <div className="bg-surface-container rounded-xl border border-dashed border-white/10 p-6 text-center">
              <span className="material-symbols-outlined text-3xl text-primary/30 block mb-2">
                target
              </span>
              <p className="text-sm text-on-surface font-medium mb-1">
                Снимок Точки А ещё не построен
              </p>
              <p className="text-xs text-on-surface-variant max-w-sm mx-auto leading-relaxed">
                Укажите цели справа, чтобы увидеть снимок Точки А: текущую
                выручку, разрыв до 1-летней и 3-летней цели.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {/* Tile 1 — Текущая позиция (brand accent) */}
              <div className="relative bg-surface-container rounded-xl border border-white/[0.04] p-5 pl-6 overflow-hidden">
                <span
                  className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl"
                  style={{ background: 'linear-gradient(180deg, #e87a35, #dc524b)' }}
                />
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-[180px]">
                    <div className="flex items-center gap-2 mb-2">
                      <p className="text-[11px] font-mono text-on-surface-variant uppercase tracking-[0.18em]">
                        Текущая позиция
                      </p>
                      {isLiveRevenue && (
                        <span
                          className="text-[9px] font-mono font-bold uppercase tracking-widest rounded-full px-1.5 py-0.5 border"
                          style={{
                            color: '#e87a35',
                            borderColor: 'rgba(232,122,53,0.4)',
                            background: 'rgba(232,122,53,0.08)',
                          }}
                          title="Значение собрано из анкеты и загруженных файлов"
                        >
                          LIVE
                        </span>
                      )}
                    </div>
                    <p className="font-mono text-5xl font-black text-on-surface leading-[0.95] tracking-tight">
                      {currentMonthly ? formatKztCompact(currentMonthly) : '—'}
                    </p>
                    <p className="text-[11px] text-on-surface-variant font-mono mt-2">
                      выручка / мес · {monthLabel}
                      {isSurveyRevenue && (
                        <span className="text-on-surface-variant/70"> · из анкеты</span>
                      )}
                      {!currentMonthly && (
                        <span className="text-amber-400/80"> · укажите в анкете, шаг 1</span>
                      )}
                    </p>
                  </div>
                  <div className="flex-1 min-w-[180px]">
                    <div className="flex items-baseline justify-between mb-1">
                      <span className="text-[9px] font-mono text-on-surface-variant uppercase tracking-widest">
                        Run-rate
                      </span>
                      <Link
                        href="/point-b"
                        className="inline-flex items-center gap-1 text-[10px] font-mono text-primary/80 hover:text-primary"
                        title="План vs Факт"
                      >
                        <span className="material-symbols-outlined text-[12px]">trending_up</span>
                        План vs Факт
                      </Link>
                    </div>
                    <p className="text-xs font-mono text-on-surface">
                      ~{formatKztCompact(runRate12)}
                      {target12m && (
                        <span className="text-on-surface-variant"> vs план {formatKztCompact(target12m)}</span>
                      )}
                    </p>
                    <div className="mt-2 h-1.5 bg-surface-container-high rounded-full overflow-hidden">
                      <div
                        className={`h-full ${progressColor(progressToPlan)} rounded-full transition-all duration-700`}
                        style={{ width: `${progressToPlan}%` }}
                      />
                    </div>
                    <p className="text-[10px] font-mono text-on-surface-variant mt-1">
                      {progressToPlan}% годового плана
                    </p>
                  </div>
                </div>
              </div>

              {/* Tile 2 — Цель 12 месяцев (green) */}
              {(target12m || hasAnyPeriodGoal) && (
                <div className="relative bg-surface-container rounded-xl border border-white/[0.04] p-5 pl-6 overflow-hidden">
                  <span className="absolute left-0 top-0 bottom-0 w-1 bg-primary/80 rounded-l-xl" />
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-[160px]">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="material-symbols-outlined text-[12px] text-primary/80">arrow_downward</span>
                        <p className="text-[9px] font-mono text-on-surface-variant uppercase tracking-widest">
                          Цель 12 месяцев
                        </p>
                        <button
                          type="button"
                          onClick={openEdit12}
                          className="ml-1 text-on-surface-variant/60 hover:text-primary transition-colors"
                          aria-label="Изменить цель 12 месяцев"
                        >
                          <span className="material-symbols-outlined text-[12px]">edit</span>
                        </button>
                      </div>
                      <p className="font-mono text-4xl font-black text-primary leading-[0.95] tracking-tight">
                        {monthlyPlan12 ? formatKztCompact(monthlyPlan12) : '—'}
                      </p>
                      <p className="text-[11px] text-on-surface-variant font-mono mt-1.5">
                        /мес · {target12m ? formatKztCompact(target12m) : '—'} / год
                      </p>
                    </div>
                    <div className="flex-1 min-w-[180px]">
                      <span className="text-[9px] font-mono text-on-surface-variant uppercase tracking-widest block mb-1">
                        Разрыв
                      </span>
                      <p className="text-xs font-mono text-on-surface">
                        {gap12 !== null
                          ? (
                            <span className={gap12 < 0 ? 'text-error' : 'text-primary'}>
                              {gap12 < 0 ? '' : '+'}{formatKztCompact(gap12)}/мес
                            </span>
                          )
                          : <span className="text-on-surface-variant">—</span>}
                      </p>
                      <div className="mt-2 h-1.5 bg-surface-container-high rounded-full overflow-hidden">
                        <div
                          className={`h-full ${progressColor(progressTo12)} rounded-full transition-all duration-700`}
                          style={{ width: `${progressTo12}%` }}
                        />
                      </div>
                      <p className="text-[10px] font-mono text-on-surface-variant mt-1">
                        {progressTo12}% к цели 1Y
                      </p>
                    </div>
                  </div>

                  {editing12 && (
                    <div className="mt-3 pt-3 border-t border-white/[0.06] flex flex-wrap items-end gap-2">
                      <div className="flex-1 min-w-[180px]">
                        <label className="block text-[9px] font-mono text-on-surface-variant uppercase tracking-widest mb-1">
                          Новая цель (₸ / год)
                        </label>
                        <input
                          type="text"
                          autoFocus
                          value={draft12mEdit}
                          onChange={(e) => setDraft12mEdit(e.target.value)}
                          placeholder="например 90 млн или $200K"
                          className="w-full bg-surface-container-low border border-white/[0.06] rounded-lg px-3 py-1.5 text-xs font-mono text-on-surface focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/30"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => saveTile('12')}
                        disabled={savingTile}
                        className="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-[11px] font-mono font-bold uppercase hover:bg-primary/90 disabled:opacity-50"
                      >
                        {savingTile ? '…' : 'OK'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing12(false)}
                        className="px-2 py-1.5 rounded-lg text-[11px] font-mono text-on-surface-variant hover:text-on-surface"
                      >
                        Отмена
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Tile 3 — Цель 3 года (purple) */}
              {(target3y || hasAnyPeriodGoal) && (
                <div className="relative bg-surface-container rounded-xl border border-white/[0.04] p-5 pl-6 overflow-hidden">
                  <span className="absolute left-0 top-0 bottom-0 w-1 bg-primary/80 rounded-l-xl" />
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-[160px]">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="material-symbols-outlined text-[12px] text-primary/80">arrow_upward</span>
                        <p className="text-[9px] font-mono text-on-surface-variant uppercase tracking-widest">
                          Цель 3 года
                        </p>
                        <button
                          type="button"
                          onClick={openEdit3y}
                          className="ml-1 text-on-surface-variant/60 hover:text-primary transition-colors"
                          aria-label="Изменить цель 3 года"
                        >
                          <span className="material-symbols-outlined text-[12px]">edit</span>
                        </button>
                      </div>
                      <p className="font-mono text-4xl font-black text-primary leading-[0.95] tracking-tight">
                        {monthlyPlan3y ? formatKztCompact(monthlyPlan3y) : '—'}
                      </p>
                      <p className="text-[11px] text-on-surface-variant font-mono mt-1.5">
                        /мес · {target3y ? formatKztCompact(target3y) : '—'} / год
                      </p>
                    </div>
                    <div className="flex-1 min-w-[180px]">
                      <span className="text-[9px] font-mono text-on-surface-variant uppercase tracking-widest block mb-1">
                        Разрыв
                      </span>
                      <p className="text-xs font-mono text-on-surface">
                        {gap3y !== null
                          ? (
                            <span className={gap3y < 0 ? 'text-error' : 'text-primary'}>
                              {gap3y < 0 ? '' : '+'}{formatKztCompact(gap3y)}/мес
                            </span>
                          )
                          : <span className="text-on-surface-variant">—</span>}
                      </p>
                      <div className="mt-2 h-1.5 bg-surface-container-high rounded-full overflow-hidden">
                        <div
                          className={`h-full ${progressColor(progressTo3y)} rounded-full transition-all duration-700`}
                          style={{ width: `${progressTo3y}%` }}
                        />
                      </div>
                      <p className="text-[10px] font-mono text-on-surface-variant mt-1">
                        {progressTo3y}% к цели 3Y
                      </p>
                    </div>
                  </div>

                  {editing3y && (
                    <div className="mt-3 pt-3 border-t border-white/[0.06] flex flex-wrap items-end gap-2">
                      <div className="flex-1 min-w-[180px]">
                        <label className="block text-[9px] font-mono text-on-surface-variant uppercase tracking-widest mb-1">
                          Новая цель (₸ / 3 года суммарно)
                        </label>
                        <input
                          type="text"
                          autoFocus
                          value={draft3yEdit}
                          onChange={(e) => setDraft3yEdit(e.target.value)}
                          placeholder="например 900 млн или $2M"
                          className="w-full bg-surface-container-low border border-white/[0.06] rounded-lg px-3 py-1.5 text-xs font-mono text-on-surface focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/30"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => saveTile('3y')}
                        disabled={savingTile}
                        className="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-[11px] font-mono font-bold uppercase hover:bg-primary/90 disabled:opacity-50"
                      >
                        {savingTile ? '…' : 'OK'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing3y(false)}
                        className="px-2 py-1.5 rounded-lg text-[11px] font-mono text-on-surface-variant hover:text-on-surface"
                      >
                        Отмена
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── RIGHT: AI карта роста + GRI ─────────────────────────────────── */}
        <div className="flex flex-col gap-3">
          {/* Card A — AI карта роста */}
          <div
            className={`relative rounded-2xl border bg-surface-container-low p-4 transition-all ${
              hasGoalsSet
                ? 'border-primary/40 shadow-[0_0_40px_-15px_rgba(110,255,192,0.4)]'
                : 'border-primary/60 pulse-slow'
            }`}
          >
            {!hasGoalsSet && (
              <span className="badge-pulse absolute top-3 right-3 text-[9px] font-mono font-bold uppercase tracking-widest text-amber-300 bg-amber-400/15 border border-amber-300/40 rounded-full px-2 py-0.5">
                Выберите цель
              </span>
            )}

            <p className="text-[10px] font-mono text-primary/80 uppercase tracking-[0.2em] mb-1">
              AI · Карта роста
            </p>
            <h2 className="font-headline text-xl font-extrabold text-on-surface leading-tight mb-3 pr-24 tracking-tight">
              Укажите цели — получите карту роста на 1-3 года
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
              <div>
                <label className="block text-[9px] font-mono text-primary/70 uppercase tracking-widest mb-1">
                  Цель · 1 год (₸ / мес)
                </label>
                <input
                  type="text"
                  value={draft1y}
                  onChange={(e) => setDraft1y(e.target.value)}
                  placeholder="например 7,5 млн"
                  className="w-full bg-surface-container border border-white/[0.08] rounded-lg px-3 py-2 text-xs font-mono text-on-surface focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/30"
                />
                <p className="text-[9px] font-mono text-on-surface-variant mt-1">
                  {parseAmount(draft1y) !== null ? `= ${formatKzt(parseAmount(draft1y))} /мес` : ' '}
                </p>
              </div>
              <div>
                <label className="block text-[9px] font-mono text-primary/70 uppercase tracking-widest mb-1">
                  Цель · 3 года (₸ / мес)
                </label>
                <input
                  type="text"
                  value={draft3y}
                  onChange={(e) => setDraft3y(e.target.value)}
                  placeholder="например 25 млн"
                  className="w-full bg-surface-container border border-white/[0.08] rounded-lg px-3 py-2 text-xs font-mono text-on-surface focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/30"
                />
                <p className="text-[9px] font-mono text-on-surface-variant mt-1">
                  {parseAmount(draft3y) !== null ? `= ${formatKzt(parseAmount(draft3y))} /мес` : ' '}
                </p>
              </div>
            </div>

            {saveErr && (
              <p className="text-[10px] text-error font-mono mb-2">{saveErr}</p>
            )}

            <button
              type="button"
              onClick={submitMap}
              disabled={savingMap}
              className="w-full inline-flex items-center justify-center gap-2 text-white font-bold text-base rounded-xl py-3.5 hover:brightness-110 disabled:opacity-50 transition-all focus:ring-2"
              style={{
                background: 'linear-gradient(90deg, #e87a35, #dc524b)',
                boxShadow: '0 0 30px -10px rgba(232,122,53,0.55)',
              }}
            >
              <span className="material-symbols-outlined text-lg">auto_awesome</span>
              {savingMap ? 'Сохраняем…' : 'Получить карту роста'}
            </button>

            <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-white/[0.06] gap-2 flex-wrap">
              <p className="text-[10px] font-mono text-on-surface-variant leading-relaxed">
                Текущая позиция: {currentMonthly ? `${formatKztCompact(currentMonthly)}/мес` : '—'}
                {' · '}Прогноз год: {runRate12 ? `~${formatKztCompact(runRate12)}` : '—'}
                {' · '}Разрыв до 1Y: {gap12 !== null ? `${formatKztCompact(gap12)}/мес` : '—'}
              </p>
            </div>
          </div>

          {/* Card B — GRI диагностика (always visible; «Открыть GRI» enabled
              after the user has completed the test). One brand-orange CTA;
              secondary actions live as plain ghost links below. */}
          <div
            className="relative rounded-2xl border bg-surface-container-low p-4"
            style={{ borderColor: 'rgba(232,122,53,0.35)' }}
          >
            <p
              className="text-[10px] font-mono uppercase tracking-[0.2em] mb-1"
              style={{ color: '#e87a35' }}
            >
              Следующий шаг · GRI-диагностика
            </p>
            <h2 className="font-headline text-xl font-extrabold text-on-surface leading-tight mb-2 tracking-tight">
              Определи свою готовность к росту — пройди GRI
            </h2>
            <p className="text-xs text-on-surface-variant leading-relaxed mb-4">
              Growth Readiness Index покажет, где именно бизнес ломается при
              ускорении до $2M/год. 7 блоков × 62 критерия. TOP 5 ограничений
              с ценой недоработки. Автоматический Action Plan на 90 дней.
            </p>
            <Link
              href="/gri"
              className="w-full inline-flex items-center justify-center gap-2 text-white font-bold text-base rounded-xl py-3.5 transition-all focus:ring-2 hover:brightness-110"
              style={{
                background: 'linear-gradient(90deg, #e87a35, #dc524b)',
                boxShadow: '0 0 30px -10px rgba(232,122,53,0.55)',
              }}
            >
              <span className="material-symbols-outlined text-lg">change_history</span>
              {hasGri ? 'Пройти GRI заново' : 'Пройти GRI-диагностику'}
            </Link>

            <div className="flex items-center justify-center gap-4 mt-3 flex-wrap">
              <button
                type="button"
                onClick={() => setGriModalOpen(true)}
                disabled={!hasGri || !griData}
                title={
                  hasGri
                    ? 'Открыть результаты GRI'
                    : 'Пройдите GRI, чтобы открыть результаты'
                }
                className="text-[11px] font-mono text-on-surface-variant hover:text-on-surface inline-flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span className="material-symbols-outlined text-[14px]">insights</span>
                Открыть GRI
              </button>
              <span className="text-on-surface-variant/30">·</span>
              <a
                href="https://tidycal.com/istart/gtm"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-mono text-on-surface-variant hover:text-on-surface inline-flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[14px]">forum</span>
                Связаться с экспертом
              </a>
            </div>

            <p className="text-[10px] font-mono text-on-surface-variant mt-3 text-center">
              ~ 45 минут · 62 вопроса
              {hasGri && griData?.created_at &&
                ` · последняя оценка ${new Date(griData.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}`}
            </p>
          </div>
        </div>
      </div>

      {/* ── Footer ─ 2 small action cards ─────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Link
          href="/client/onboarding"
          className="group bg-surface-container-low rounded-2xl border border-white/[0.04] hover:border-primary/30 p-4 transition-all"
        >
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="material-symbols-outlined text-base text-primary">edit_note</span>
              <p className="text-sm font-medium text-on-surface group-hover:text-primary transition-colors truncate">
                Внести данные
              </p>
            </div>
            <span className="text-[11px] font-mono font-bold text-primary flex-shrink-0">
              {onboarding?.survey?.percent ?? 0}%
            </span>
          </div>
          <div className="h-1 bg-surface-container-high rounded-full overflow-hidden">
            <div
              className={`h-full ${progressColor(onboarding?.survey?.percent ?? 0)} rounded-full transition-all duration-700`}
              style={{ width: `${onboarding?.survey?.percent ?? 0}%` }}
            />
          </div>
          <p className="text-[10px] font-mono text-on-surface-variant mt-1.5">
            {onboarding?.survey?.completed_steps ?? 0} / {onboarding?.survey?.total_steps ?? 12} шагов анкеты
          </p>
        </Link>

        <Link
          href="/client/onboarding/documents"
          className="group bg-surface-container-low rounded-2xl border border-white/[0.04] hover:border-primary/30 p-4 transition-all flex items-center gap-3"
        >
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0 group-hover:bg-primary/20 transition-colors">
            <span className="material-symbols-outlined text-lg text-primary">cloud_upload</span>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-on-surface group-hover:text-primary transition-colors">
              Для загрузки файлов
            </p>
            <p className="text-[10px] text-on-surface-variant font-mono mt-0.5">
              Отчёты, P&L, база клиентов · xlsx, csv, pdf
              {onboarding?.documents?.count
                ? ` · загружено ${onboarding.documents.count}`
                : ''}
            </p>
          </div>
          <span className="material-symbols-outlined text-base text-on-surface-variant group-hover:text-primary group-hover:translate-x-0.5 transition-all ml-auto flex-shrink-0">
            arrow_forward
          </span>
        </Link>
      </div>

      {/* GRI popup — radar widget shown via "Открыть GRI" */}
      {griModalOpen && griData && (
        <GriRadarPopup data={griData} onClose={() => setGriModalOpen(false)} />
      )}
    </section>
  )
}

// ─── GRI radar popup ──────────────────────────────────────────────────────────
function GriRadarPopup({
  data,
  onClose,
}: {
  data: GriAssessmentData
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="GRI Assessment"
      className="fixed inset-0 z-[100] flex items-start justify-center p-4 sm:p-6 md:p-10 overflow-y-auto"
    >
      <div
        className="fixed inset-0 bg-black/75 backdrop-blur-md animate-in fade-in duration-200"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative z-10 w-full max-w-3xl my-auto rounded-2xl bg-surface border border-white/[0.06] shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть"
          className="absolute top-3 right-3 z-20 w-9 h-9 rounded-xl bg-surface-container border border-white/[0.06] text-on-surface-variant hover:text-on-surface hover:border-primary/30 flex items-center justify-center transition-colors"
        >
          <span className="material-symbols-outlined text-base">close</span>
        </button>
        <div className="p-4 sm:p-5 pt-12">
          <GRIAssessmentRadarWidget data={data} />
        </div>
      </div>
    </div>
  )
}
