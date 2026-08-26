'use client'

/**
 * GrowthSnapshotHero — the new top-of-page hero for /dashboard, /point-a,
 * /client/dashboard, /client/point-a.
 *
 * Two columns on lg+:
 *   Left  → "Точка А · Снимок · {source period}" card with 3 stacked tiles
 *           (current position, 12-month goal, 3-year goal)
 *   Right → AI Карта роста (goal-capture CTA) + GRI диагностика CTA
 *
 * DATA HONESTY
 * ------------
 * The «Текущая позиция» number used to be `monthlyPlan12 * 0.58` — 58 % of the
 * owner's own target, printed in 5xl as if it were fact, because the endpoint it
 * asked (`/api/v1/metrics?keys=…`) never read `keys` and always answered empty.
 * That heuristic is gone. Revenue now comes from the resolver
 * (`/api/v1/metrics/:id/value`), which returns a real value plus full
 * provenance, or nothing at all. Nothing is estimated, extrapolated or filled
 * in: no revenue → «—» plus an explicit list of the survey answers/documents
 * that would unlock it.
 *
 * Every tile is a <button> that opens `MetricExplainModal`: where the number
 * came from, which survey answers produced it, and what to do next.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import * as Dialog from '@radix-ui/react-dialog'
import {
  parseAmount,
  formatKzt,
  formatKztCompact,
} from '@/lib/format/kzt'
// Shared with tests/unit/dashboard/growth-snapshot.test.ts, which pins the rule
// that both target columns hold ANNUAL revenue.
import { annualRevenueTargetToMonthly } from '@/lib/dashboard/growth-snapshot'
import {
  parseLatestStorePendingPeriod,
  selectGrowthRevenue,
  type StoreMonthlyRevenueFact,
} from '@/lib/dashboard/growth-snapshot-source'
import { GRIAssessmentRadarWidget } from './GRIAssessmentRadarWidget'
import MetricExplainModal, {
  type ExplainAction,
  type MetricExplainModalProps,
} from './MetricExplainModal'
import {
  parseMetricValue,
  REVENUE_YEAR_METRIC_ID,
  type MetricValuePayload,
} from './_metric-value'

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
  survey: { percent: number; completed_steps: number; total_steps: number }
  documents: { count: number; has_files: boolean }
}

interface GriAssessmentData {
  gri_index: number
  section_avgs: Record<string, number>
  /** { [sectionId]: { [criterionId]: 1..10 } } — raw answers behind the block. */
  scores?: Record<string, Record<string, number>>
  created_at?: string
}

type LoadState = 'loading' | 'ready' | 'error'

/** Which tile the explain modal is currently describing. */
type ExplainKey = 'revenue' | 'goal12' | 'goal3y' | 'survey' | null

// ─── Constants ────────────────────────────────────────────────────────────────
const SURVEY_HREF = '/client/onboarding'
const DOCUMENTS_HREF = '/client/onboarding/documents'
const STORE_IMPORT_HREF = '/store/imports'

/** Actions offered whenever revenue is missing — an empty state must lead out. */
const REVENUE_ACTIONS: ExplainAction[] = [
  { label: 'Загрузить отчёт магазина', href: STORE_IMPORT_HREF, icon: 'storefront', primary: true },
  { label: 'Заполнить анкету', href: SURVEY_HREF, icon: 'edit_note' },
  { label: 'Годовой P&L Точки А', href: DOCUMENTS_HREF, icon: 'cloud_upload' },
]

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

  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [loadErr, setLoadErr] = useState<string | null>(null)

  const [targets, setTargets] = useState<TargetsData | null>(null)
  const [periodGoals, setPeriodGoals] = useState<PeriodGoals>({
    goal_week: null,
    goal_month: null,
  })
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null)
  const [hasGri, setHasGri] = useState<boolean>(false)
  const [griData, setGriData] = useState<GriAssessmentData | null>(null)
  const [griModalOpen, setGriModalOpen] = useState(false)

  // Resolver-backed annual revenue (₸ / год) with full provenance. Null when
  // no source produced a number — there is no fallback value by design.
  const [revenue, setRevenue] = useState<MetricValuePayload | null>(null)
  // Raw owner-scoped Store overview. It is parsed through a strict complete-
  // month guard before any value is allowed onto the hero.
  const [storeOverview, setStoreOverview] = useState<unknown>(null)

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
  const [tileErr, setTileErr] = useState<string | null>(null)

  // Drill-down
  const [explain, setExplain] = useState<ExplainKey>(null)

  /**
   * «Укажите цели справа» is a lie on mobile — the goal card wraps below.
   * Scroll to the input and put the caret in it instead of pointing at a
   * direction that depends on the viewport.
   */
  const focusGoalInput = useCallback(() => {
    const el = document.getElementById('hero-goal-1y') as HTMLInputElement | null
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.focus({ preventScroll: true })
  }, [])

  const load = useCallback(async () => {
    setLoadErr(null)
    try {
      const [tRes, gRes, oRes, griRes, revRes, storeRes] = await Promise.all([
        fetch('/api/v1/companies/targets', { credentials: 'include' }),
        fetch('/api/v1/companies/period-goals', { credentials: 'include' }),
        fetch('/api/v1/onboarding/status', { credentials: 'include' }),
        fetch('/api/v1/gri/assessment', { credentials: 'include' }),
        fetch(`/api/v1/metrics/${REVENUE_YEAR_METRIC_ID}/value`, {
          credentials: 'include',
          cache: 'no-store',
        }),
        fetch('/api/v1/store/overview', {
          credentials: 'include',
          cache: 'no-store',
        }),
      ])

      // An expired session must not masquerade as "нет данных".
      if ([tRes, gRes, oRes, griRes, revRes, storeRes].some((r) => r.status === 401)) {
        setLoadState('error')
        setLoadErr('Сессия истекла. Обновите страницу или войдите заново.')
        return
      }

      const tJ = await tRes.json().catch(() => ({}))
      const gJ = await gRes.json().catch(() => ({}))
      const oJ = await oRes.json().catch(() => ({}))
      const griJ = await griRes.json().catch(() => ({}))
      const revJ = await revRes.json().catch(() => ({}))
      const storeJ = await storeRes.json().catch(() => null)

      if (tJ?.ok) setTargets(tJ.data)
      if (gJ?.ok) setPeriodGoals(gJ.data)
      if (oJ?.ok) setOnboarding(oJ.data)

      // Revenue: `null` value is a legitimate answer («нет данных»); a broken
      // envelope is not — keep `revenue` null and let the tile say so.
      setRevenue(parseMetricValue(revJ, (n) => formatKzt(n)))
      // 403 (no Store access / missing MFA) and unavailable Store analytics are
      // normal fallbacks for non-Store accounts; they must not break Point A.
      setStoreOverview(storeRes.ok ? storeJ : null)

      if (griJ?.ok && griJ.data?.current) {
        setHasGri(true)
        const cur = griJ.data.current as {
          gri_index?: number
          section_avgs?: Record<string, number>
          scores?: Record<string, Record<string, number>>
          created_at?: string
        }
        setGriData({
          gri_index: Number(cur.gri_index ?? 0),
          section_avgs: cur.section_avgs ?? {},
          scores: cur.scores ?? {},
          created_at: cur.created_at,
        })
      } else {
        setHasGri(false)
        setGriData(null)
      }

      setLoadState('ready')
    } catch (e) {
      setLoadState('error')
      setLoadErr(e instanceof Error ? e.message : 'Не удалось загрузить данные')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Refresh when the user comes back from the survey / documents tab so the
  // hero doesn't keep showing pre-edit numbers.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
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
  // Convention across the codebase (app/api/export/report/route.ts:405,
  // app/api/expert/clients/[id]/point-b/route.ts:101): both target columns hold
  // ANNUAL revenue — `target_revenue_3y_kzt` is the annual revenue expected in
  // year 3, not a 3-year total. The old /36 and /3 divisors here contradicted
  // both the write path (parsed monthly × 12) and every other reader.
  const target12m = targets?.target_revenue_12m_kzt ?? null
  const target3y = targets?.target_revenue_3y_kzt ?? null
  const monthlyPlan12 = target12m ? annualRevenueTargetToMonthly(target12m) : null
  const monthlyPlan3y = target3y ? annualRevenueTargetToMonthly(target3y) : null

  // Store's latest complete published month is the canonical monthly fact. If
  // the account has no accessible Store contour, fall back to an explicitly
  // labelled annual average from the Point A resolver.
  const annualRevenue = revenue?.value ?? null
  const growthRevenue = useMemo(
    () => selectGrowthRevenue(storeOverview, annualRevenue),
    [storeOverview, annualRevenue],
  )
  const storeRevenue: StoreMonthlyRevenueFact | null =
    growthRevenue?.kind === 'store_monthly' ? growthRevenue : null
  const storePendingPeriod = useMemo(
    () => parseLatestStorePendingPeriod(storeOverview),
    [storeOverview],
  )
  const hasNewerPendingStorePeriod = Boolean(
    storePendingPeriod
    && (!storeRevenue || storePendingPeriod.period.from > storeRevenue.period.from),
  )
  const hasRevenue = growthRevenue !== null
  const currentMonthly = growthRevenue?.monthlyRevenue ?? null
  const annualReference = storeRevenue?.annualRunRate ?? annualRevenue

  // Year comes from the source that actually won (its own label), or from the
  // payload's period — never from the current date.
  const revenueYear = revenue?.pickedYear ?? revenue?.periodYear ?? null
  const revenuePeriodLabel = revenueYear
    ? `за ${revenueYear} год`
    : 'за отчётный год'
  const snapshotPeriodLabel = storeRevenue
    ? `${storeRevenue.periodLabel} · факт за месяц`
    : revenueYear
      ? `данные за ${revenueYear}${revenue?.periodQuarter ? ` · ${revenue.periodQuarter}` : ''}`
      : 'актуальные данные'

  const progressToPlan =
    currentMonthly !== null && monthlyPlan12 !== null
      ? pct(currentMonthly, monthlyPlan12)
      : null
  const progressTo3y =
    currentMonthly !== null && monthlyPlan3y !== null
      ? pct(currentMonthly, monthlyPlan3y)
      : null

  const gap12 =
    currentMonthly !== null && monthlyPlan12 !== null
      ? currentMonthly - monthlyPlan12
      : null
  const gap3y =
    currentMonthly !== null && monthlyPlan3y !== null
      ? currentMonthly - monthlyPlan3y
      : null

  const hasAnyTarget = Boolean(target12m || target3y)
  const hasAnyPeriodGoal = Boolean(periodGoals.goal_week || periodGoals.goal_month)
  const hasGoalsSet = hasAnyTarget || hasAnyPeriodGoal

  const surveyPercent = onboarding?.survey?.percent ?? null

  // ── Card A — submit Карта роста ───────────────────────────────────────────
  const submitMap = async () => {
    setSavingMap(true)
    setSaveErr(null)
    try {
      const parsed1y = parseAmount(draft1y)
      const parsed3y = parseAmount(draft3y)
      if (parsed1y === null && parsed3y === null) {
        setSaveErr('Введите хотя бы одну цель')
        setSavingMap(false)
        return
      }
      const requests: Promise<Response>[] = []
      if (parsed1y !== null) {
        // Store as period-goals.goal_month (1-year monthly hand-typed value)
        // AND as target_revenue_12m_kzt (so dashboards see the annual plan).
        requests.push(
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
        requests.push(
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

      // `fetch` does not throw on 4xx/5xx — the old code navigated to /point-b
      // even when nothing had been saved. Verify every response.
      const responses = await Promise.all(requests)
      for (const res of responses) {
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error(
            (j as { error?: string })?.error ??
              `Сервер ответил ${res.status}. Цели не сохранены.`,
          )
        }
        const j = await res.json().catch(() => ({}))
        if ((j as { ok?: boolean })?.ok === false) {
          throw new Error(
            (j as { error?: string })?.error ?? 'Цели не сохранены',
          )
        }
      }

      await load()
      router.push('/point-b')
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setSavingMap(false)
    }
  }

  // ── Tile edit popovers (left column) ──────────────────────────────────────
  const openEdit12 = useCallback(() => {
    setDraft12mEdit(target12m ? formatKzt(target12m) : '')
    setTileErr(null)
    setEditing12(true)
    setEditing3y(false)
  }, [target12m])
  const openEdit3y = useCallback(() => {
    setDraft3yEdit(target3y ? formatKzt(target3y) : '')
    setTileErr(null)
    setEditing3y(true)
    setEditing12(false)
  }, [target3y])
  const saveTile = async (which: '12' | '3y') => {
    setSavingTile(true)
    setTileErr(null)
    try {
      const value = which === '12'
        ? parseAmount(draft12mEdit)
        : parseAmount(draft3yEdit)
      if (value === null) {
        setTileErr('Не удалось разобрать сумму. Например: 90 млн или $200K')
        return
      }
      const body = which === '12'
        ? { target_revenue_12m_kzt: value }
        : { target_revenue_3y_kzt: value }
      const r = await fetch('/api/v1/companies/targets', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j?.ok === false) {
        setTileErr(j?.error ?? `Не сохранено (сервер ответил ${r.status})`)
        return
      }
      setTargets((prev) => prev
        ? {
            ...prev,
            ...(which === '12'
              ? { target_revenue_12m_kzt: value }
              : { target_revenue_3y_kzt: value }),
          }
        : {
            target_revenue_12m_kzt: which === '12' ? value : null,
            target_revenue_3y_kzt: which === '3y' ? value : null,
          }
      )
      setEditing12(false)
      setEditing3y(false)
    } catch (e) {
      setTileErr(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setSavingTile(false)
    }
  }

  // ── Explain modal content ─────────────────────────────────────────────────
  const explainProps: Omit<MetricExplainModalProps, 'open' | 'onClose'> | null =
    useMemo(() => {
      if (!explain) return null

      const planRow = (label: string, v: number | null) => ({
        label,
        value: v !== null ? formatKzt(v) : 'не указана',
        tone: (v !== null ? 'good' : 'muted') as 'good' | 'muted',
      })

      if (explain === 'revenue') {
        if (storeRevenue) {
          return {
            eyebrow: 'Магазин · подтверждённый факт',
            title: `Выручка · ${storeRevenue.periodLabel}`,
            value: `${formatKzt(storeRevenue.monthlyRevenue)} / мес`,
            valueHint: `${storeRevenue.period.from} — ${storeRevenue.period.to} · без деления и экстраполяции`,
            what:
              'Фактическая выручка за последний полностью опубликованный месяц Store Control Center. Значение берётся напрямую из подтверждённого управленческого периода и не делится на 12.',
            why:
              'Это текущий проверяемый факт магазина. Он используется для сравнения с месячной целью; годовой run-rate показывается отдельно и явно помечен как темп, а не как годовой факт.',
            formula: [
              {
                label: `Опубликованный месяц · ${storeRevenue.periodLabel}`,
                value: formatKzt(storeRevenue.monthlyRevenue),
                tone: 'good' as const,
              },
              {
                label: 'Преобразование месячного факта',
                value: 'не применяется',
                tone: 'muted' as const,
              },
            ],
            sources: [
              {
                type: 'external' as const,
                label: 'Store Control Center',
                detail: `${storeRevenue.scopeKey} · ${storeRevenue.source}`,
                status: 'hit' as const,
                picked: true,
                value: formatKzt(storeRevenue.monthlyRevenue),
              },
            ],
            computedAt: storeRevenue.publishedAt,
            actions: [
              { label: 'Загрузить новый отчёт', href: STORE_IMPORT_HREF, icon: 'upload_file', primary: true },
              { label: 'Открыть статистику', href: '/store', icon: 'monitoring' },
            ],
          }
        }
        return {
          eyebrow: 'Точка А · факт',
          title: 'Выручка',
          value: currentMonthly !== null ? `${formatKzt(currentMonthly)} / мес` : null,
          valueHint:
            annualRevenue !== null
              ? `${formatKzt(annualRevenue)} ${revenuePeriodLabel} ÷ 12 месяцев`
              : 'Значение не рассчитано — нет ни одного заполненного источника',
          what:
            'Годовая выручка компании — сумма всех оплат от клиентов за отчётный год. Месячная цифра на плитке получена делением годовой на 12, это средний месяц, а не факт текущего месяца.',
          why:
            'Это отправная точка всей диагностики: от неё считается разрыв до целей 1 и 3 лет и приоритет работ в карте роста.',
          formula:
            annualRevenue !== null
              ? [
                  {
                    label: `Годовая выручка (${revenue?.source === 'live' ? 'рассчитано сейчас' : 'сохранённое значение'})`,
                    value: formatKzt(annualRevenue),
                    tone: 'good' as const,
                  },
                  { label: 'Делим на месяцев', value: '12', tone: 'muted' as const },
                  {
                    label: 'В среднем в месяц',
                    value: formatKzt(currentMonthly ?? 0),
                    tone: 'good' as const,
                  },
                ]
              : undefined,
          sources: revenue?.sources,
          computedAt: revenue?.computedAt ?? null,
          fresh: revenue?.fresh,
          missing:
            annualRevenue === null
              ? (revenue?.missing?.length
                  ? revenue.missing
                  : ['Ни один источник выручки не подключён: нет ответов анкеты и нет разобранного P&L'])
              : undefined,
          actions: REVENUE_ACTIONS,
        }
      }

      if (explain === 'goal12') {
        return {
          eyebrow: 'Цель · 12 месяцев',
          title: 'Цель по выручке на год',
          value: monthlyPlan12 !== null ? `${formatKzt(monthlyPlan12)} / мес` : null,
          valueHint:
            target12m !== null
              ? `${formatKzt(target12m)} в год ÷ 12 месяцев`
              : 'Цель на 12 месяцев ещё не указана',
          what:
            'Цель по годовой выручке, которую вы указали сами — в карточке «AI · Карта роста» или карандашом на этой плитке.',
          why:
            'Разрыв между фактом и целью задаёт объём работ в карте роста: сколько выручки нужно добрать и за счёт каких каналов.',
          formula: [
            planRow('Цель на год', target12m),
            planRow('В среднем в месяц', monthlyPlan12),
            {
              label: storeRevenue
                ? `Факт · ${storeRevenue.periodLabel}`
                : 'Факт сейчас (в среднем в месяц)',
              value: currentMonthly !== null ? formatKzt(currentMonthly) : '—',
              tone: (currentMonthly !== null ? 'good' : 'muted') as 'good' | 'muted',
            },
            {
              label: 'Разрыв',
              value: gap12 !== null ? `${gap12 >= 0 ? '+' : ''}${formatKzt(gap12)} / мес` : '—',
              note:
                gap12 === null
                  ? 'Считается, только когда есть и факт выручки, и цель'
                  : undefined,
              tone: (gap12 === null ? 'muted' : gap12 < 0 ? 'bad' : 'good') as
                | 'muted'
                | 'bad'
                | 'good',
            },
          ],
          sources: [
            {
              type: 'manual' as const,
              label: 'Цель на 12 месяцев',
              detail: 'companies.target_revenue_12m_kzt · вводится вами',
              status: (target12m !== null ? 'hit' : 'miss') as 'hit' | 'miss',
              picked: target12m !== null,
              value: target12m !== null ? formatKzt(target12m) : undefined,
              reason: target12m === null ? 'Цель ещё не указана' : undefined,
            },
          ],
          missing: [
            ...(target12m === null ? ['Не указана цель по выручке на 12 месяцев'] : []),
            ...(currentMonthly === null ? ['Нет фактической выручки — разрыв не посчитать'] : []),
          ],
          actions: [
            { label: 'Изменить цель', onClick: () => { setExplain(null); openEdit12() }, icon: 'edit', primary: true },
            ...(currentMonthly === null ? REVENUE_ACTIONS : []),
            { label: 'План vs Факт', href: '/point-b', icon: 'trending_up' },
          ],
        }
      }

      if (explain === 'goal3y') {
        return {
          eyebrow: 'Цель · 3 года',
          title: 'Цель по выручке на третий год',
          value: monthlyPlan3y !== null ? `${formatKzt(monthlyPlan3y)} / мес` : null,
          valueHint:
            target3y !== null
              ? `${formatKzt(target3y)} за третий год ÷ 12 месяцев`
              : 'Цель на 3 года ещё не указана',
          what:
            'Годовая выручка, на которую вы хотите выйти к третьему году. Это годовой оборот в третий год, а не сумма за три года.',
          why:
            'Задаёт горизонт стратегии: какие каналы, команда и операционка должны появиться, чтобы такой оборот выдержать.',
          formula: [
            planRow('Цель на 3-й год (годовая выручка)', target3y),
            planRow('В среднем в месяц', monthlyPlan3y),
            {
              label: storeRevenue
                ? `Факт · ${storeRevenue.periodLabel}`
                : 'Факт сейчас (в среднем в месяц)',
              value: currentMonthly !== null ? formatKzt(currentMonthly) : '—',
              tone: (currentMonthly !== null ? 'good' : 'muted') as 'good' | 'muted',
            },
            {
              label: 'Разрыв',
              value: gap3y !== null ? `${gap3y >= 0 ? '+' : ''}${formatKzt(gap3y)} / мес` : '—',
              tone: (gap3y === null ? 'muted' : gap3y < 0 ? 'bad' : 'good') as
                | 'muted'
                | 'bad'
                | 'good',
            },
          ],
          sources: [
            {
              type: 'manual' as const,
              label: 'Цель на 3 года',
              detail: 'companies.target_revenue_3y_kzt · вводится вами',
              status: (target3y !== null ? 'hit' : 'miss') as 'hit' | 'miss',
              picked: target3y !== null,
              value: target3y !== null ? formatKzt(target3y) : undefined,
              reason: target3y === null ? 'Цель ещё не указана' : undefined,
            },
          ],
          missing: [
            ...(target3y === null ? ['Не указана цель по выручке на третий год'] : []),
            ...(currentMonthly === null ? ['Нет фактической выручки — разрыв не посчитать'] : []),
          ],
          actions: [
            { label: 'Изменить цель', onClick: () => { setExplain(null); openEdit3y() }, icon: 'edit', primary: true },
            ...(currentMonthly === null ? REVENUE_ACTIONS : []),
            { label: 'План vs Факт', href: '/point-b', icon: 'trending_up' },
          ],
        }
      }

      // explain === 'survey'
      return {
        eyebrow: 'Данные о компании',
        title: 'Прогресс анкеты',
        value: surveyPercent !== null ? `${surveyPercent}%` : null,
        valueHint:
          onboarding
            ? `${onboarding.survey.completed_steps} из ${onboarding.survey.total_steps} шагов · загружено файлов: ${onboarding.documents.count}`
            : 'Статус анкеты ещё не загружен',
        what:
          'Доля заполненных шагов анкеты собственника. Из этих ответов резолвер собирает выручку, маржу, команду и остальные показатели Точки А.',
        why:
          'Пока шаг не заполнен, все метрики, которые из него считаются, остаются пустыми — их нечем заменить, кроме загруженных отчётов.',
        formula: onboarding
          ? [
              { label: 'Заполнено шагов', value: String(onboarding.survey.completed_steps), tone: 'good' as const },
              { label: 'Всего шагов', value: String(onboarding.survey.total_steps), tone: 'muted' as const },
              { label: 'Загружено документов', value: String(onboarding.documents.count), tone: onboarding.documents.count > 0 ? ('good' as const) : ('muted' as const) },
            ]
          : undefined,
        actions: [
          { label: 'Продолжить анкету', href: SURVEY_HREF, icon: 'edit_note', primary: true },
          { label: 'Загрузить документы', href: DOCUMENTS_HREF, icon: 'cloud_upload' },
        ],
      }
    }, [
      explain,
      annualRevenue,
      currentMonthly,
      revenue,
      revenuePeriodLabel,
      storeRevenue,
      target12m,
      target3y,
      monthlyPlan12,
      monthlyPlan3y,
      gap12,
      gap3y,
      onboarding,
      surveyPercent,
      openEdit12,
      openEdit3y,
    ])

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
              Точка А · Снимок · {snapshotPeriodLabel}
            </p>
            <span
              className="material-symbols-outlined text-base text-primary/40"
              aria-hidden="true"
            >
              insights
            </span>
          </div>

          {loadState === 'ready' && hasNewerPendingStorePeriod && storePendingPeriod && (
            <div
              role="status"
              className="mb-3 flex items-start gap-2 rounded-xl border border-tertiary-container/25 bg-tertiary-container/[0.07] px-3 py-2.5 text-xs leading-relaxed text-on-surface-variant"
            >
              <span className="material-symbols-outlined mt-0.5 text-base text-tertiary-container" aria-hidden="true">
                pending_actions
              </span>
              <p className="min-w-0 flex-1">
                <span className="font-semibold text-on-surface">{storePendingPeriod.periodLabel} загружен как предварительный.</span>{' '}
                Он уже виден в статистике Магазина, но не выдаётся за закрытый месяц.
                {storeRevenue ? ` Для текущей позиции пока используется ${storeRevenue.periodLabel}.` : ''}
              </p>
              <Link href="/store" className="shrink-0 font-semibold text-tertiary-container hover:underline">
                Статистика
              </Link>
            </div>
          )}

          {loadState === 'loading' ? (
            <div className="space-y-2.5" aria-busy="true" aria-live="polite">
              <span className="sr-only">Загружаем снимок Точки А</span>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-[104px] bg-surface-container rounded-xl border border-white/[0.04] animate-pulse"
                />
              ))}
            </div>
          ) : loadState === 'error' ? (
            <div className="bg-surface-container rounded-xl border border-error/30 p-6 text-center">
              <span
                className="material-symbols-outlined text-3xl text-error/70 block mb-2"
                aria-hidden="true"
              >
                error_outline
              </span>
              <p className="text-sm text-on-surface font-medium mb-1">
                Не удалось загрузить снимок
              </p>
              <p className="text-xs text-on-surface-variant max-w-sm mx-auto leading-relaxed mb-4">
                {loadErr ?? 'Сервер не ответил. Это не «нет данных» — данные могут быть на месте.'}
              </p>
              <button
                type="button"
                onClick={() => { setLoadState('loading'); load() }}
                className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-mono font-bold bg-primary text-on-primary hover:bg-primary/90 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
              >
                <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
                  refresh
                </span>
                Повторить
              </button>
            </div>
          ) : !hasGoalsSet && !hasRevenue ? (
            <div className="bg-surface-container rounded-xl border border-dashed border-white/10 p-6 text-center">
              <span
                className="material-symbols-outlined text-3xl text-primary/30 block mb-2"
                aria-hidden="true"
              >
                target
              </span>
              <p className="text-sm text-on-surface font-medium mb-1">
                Снимок Точки А ещё не построен
              </p>
              <p className="text-xs text-on-surface-variant max-w-sm mx-auto leading-relaxed mb-4">
                Не хватает двух вещей: фактической выручки (месячный отчёт
                магазина, анкета или годовой P&amp;L) и целей на 1 и 3 года. Как
                только появится хотя бы одно — здесь будет разрыв до цели.
              </p>
              <div className="flex flex-wrap gap-2 justify-center">
                <Link
                  href={STORE_IMPORT_HREF}
                  className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-mono font-bold bg-primary text-on-primary hover:bg-primary/90 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                >
                  <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
                    storefront
                  </span>
                  Отчёт магазина
                </Link>
                <Link
                  href={SURVEY_HREF}
                  className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-mono border border-white/10 text-on-surface-variant hover:text-on-surface hover:border-primary/40 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                >
                  <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
                    edit_note
                  </span>
                  Заполнить анкету
                </Link>
                <Link
                  href={DOCUMENTS_HREF}
                  className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-mono border border-white/10 text-on-surface-variant hover:text-on-surface hover:border-primary/40 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                >
                  <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
                    cloud_upload
                  </span>
                  Годовой P&amp;L
                </Link>
                <button
                  type="button"
                  onClick={focusGoalInput}
                  className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-mono border border-white/10 text-on-surface-variant hover:text-on-surface hover:border-primary/40 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                >
                  <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
                    flag
                  </span>
                  Указать цели
                </button>
                <button
                  type="button"
                  onClick={() => setExplain('revenue')}
                  className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-mono border border-white/10 text-on-surface-variant hover:text-on-surface hover:border-primary/40 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                >
                  <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
                    help
                  </span>
                  Каких данных не хватает
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              {/* Tile 1 — Текущая позиция (brand accent) */}
              <div className="relative bg-surface-container rounded-xl border border-white/[0.04] overflow-hidden">
                <span
                  className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl"
                  style={{ background: 'linear-gradient(180deg, #e87a35, #dc524b)' }}
                  aria-hidden="true"
                />
                {hasRevenue ? (
                  <button
                    type="button"
                    onClick={() => setExplain('revenue')}
                    aria-label="Разбор: откуда взята текущая выручка"
                    className="w-full text-left p-5 pl-6 hover:bg-white/[0.02] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 rounded-xl"
                  >
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-[180px]">
                        <div className="flex items-center gap-2 mb-2">
                          <p className="text-[11px] font-mono text-on-surface-variant uppercase tracking-[0.18em]">
                            Текущая позиция
                          </p>
                          <span
                            className="material-symbols-outlined text-[14px] text-on-surface-variant/50"
                            aria-hidden="true"
                          >
                            info
                          </span>
                        </div>
                        <p className="font-mono text-5xl font-black text-on-surface leading-[0.95] tracking-tight">
                          {formatKztCompact(currentMonthly)}
                        </p>
                        <p className="text-[11px] text-on-surface-variant font-mono mt-2">
                          {storeRevenue
                            ? `факт за месяц · ${storeRevenue.periodLabel}`
                            : `в среднем в месяц · ${formatKztCompact(annualRevenue)} ${revenuePeriodLabel}`}
                        </p>
                      </div>
                      <div className="flex-1 min-w-[180px]">
                        <span className="text-[9px] font-mono text-on-surface-variant uppercase tracking-widest block mb-1">
                          {storeRevenue ? 'Run-rate 12 месяцев' : 'Годовая выручка'}
                        </span>
                        <p className="text-xs font-mono text-on-surface">
                          {formatKztCompact(annualReference)}
                          {target12m && (
                            <span className="text-on-surface-variant">
                              {' '}vs план {formatKztCompact(target12m)}
                            </span>
                          )}
                        </p>
                        {progressToPlan !== null && (
                          <>
                            <div
                              className="mt-2 h-1.5 bg-surface-container-high rounded-full overflow-hidden"
                              role="progressbar"
                              aria-valuenow={progressToPlan}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-label="Выполнение цели по выручке"
                            >
                              <div
                                className={`h-full ${progressColor(progressToPlan)} rounded-full transition-all duration-700`}
                                style={{ width: `${progressToPlan}%` }}
                              />
                            </div>
                            <p className="text-[10px] font-mono text-on-surface-variant mt-1">
                              {progressToPlan}% к цели 1Y
                            </p>
                          </>
                        )}
                      </div>
                    </div>
                  </button>
                ) : (
                  /* Honest empty state — no estimate, no "≈", a way out. */
                  <div className="p-5 pl-6">
                    <p className="text-[11px] font-mono text-on-surface-variant uppercase tracking-[0.18em] mb-2">
                      Текущая позиция
                    </p>
                    <p className="font-mono text-5xl font-black text-on-surface-variant/40 leading-[0.95] tracking-tight">
                      —
                    </p>
                    <p className="text-sm text-on-surface font-medium mt-3">
                      Выручка не подключена
                    </p>
                    <p className="text-xs text-on-surface-variant leading-relaxed mt-1 max-w-md">
                      {revenue?.missing?.length
                        ? revenue.missing[0]
                        : 'Нет ни одного источника выручки: ответы анкеты о выручке не заполнены и P&L не загружен.'}
                    </p>
                    <div className="flex flex-wrap gap-2 mt-3">
                      <Link
                        href={STORE_IMPORT_HREF}
                        className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-mono font-bold bg-primary text-on-primary hover:bg-primary/90 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                      >
                        <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
                          storefront
                        </span>
                        Отчёт магазина
                      </Link>
                      <Link
                        href={SURVEY_HREF}
                        className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-mono border border-white/10 text-on-surface-variant hover:text-on-surface hover:border-primary/40 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                      >
                        <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
                          edit_note
                        </span>
                        Заполнить анкету
                      </Link>
                      <Link
                        href={DOCUMENTS_HREF}
                        className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-mono border border-white/10 text-on-surface-variant hover:text-on-surface hover:border-primary/40 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                      >
                        <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
                          cloud_upload
                        </span>
                        Годовой P&amp;L
                      </Link>
                      <button
                        type="button"
                        onClick={() => setExplain('revenue')}
                        className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-mono border border-white/10 text-on-surface-variant hover:text-on-surface hover:border-primary/40 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                      >
                        <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
                          help
                        </span>
                        Каких данных не хватает
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Tile 2 — Цель 12 месяцев */}
              {(target12m || hasAnyPeriodGoal) && (
                <div className="relative bg-surface-container rounded-xl border border-white/[0.04] overflow-hidden">
                  <span
                    className="absolute left-0 top-0 bottom-0 w-1 bg-primary/80 rounded-l-xl"
                    aria-hidden="true"
                  />
                  <button
                    type="button"
                    onClick={openEdit12}
                    aria-label="Изменить цель 12 месяцев"
                    aria-expanded={editing12}
                    className="absolute top-3 right-3 z-10 w-7 h-7 rounded-lg flex items-center justify-center text-on-surface-variant/60 hover:text-primary hover:bg-white/[0.05] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                  >
                    <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
                      edit
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setExplain('goal12')}
                    aria-label="Разбор: как посчитана цель на 12 месяцев и разрыв до неё"
                    className="w-full text-left p-5 pl-6 pr-12 hover:bg-white/[0.02] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 rounded-xl"
                  >
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-[160px]">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span
                            className="material-symbols-outlined text-[12px] text-primary/80"
                            aria-hidden="true"
                          >
                            arrow_downward
                          </span>
                          <p className="text-[9px] font-mono text-on-surface-variant uppercase tracking-widest">
                            Цель 12 месяцев
                          </p>
                        </div>
                        <p className="font-mono text-4xl font-black text-primary leading-[0.95] tracking-tight">
                          {monthlyPlan12 !== null ? formatKztCompact(monthlyPlan12) : '—'}
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
                          {gap12 !== null ? (
                            <span className={gap12 < 0 ? 'text-error' : 'text-primary'}>
                              {gap12 < 0 ? '' : '+'}{formatKztCompact(gap12)}/мес
                            </span>
                          ) : (
                            <span className="text-on-surface-variant">
                              — нет факта выручки
                            </span>
                          )}
                        </p>
                        {progressToPlan !== null ? (
                          <>
                            <div
                              className="mt-2 h-1.5 bg-surface-container-high rounded-full overflow-hidden"
                              role="progressbar"
                              aria-valuenow={progressToPlan}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-label="Выполнение цели на 12 месяцев"
                            >
                              <div
                                className={`h-full ${progressColor(progressToPlan)} rounded-full transition-all duration-700`}
                                style={{ width: `${progressToPlan}%` }}
                              />
                            </div>
                            <p className="text-[10px] font-mono text-on-surface-variant mt-1">
                              {progressToPlan}% к цели 1Y
                            </p>
                          </>
                        ) : (
                          <p className="text-[10px] font-mono text-on-surface-variant/60 mt-2 leading-relaxed">
                            Прогресс появится, когда будет фактическая выручка
                          </p>
                        )}
                      </div>
                    </div>
                  </button>

                  {editing12 && (
                    <div className="px-5 pb-4 pl-6">
                      <form
                        onSubmit={(e) => { e.preventDefault(); saveTile('12') }}
                        className="pt-3 border-t border-white/[0.06] flex flex-wrap items-end gap-2"
                      >
                        <div className="flex-1 min-w-[180px]">
                          <label
                            htmlFor="hero-goal-12m"
                            className="block text-[9px] font-mono text-on-surface-variant uppercase tracking-widest mb-1"
                          >
                            Новая цель (₸ / год)
                          </label>
                          <input
                            id="hero-goal-12m"
                            type="text"
                            autoFocus
                            value={draft12mEdit}
                            onChange={(e) => setDraft12mEdit(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Escape') setEditing12(false) }}
                            placeholder="например 90 млн или $200K"
                            className="w-full bg-surface-container-low border border-white/[0.06] rounded-lg px-3 py-1.5 text-xs font-mono text-on-surface focus:outline-none focus:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/40"
                          />
                          <p className="text-[9px] font-mono text-on-surface-variant mt-1">
                            {parseAmount(draft12mEdit) !== null
                              ? `= ${formatKzt(Math.round(parseAmount(draft12mEdit)! / 12))} /мес`
                              : ' '}
                          </p>
                        </div>
                        <button
                          type="submit"
                          disabled={savingTile}
                          className="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-[11px] font-mono font-bold uppercase hover:bg-primary/90 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                        >
                          {savingTile ? '…' : 'OK'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditing12(false)}
                          className="px-2 py-1.5 rounded-lg text-[11px] font-mono text-on-surface-variant hover:text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                        >
                          Отмена
                        </button>
                        {tileErr && (
                          <p className="w-full text-[10px] text-error font-mono" role="alert">
                            {tileErr}
                          </p>
                        )}
                      </form>
                    </div>
                  )}
                </div>
              )}

              {/* Tile 3 — Цель 3 года */}
              {(target3y || hasAnyPeriodGoal) && (
                <div className="relative bg-surface-container rounded-xl border border-white/[0.04] overflow-hidden">
                  <span
                    className="absolute left-0 top-0 bottom-0 w-1 bg-primary/80 rounded-l-xl"
                    aria-hidden="true"
                  />
                  <button
                    type="button"
                    onClick={openEdit3y}
                    aria-label="Изменить цель 3 года"
                    aria-expanded={editing3y}
                    className="absolute top-3 right-3 z-10 w-7 h-7 rounded-lg flex items-center justify-center text-on-surface-variant/60 hover:text-primary hover:bg-white/[0.05] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                  >
                    <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
                      edit
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setExplain('goal3y')}
                    aria-label="Разбор: как посчитана цель на 3 года и разрыв до неё"
                    className="w-full text-left p-5 pl-6 pr-12 hover:bg-white/[0.02] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 rounded-xl"
                  >
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-[160px]">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span
                            className="material-symbols-outlined text-[12px] text-primary/80"
                            aria-hidden="true"
                          >
                            arrow_upward
                          </span>
                          <p className="text-[9px] font-mono text-on-surface-variant uppercase tracking-widest">
                            Цель 3 года
                          </p>
                        </div>
                        <p className="font-mono text-4xl font-black text-primary leading-[0.95] tracking-tight">
                          {monthlyPlan3y !== null ? formatKztCompact(monthlyPlan3y) : '—'}
                        </p>
                        <p className="text-[11px] text-on-surface-variant font-mono mt-1.5">
                          /мес · {target3y ? formatKztCompact(target3y) : '—'} / год к 3-му году
                        </p>
                      </div>
                      <div className="flex-1 min-w-[180px]">
                        <span className="text-[9px] font-mono text-on-surface-variant uppercase tracking-widest block mb-1">
                          Разрыв
                        </span>
                        <p className="text-xs font-mono text-on-surface">
                          {gap3y !== null ? (
                            <span className={gap3y < 0 ? 'text-error' : 'text-primary'}>
                              {gap3y < 0 ? '' : '+'}{formatKztCompact(gap3y)}/мес
                            </span>
                          ) : (
                            <span className="text-on-surface-variant">
                              — нет факта выручки
                            </span>
                          )}
                        </p>
                        {progressTo3y !== null ? (
                          <>
                            <div
                              className="mt-2 h-1.5 bg-surface-container-high rounded-full overflow-hidden"
                              role="progressbar"
                              aria-valuenow={progressTo3y}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-label="Выполнение цели на 3 года"
                            >
                              <div
                                className={`h-full ${progressColor(progressTo3y)} rounded-full transition-all duration-700`}
                                style={{ width: `${progressTo3y}%` }}
                              />
                            </div>
                            <p className="text-[10px] font-mono text-on-surface-variant mt-1">
                              {progressTo3y}% к цели 3Y
                            </p>
                          </>
                        ) : (
                          <p className="text-[10px] font-mono text-on-surface-variant/60 mt-2 leading-relaxed">
                            Прогресс появится, когда будет фактическая выручка
                          </p>
                        )}
                      </div>
                    </div>
                  </button>

                  {editing3y && (
                    <div className="px-5 pb-4 pl-6">
                      <form
                        onSubmit={(e) => { e.preventDefault(); saveTile('3y') }}
                        className="pt-3 border-t border-white/[0.06] flex flex-wrap items-end gap-2"
                      >
                        <div className="flex-1 min-w-[180px]">
                          <label
                            htmlFor="hero-goal-3y"
                            className="block text-[9px] font-mono text-on-surface-variant uppercase tracking-widest mb-1"
                          >
                            Новая цель (₸ / год к 3-му году)
                          </label>
                          <input
                            id="hero-goal-3y"
                            type="text"
                            autoFocus
                            value={draft3yEdit}
                            onChange={(e) => setDraft3yEdit(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Escape') setEditing3y(false) }}
                            placeholder="например 300 млн или $2M"
                            className="w-full bg-surface-container-low border border-white/[0.06] rounded-lg px-3 py-1.5 text-xs font-mono text-on-surface focus:outline-none focus:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/40"
                          />
                          <p className="text-[9px] font-mono text-on-surface-variant mt-1">
                            {parseAmount(draft3yEdit) !== null
                              ? `= ${formatKzt(Math.round(parseAmount(draft3yEdit)! / 12))} /мес`
                              : ' '}
                          </p>
                        </div>
                        <button
                          type="submit"
                          disabled={savingTile}
                          className="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-[11px] font-mono font-bold uppercase hover:bg-primary/90 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                        >
                          {savingTile ? '…' : 'OK'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditing3y(false)}
                          className="px-2 py-1.5 rounded-lg text-[11px] font-mono text-on-surface-variant hover:text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                        >
                          Отмена
                        </button>
                        {tileErr && (
                          <p className="w-full text-[10px] text-error font-mono" role="alert">
                            {tileErr}
                          </p>
                        )}
                      </form>
                    </div>
                  )}
                </div>
              )}

              {/* Goals not set yet, but revenue is known — offer the next step. */}
              {!hasGoalsSet && (
                <div className="bg-surface-container rounded-xl border border-dashed border-white/10 p-4">
                  <p className="text-sm text-on-surface font-medium mb-1">
                    Целей пока нет
                  </p>
                  <p className="text-xs text-on-surface-variant leading-relaxed mb-3">
                    Выручка есть, целей нет — разрыв считать не от чего. Укажите
                    цель на 1 и 3 года в карточке «AI · Карта роста».
                  </p>
                  <button
                    type="button"
                    onClick={focusGoalInput}
                    className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-mono font-bold bg-primary text-on-primary hover:bg-primary/90 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                  >
                    <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
                      flag
                    </span>
                    Указать цели
                  </button>
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

            <form
              onSubmit={(e) => { e.preventDefault(); submitMap() }}
              noValidate
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
                <div>
                  <label
                    htmlFor="hero-goal-1y"
                    className="block text-[9px] font-mono text-primary/70 uppercase tracking-widest mb-1"
                  >
                    Цель · 1 год (₸ / мес)
                  </label>
                  <input
                    id="hero-goal-1y"
                    type="text"
                    value={draft1y}
                    onChange={(e) => setDraft1y(e.target.value)}
                    placeholder="например 7,5 млн"
                    className="w-full bg-surface-container border border-white/[0.08] rounded-lg px-3 py-2 text-xs font-mono text-on-surface focus:outline-none focus:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/40"
                  />
                  <p className="text-[9px] font-mono text-on-surface-variant mt-1">
                    {parseAmount(draft1y) !== null
                      ? `= ${formatKzt(parseAmount(draft1y))} /мес · ${formatKzt(parseAmount(draft1y)! * 12)} / год`
                      : ' '}
                  </p>
                </div>
                <div>
                  <label
                    htmlFor="hero-goal-3y-new"
                    className="block text-[9px] font-mono text-primary/70 uppercase tracking-widest mb-1"
                  >
                    Цель · 3 года (₸ / мес)
                  </label>
                  <input
                    id="hero-goal-3y-new"
                    type="text"
                    value={draft3y}
                    onChange={(e) => setDraft3y(e.target.value)}
                    placeholder="например 25 млн"
                    className="w-full bg-surface-container border border-white/[0.08] rounded-lg px-3 py-2 text-xs font-mono text-on-surface focus:outline-none focus:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/40"
                  />
                  <p className="text-[9px] font-mono text-on-surface-variant mt-1">
                    {parseAmount(draft3y) !== null
                      ? `= ${formatKzt(parseAmount(draft3y))} /мес · ${formatKzt(parseAmount(draft3y)! * 12)} / год к 3-му году`
                      : ' '}
                  </p>
                </div>
              </div>

              {saveErr && (
                <p className="text-[10px] text-error font-mono mb-2" role="alert">
                  {saveErr}
                </p>
              )}

              <button
                type="submit"
                disabled={savingMap}
                className="w-full inline-flex items-center justify-center gap-2 text-white font-bold text-base rounded-xl py-3.5 hover:brightness-110 disabled:opacity-50 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-container-low"
                style={{
                  background: 'linear-gradient(90deg, #e87a35, #dc524b)',
                  boxShadow: '0 0 30px -10px rgba(232,122,53,0.55)',
                }}
              >
                <span className="material-symbols-outlined text-lg" aria-hidden="true">
                  auto_awesome
                </span>
                {savingMap ? 'Сохраняем…' : 'Получить карту роста'}
              </button>
            </form>

            <div className="mt-3 pt-2.5 border-t border-white/[0.06]">
              {hasRevenue ? (
                <button
                  type="button"
                  onClick={() => setExplain('revenue')}
                  aria-label="Разбор: откуда взята текущая выручка"
                  className="text-left text-[10px] font-mono text-on-surface-variant leading-relaxed hover:text-on-surface transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 rounded"
                >
                  Текущая позиция: {formatKztCompact(currentMonthly)}/мес
                  {' · '}{storeRevenue ? 'Run-rate 12 месяцев' : 'Годовая выручка'}:{' '}
                  {formatKztCompact(annualReference)}
                  {' · '}Разрыв до 1Y:{' '}
                  {gap12 !== null ? `${formatKztCompact(gap12)}/мес` : 'нет цели'}
                  {' · '}
                  <span className="text-primary/80">откуда это</span>
                </button>
              ) : (
                <p className="text-[10px] font-mono text-on-surface-variant leading-relaxed">
                  Фактической выручки пока нет —{' '}
                  <Link
                    href={SURVEY_HREF}
                    className="text-primary/80 hover:text-primary underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 rounded"
                  >
                    заполнить анкету
                  </Link>
                  , и карта роста посчитает разрыв.
                </p>
              )}
            </div>
          </div>

          {/* Card B — GRI диагностика */}
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

            {hasGri && griData ? (
              <button
                type="button"
                onClick={() => setGriModalOpen(true)}
                className="w-full inline-flex items-center justify-center gap-2 text-white font-bold text-base rounded-xl py-3.5 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-container-low hover:brightness-110"
                style={{
                  background: 'linear-gradient(90deg, #e87a35, #dc524b)',
                  boxShadow: '0 0 30px -10px rgba(232,122,53,0.55)',
                }}
              >
                <span className="material-symbols-outlined text-lg" aria-hidden="true">
                  insights
                </span>
                Открыть результаты GRI
              </button>
            ) : (
              <Link
                href="/gri"
                className="w-full inline-flex items-center justify-center gap-2 text-white font-bold text-base rounded-xl py-3.5 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-container-low hover:brightness-110"
                style={{
                  background: 'linear-gradient(90deg, #e87a35, #dc524b)',
                  boxShadow: '0 0 30px -10px rgba(232,122,53,0.55)',
                }}
              >
                <span className="material-symbols-outlined text-lg" aria-hidden="true">
                  change_history
                </span>
                Пройти GRI-диагностику
              </Link>
            )}

            <div className="flex items-center justify-center gap-4 mt-3 flex-wrap">
              {hasGri && (
                <>
                  <Link
                    href="/gri"
                    className="text-[11px] font-mono text-on-surface-variant hover:text-on-surface inline-flex items-center gap-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 rounded"
                  >
                    <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
                      restart_alt
                    </span>
                    Пройти GRI заново
                  </Link>
                  <span className="text-on-surface-variant/30" aria-hidden="true">·</span>
                </>
              )}
              <a
                href="https://tidycal.com/istart/gtm"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-mono text-on-surface-variant hover:text-on-surface inline-flex items-center gap-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 rounded"
              >
                <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
                  forum
                </span>
                Связаться с экспертом
                <span className="material-symbols-outlined text-[13px]" aria-hidden="true">
                  open_in_new
                </span>
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

      {/* ── Footer ─ canonical data-entry routes ─────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="relative bg-surface-container-low rounded-2xl border border-white/[0.04] p-4">
          <button
            type="button"
            onClick={() => setExplain('survey')}
            aria-label="Разбор: что даёт прогресс анкеты"
            className="absolute top-3 right-3 w-7 h-7 rounded-lg flex items-center justify-center text-on-surface-variant/50 hover:text-primary hover:bg-white/[0.05] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
              info
            </span>
          </button>
          <Link
            href={SURVEY_HREF}
            className="group block focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 rounded-xl"
          >
            <div className="flex items-center justify-between gap-3 mb-2 pr-8">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="material-symbols-outlined text-base text-primary"
                  aria-hidden="true"
                >
                  edit_note
                </span>
                <p className="text-sm font-medium text-on-surface group-hover:text-primary transition-colors truncate">
                  Внести данные
                </p>
              </div>
              <span className="text-[11px] font-mono font-bold text-primary flex-shrink-0">
                {surveyPercent !== null ? `${surveyPercent}%` : '—'}
              </span>
            </div>
            <div
              className="h-1 bg-surface-container-high rounded-full overflow-hidden"
              role="progressbar"
              aria-valuenow={surveyPercent ?? undefined}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Прогресс заполнения анкеты"
            >
              <div
                className={`h-full ${progressColor(surveyPercent ?? 0)} rounded-full transition-all duration-700`}
                style={{ width: `${surveyPercent ?? 0}%` }}
              />
            </div>
            <p className="text-[10px] font-mono text-on-surface-variant mt-1.5">
              {onboarding
                ? `${onboarding.survey.completed_steps} / ${onboarding.survey.total_steps} шагов анкеты`
                : 'загружаем статус анкеты…'}
            </p>
          </Link>
        </div>

        <Link
          href={STORE_IMPORT_HREF}
          className="group bg-surface-container-low rounded-2xl border border-primary/15 hover:border-primary/40 p-4 transition-all flex items-center gap-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        >
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0 group-hover:bg-primary/20 transition-colors">
            <span className="material-symbols-outlined text-lg text-primary" aria-hidden="true">
              storefront
            </span>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-on-surface group-hover:text-primary transition-colors">
              Отчёт магазина
            </p>
            <p className="text-[10px] text-on-surface-variant font-mono mt-0.5">
              Месяцы, продажи, P&amp;L → статистика
            </p>
          </div>
          <span className="material-symbols-outlined text-base text-on-surface-variant group-hover:text-primary group-hover:translate-x-0.5 transition-all ml-auto flex-shrink-0" aria-hidden="true">
            arrow_forward
          </span>
        </Link>

        <Link
          href={DOCUMENTS_HREF}
          className="group bg-surface-container-low rounded-2xl border border-white/[0.04] hover:border-primary/30 p-4 transition-all flex items-center gap-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        >
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0 group-hover:bg-primary/20 transition-colors">
            <span
              className="material-symbols-outlined text-lg text-primary"
              aria-hidden="true"
            >
              cloud_upload
            </span>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-on-surface group-hover:text-primary transition-colors">
              Документы Точки А
            </p>
            <p className="text-[10px] text-on-surface-variant font-mono mt-0.5">
              Годовой P&amp;L, аудит, база клиентов
              {onboarding?.documents?.count
                ? ` · загружено ${onboarding.documents.count}`
                : ''}
            </p>
          </div>
          <span
            className="material-symbols-outlined text-base text-on-surface-variant group-hover:text-primary group-hover:translate-x-0.5 transition-all ml-auto flex-shrink-0"
            aria-hidden="true"
          >
            arrow_forward
          </span>
        </Link>
      </div>

      {/* Metric drill-down — «откуда взялась эта цифра» */}
      {explainProps && (
        <MetricExplainModal
          open={explain !== null}
          onClose={() => setExplain(null)}
          {...explainProps}
        />
      )}

      {/* GRI popup — radar widget shown via «Открыть результаты GRI» */}
      <GriRadarPopup
        open={griModalOpen && Boolean(griData)}
        data={griData}
        onClose={() => setGriModalOpen(false)}
      />
    </section>
  )
}

// ─── GRI radar popup ──────────────────────────────────────────────────────────
// Radix Dialog gives us the focus trap, focus restore, Escape and scroll lock
// the hand-rolled version was missing.
function GriRadarPopup({
  open,
  data,
  onClose,
}: {
  open: boolean
  data: GriAssessmentData | null
  onClose: () => void
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-black/75 backdrop-blur-md" />
        <Dialog.Content className="fixed inset-0 z-[101] flex items-start justify-center p-4 sm:p-6 md:p-10 overflow-y-auto">
          <div className="relative w-full max-w-3xl my-auto rounded-2xl bg-surface border border-white/[0.06] shadow-2xl">
            <Dialog.Title className="sr-only">Результаты GRI-диагностики</Dialog.Title>
            <Dialog.Description className="sr-only">
              Оценка готовности к росту по 7 блокам. Каждый блок раскрывается в
              разбор по критериям.
            </Dialog.Description>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Закрыть"
                className="absolute top-3 right-3 z-20 w-9 h-9 rounded-xl bg-surface-container border border-white/[0.06] text-on-surface-variant hover:text-on-surface hover:border-primary/30 flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
              >
                <span className="material-symbols-outlined text-base" aria-hidden="true">
                  close
                </span>
              </button>
            </Dialog.Close>
            <div className="p-4 sm:p-5 pt-12">
              {data && <GRIAssessmentRadarWidget data={data} />}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
