'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { motion, useReducedMotion } from 'framer-motion'
import { GRI_SECTIONS, type SectionId } from '@/lib/gri-assessment/sections'
import { useEntitlements } from '@/hooks/useEntitlements'
import { UpgradeGate } from '@/components/access/UpgradeGate'
import { Modal } from '@/components/ui/Modal'
import GriBlockBreakdown from '../shared/GriBlockBreakdown'
import {
  BLOCK_RU,
  buildBlockRows,
  computeIndexFromRows,
  doneSectionsCount,
  firstUnansweredCriterionIndex,
  firstUnfinishedSectionIndex,
  GRI_TARGET,
  isSectionAnswered,
  isSectionDone,
  sectionIndexOf,
  type GriScoresMap,
} from '../shared/blocks'

const GriRadar = dynamic(() => import('./GriRadar'), {
  ssr: false,
  loading: () => (
    <div className="h-[360px] bg-white/[0.02] rounded-xl animate-pulse" />
  ),
})

type Step =
  | { kind: 'landing' }
  | { kind: 'onboarding' }
  | { kind: 'overview' }
  | { kind: 'section'; sectionIndex: number }
  | { kind: 'results' }

interface OnboardingForm {
  name: string
  phone: string
  email: string
  yearsOnMarket: string
  industry: string
  employees: string
  revenue: string
  mainPain: string
  scoreProcess: number | null
  scoreManagement: number | null
  scoreTeam: number | null
}

interface PersistedState {
  onboarding: OnboardingForm
  scores: Record<string, Record<string, number>>
  completedSections: Record<string, boolean>
  sectionAvgs?: Record<string, number>
  griIndex?: number
}

const LS_KEY = 'aistart_gri_assessment_v1'

const DEFAULT_ONBOARDING: OnboardingForm = {
  name: '',
  phone: '',
  email: '',
  yearsOnMarket: '',
  industry: '',
  employees: '',
  revenue: '',
  mainPain: '',
  scoreProcess: null,
  scoreManagement: null,
  scoreTeam: null,
}

const DEFAULT_STATE: PersistedState = {
  onboarding: DEFAULT_ONBOARDING,
  scores: {},
  completedSections: {},
}

function loadState(): PersistedState {
  if (typeof window === 'undefined') return DEFAULT_STATE
  try {
    const raw = window.localStorage.getItem(LS_KEY)
    if (!raw) return DEFAULT_STATE
    const parsed = JSON.parse(raw) as Partial<PersistedState>
    return {
      onboarding: { ...DEFAULT_ONBOARDING, ...(parsed.onboarding || {}) },
      scores: parsed.scores || {},
      completedSections: parsed.completedSections || {},
      sectionAvgs: parsed.sectionAvgs,
      griIndex: parsed.griIndex,
    }
  } catch {
    return DEFAULT_STATE
  }
}

function saveState(state: PersistedState) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(LS_KEY, JSON.stringify(state))
}

// Illustrative-only radar for the pre-test landing (clearly labelled
// "Пример профиля (иллюстрация)"). Varied per-section so it reads as a sample
// shape, not a flat/real profile a client might mistake for their own score.
const DEMO_SAMPLE_SCORES = [6.2, 4.1, 7.0, 3.4, 5.5, 4.8, 6.6]
const DEMO_DATA = GRI_SECTIONS.map((s, i) => ({
  subject: BLOCK_RU[s.id] ?? s.shortTitle,
  score: DEMO_SAMPLE_SCORES[i % DEMO_SAMPLE_SCORES.length],
  benchmark: GRI_TARGET,
}))

const VALUE_PROPS = [
  {
    icon: 'radar',
    title: 'Индекс по 7 блокам',
    text: 'Готовность к росту от 0 до 10 в каждой зоне бизнеса',
  },
  {
    icon: 'bolt',
    title: 'Топ-ограничения',
    text: '5 слабых точек, которые тормозят масштабирование',
  },
  {
    icon: 'calendar_month',
    title: 'План на 90 дней',
    text: 'Шаги по горизонтам 1–30 / 31–60 / 61–90 дней',
  },
]

const ONBOARDING_STEPS = ['Контакты', 'О бизнесе', 'Самооценка'] as const

// Подписи шкал самооценки из онбординга — те же три вопроса, что задаются на
// шаге 3; в результатах они сверяются с расчётным индексом.
const SELF_SCORE_LABELS = [
  { key: 'scoreProcess', label: 'Процессы готовы к $2M' },
  { key: 'scoreManagement', label: 'Вы готовы управлять бизнесом на $2M' },
  { key: 'scoreTeam', label: 'Команда готова к $2M' },
] as const

// ── Presentational helpers ─────────────────────────────────────────────

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/[0.06] px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-primary">
      {children}
    </span>
  )
}

function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode
  delay?: number
  className?: string
}) {
  const reduce = useReducedMotion()
  if (reduce) return <div className={className}>{children}</div>
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  )
}

// Circular GRI gauge for the results reward moment.
function IndexGauge({ value, reduce }: { value: number; reduce: boolean }) {
  const pct = Math.max(0, Math.min(100, (value / 10) * 100))
  const r = 52
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - pct / 100)
  const color = value >= 8 ? '#6effc0' : value >= 5 ? '#ffbd60' : '#ffb4ab'
  return (
    <div className="relative mx-auto h-40 w-40 sm:h-44 sm:w-44">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-full blur-2xl"
        style={{ background: `radial-gradient(circle, ${color}22, transparent 70%)` }}
      />
      <svg viewBox="0 0 128 128" className="relative h-full w-full -rotate-90">
        <circle cx="64" cy="64" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="9" />
        <motion.circle
          cx="64"
          cy="64"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={circ}
          initial={{ strokeDashoffset: reduce ? offset : circ }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: reduce ? 0 : 1.1, ease: 'easeOut' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-headline text-5xl font-black leading-none" style={{ color }}>
          {value.toFixed(1)}
        </span>
        <span className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-on-surface-variant">
          из 10
        </span>
      </div>
    </div>
  )
}

function AssessmentScale({
  value,
  onChange,
}: {
  value: number | null | undefined
  onChange: (v: number) => void
}) {
  return (
    <div>
      {/* UX-04: 5 columns on mobile so each tap target is >=44px wide (10-wide
          packs to ~29px on a phone); a single row of 10 on >=sm. */}
      <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-10 sm:gap-2">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
          const active = value === n
          const tone = n <= 3 ? 'red' : n <= 6 ? 'yellow' : 'green'
          const activeClass =
            tone === 'red'
              ? 'bg-red-400 text-[#3a0000] border-red-300'
              : tone === 'yellow'
                ? 'bg-amber-400 text-[#3a2600] border-amber-300'
                : 'bg-primary text-[#003824] border-primary'
          return (
            <button
              key={n}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(n)}
              className={`h-12 rounded-xl border text-sm font-bold transition-all active:scale-95 ${
                active
                  ? `${activeClass} shadow-lg`
                  : 'border-white/10 bg-white/[0.03] text-on-surface-variant hover:border-white/25 hover:bg-white/[0.06] hover:text-on-surface'
              }`}
            >
              {n}
            </button>
          )
        })}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
        <span>1 — слабо</span>
        <span>10 — сильно</span>
      </div>
    </div>
  )
}

function LossAversionBar({ sectionAvg }: { sectionAvg: number }) {
  const t =
    sectionAvg >= 7
      ? { label: 'Сильная зона', text: 'text-primary', bg: 'border-primary/25 bg-primary/[0.06]', dot: 'bg-primary' }
      : sectionAvg >= 4
        ? { label: 'Зона риска', text: 'text-amber-300', bg: 'border-amber-400/25 bg-amber-400/[0.06]', dot: 'bg-amber-400' }
        : { label: 'Критическая зона', text: 'text-red-300', bg: 'border-red-400/25 bg-red-400/[0.06]', dot: 'bg-red-400' }
  return (
    <div className={`mt-4 flex items-center gap-3 rounded-xl border px-4 py-3 ${t.bg}`}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${t.dot}`} />
      <div className="flex-1">
        <div className={`text-xs font-semibold ${t.text}`}>{t.label}</div>
        <div className="mt-0.5 text-xs text-on-surface-variant">
          Средний балл по разделу:{' '}
          <span className="font-semibold text-on-surface">{sectionAvg.toFixed(1)}</span>
        </div>
      </div>
    </div>
  )
}

export default function GRIAssessment({ initialBlockId }: { initialBlockId?: string | null } = {}) {
  const [step, setStep] = useState<Step>({ kind: 'landing' })
  // Фаза 6A: тарифный гейт повторного полного GRI (free = 1 демо-проход).
  // Пока access/me грузится или гейты выключены — всё открыто; сервер энфорсит сам.
  const { access } = useEntitlements()
  const [hydrated, setHydrated] = useState(false)
  const [state, setState] = useState<PersistedState>(DEFAULT_STATE)
  const [onboardingStep, setOnboardingStep] = useState(1)
  const [questionIndex, setQuestionIndex] = useState(0)
  const postedRef = useRef(false)
  const prefersReduced = useReducedMotion() ?? false

  useEffect(() => {
    const local = loadState()
    setState(local)
    setHydrated(true)

    // Sync from server (authoritative GRI assessment) so the results view
    // matches the dashboard widget. Only seeds when the user has nothing
    // locally — never overwrites work-in-progress.
    const hasLocalScores =
      Object.values(local.scores).some(
        (s) => s && Object.values(s).some((v) => typeof v === 'number' && v > 0),
      )
    if (hasLocalScores) return

    ;(async () => {
      try {
        const res = await fetch('/api/v1/gri/assessment', { credentials: 'include' })
        const j = await res.json()
        const current = j?.data?.current
        const sectionAvgs = current?.section_avgs as Record<string, number> | undefined
        if (!sectionAvgs) return

        // Покритериальные ответы лежат в той же строке (`scores`) — забираем их
        // как есть. Раньше здесь строился синтетический критерий (средний по
        // блоку записывался в первый критерий раздела), и дальше UI выдавал это
        // за оценку конкретного критерия: в TOP-5 и в план 90 дней попадали
        // критерии, которые пользователь не оценивал. Больше не выдумываем:
        // нет покритериальных данных — показываем только блочный уровень.
        const serverScores = (current?.scores ?? null) as GriScoresMap | null
        const cleanScores: GriScoresMap = {}
        if (serverScores && typeof serverScores === 'object') {
          for (const sec of GRI_SECTIONS) {
            const raw = serverScores[sec.id]
            if (!raw || typeof raw !== 'object') continue
            const kept: Record<string, number> = {}
            for (const crit of sec.criteria) {
              const v = Number(raw[crit.id])
              if (Number.isFinite(v) && v > 0) kept[crit.id] = v
            }
            if (Object.keys(kept).length > 0) cleanScores[sec.id] = kept
          }
        }

        const serverCompleted = (current?.completed_sections ?? null) as
          | Record<string, boolean>
          | null
        const completed: Record<string, boolean> = {}
        for (const sec of GRI_SECTIONS) {
          const avg = sectionAvgs[sec.id]
          // Пришли покритериальные ответы — блок «пройден» только когда отвечены
          // ВСЕ его вопросы. Иначе продолжение с места остановки перепрыгнуло бы
          // наполовину заполненный блок. Серверная отметка используется лишь
          // там, где покритериальных данных нет вовсе (старая запись).
          const done = cleanScores[sec.id]
            ? isSectionAnswered(sec.id, cleanScores)
            : !!serverCompleted?.[sec.id] || (typeof avg === 'number' && avg > 0)
          if (done) completed[sec.id] = true
        }
        if (Object.keys(completed).length === 0 && Object.keys(cleanScores).length === 0) return

        setState((prev) => ({
          ...prev,
          scores: { ...prev.scores, ...cleanScores },
          completedSections: { ...prev.completedSections, ...completed },
          sectionAvgs,
          griIndex: typeof current.gri_index === 'number' ? current.gri_index : prev.griIndex,
        }))
        // If the server has a complete assessment, jump straight to results so
        // the chart matches what the dashboard widget displays. Явный переход к
        // блоку (из разбора на вкладке «Результат») важнее — его не перебиваем.
        const allCovered = GRI_SECTIONS.every((s) => completed[s.id])
        if (allCovered && !initialBlockId) {
          // Defer so the state update above commits first.
          setTimeout(() => setStep({ kind: 'results' }), 0)
        }
      } catch {
        // server unreachable — local state is fine
      }
    })()
    // initialBlockId читается один раз при монтировании — отдельный эффект ниже
    // отрабатывает его изменения.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Единственный источник правды по блокам: ответы пользователя, а где их нет —
  // серверный средний по блоку (помечается avgSource:'block', разбор по
  // критериям для него честно не показывается).
  const blockRows = useMemo(
    () => buildBlockRows(state.scores, state.sectionAvgs),
    [state.scores, state.sectionAvgs],
  )

  const griIndex = useMemo(() => computeIndexFromRows(blockRows), [blockRows])

  useEffect(() => {
    if (!hydrated) return
    const avgs: Record<string, number> = {}
    blockRows.forEach((row) => {
      avgs[row.id] = row.avg ?? 0
    })
    saveState({ ...state, sectionAvgs: avgs, griIndex })
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('gri:assessment-updated'))
    }
  }, [state, hydrated, blockRows, griIndex])

  const setOnboarding = (patch: Partial<OnboardingForm>) =>
    setState((s) => ({ ...s, onboarding: { ...s.onboarding, ...patch } }))

  // Ответ на вопрос сам закрывает блок, когда отвечены все его вопросы. Раньше
  // блок засчитывался ТОЛЬКО кнопкой «Следующий раздел»: ответил на всё, ушёл
  // «К списку» — и прогресс навсегда висел на 6/7, а балл блока не показывался.
  const setScore = (sectionId: SectionId, criterionId: string, score: number) =>
    setState((s) => {
      const sectionScores = { ...(s.scores[sectionId] || {}), [criterionId]: score }
      const section = GRI_SECTIONS.find((x) => x.id === sectionId)
      const allAnswered = !!section && section.criteria.every((c) => typeof sectionScores[c.id] === 'number')
      return {
        ...s,
        scores: { ...s.scores, [sectionId]: sectionScores },
        completedSections: allAnswered
          ? { ...s.completedSections, [sectionId]: true }
          : s.completedSections,
      }
    })

  const markCompleted = (sectionId: SectionId) =>
    setState((s) => ({
      ...s,
      completedSections: { ...s.completedSections, [sectionId]: true },
    }))

  // Codex memoised the old per-section average + `sectionAvgsMemo` map; both
  // were superseded here by the single `blockRows` memo above (one pass, and it
  // already feeds griIndex, the radar and the summary), so there is nothing
  // left for that memo to serve.
  const sectionAvg = (sectionId: SectionId) =>
    blockRows.find((r) => r.id === sectionId)?.avg ?? 0

  // ── Место остановки ──────────────────────────────────────────────────────
  // Считается из самих ответов, а не хранится отдельным полем: переживает
  // перезагрузку, смену вкладки и приход данных с сервера.
  const doneCount = doneSectionsCount(state.scores, state.completedSections)
  const resumeSectionIndex = firstUnfinishedSectionIndex(state.scores, state.completedSections)
  const allSectionsDone = resumeSectionIndex === -1

  /** Открыть блок на первом неотвеченном вопросе (пройденный — на первом). */
  const openSection = useCallback(
    (sectionIndex: number) => {
      const section = GRI_SECTIONS[sectionIndex]
      if (!section) return
      setQuestionIndex(firstUnansweredCriterionIndex(section.id, state.scores))
      setStep({ kind: 'section', sectionIndex })
    },
    [state.scores],
  )

  /** Продолжить с места остановки; всё пройдено — сразу результаты. */
  const resume = useCallback(() => {
    if (resumeSectionIndex === -1) setStep({ kind: 'results' })
    else openSection(resumeSectionIndex)
  }, [resumeSectionIndex, openSection])

  // Переход к конкретному блоку из разбора на вкладке «Результат».
  const consumedBlockRef = useRef<string | null>(null)
  useEffect(() => {
    if (!hydrated || !initialBlockId) return
    if (consumedBlockRef.current === initialBlockId) return
    const idx = sectionIndexOf(initialBlockId)
    if (idx === -1) return
    consumedBlockRef.current = initialBlockId
    openSection(idx)
  }, [hydrated, initialBlockId, openSection])

  const resetAll = () => {
    setState(DEFAULT_STATE)
    setOnboardingStep(1)
    setQuestionIndex(0)
    setStep({ kind: 'landing' })
    postedRef.current = false
  }

  // ── Persist on completion (one-shot) ──
  useEffect(() => {
    if (step.kind !== 'results') return
    if (postedRef.current) return
    if (!(griIndex > 0)) return
    const allDone = GRI_SECTIONS.every((s) => state.completedSections[s.id])
    if (!allDone) return
    postedRef.current = true

    const body = {
      onboarding: state.onboarding,
      scores: state.scores,
      completedSections: state.completedSections,
    }
    ;(async () => {
      try {
        const res = await fetch('/api/v1/gri/assessment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (res.status === 401) {
          // anonymous user — silently skip
          return
        }
        if (!res.ok) {
          // eslint-disable-next-line no-console
          console.error('[gri-assessment] POST failed', res.status, await res.text().catch(() => ''))
          return
        }
        // Notify other listeners in the same tab (Calculator auto-sync)
        try {
          window.dispatchEvent(new CustomEvent('gri:assessment-updated'))
        } catch {
          // ignore
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[gri-assessment] POST error', err)
      }
    })()
  }, [step, griIndex, state.completedSections, state.scores, state.onboarding])

  // -------- Landing --------
  if (step.kind === 'landing') {
    // «Посмотреть результат» — только когда пройдены ВСЕ 7 блоков; частичный
    // прогресс (griIndex > 0 при 2/7 блоках) ведёт на «Продолжить диагностику»,
    // иначе незавершённый профиль выглядел бы как готовый результат.
    const hasResult = allSectionsDone && griIndex > 0
    const hasPartial = !allSectionsDone && (griIndex > 0 || doneCount > 0)
    const resumeSection = resumeSectionIndex >= 0 ? GRI_SECTIONS[resumeSectionIndex] : null
    const resumeQuestion = resumeSection
      ? firstUnansweredCriterionIndex(resumeSection.id, state.scores) + 1
      : 1
    return (
      <Shell>
        <div className="grid items-center gap-8 lg:grid-cols-[1.05fr_0.95fr]">
          {/* Left — hero copy */}
          <Reveal className="space-y-6">
            <Eyebrow>
              <span className="material-symbols-outlined text-[13px]" aria-hidden>
                verified
              </span>
              GRI · Growth Readiness Index
            </Eyebrow>
            <h2 className="font-headline text-3xl font-black leading-[1.1] tracking-tight text-on-surface sm:text-[2.7rem]">
              Насколько ваш бизнес{' '}
              <span className="text-primary">готов к масштабированию</span>
            </h2>
            <p className="max-w-xl text-base leading-relaxed text-on-surface-variant">
              Пройдите точную диагностику из 7 блоков — и получите ваш индекс
              готовности, главные ограничения и пошаговый план роста до $2M+.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              {hasResult ? (
                <>
                  <button
                    onClick={() => setStep({ kind: 'results' })}
                    className="group inline-flex items-center justify-center gap-2 rounded-full bg-primary px-7 py-3.5 text-base font-bold text-[#003824] shadow-primary-md transition-all hover:bg-primary/90 active:scale-[0.98]"
                  >
                    <span className="material-symbols-outlined text-[18px]" aria-hidden>insights</span>
                    Посмотреть результат
                  </button>
                  {access.canRunFullGri ? (
                    <button
                      onClick={() => {
                        resetAll()
                        setStep({ kind: 'onboarding' })
                      }}
                      className="inline-flex items-center gap-2 rounded-full border border-white/[0.12] px-6 py-3.5 text-base font-semibold text-on-surface transition-all hover:border-primary/40 hover:bg-white/[0.03]"
                    >
                      <span className="material-symbols-outlined text-[18px]" aria-hidden>restart_alt</span>
                      Пройти заново
                    </button>
                  ) : (
                    <div className="w-full max-w-md">
                      <UpgradeGate feature="gri_full" compact />
                    </div>
                  )}
                </>
              ) : hasPartial ? (
                <>
                  {/* Продолжение — ровно с той точки, где остановились: блок и
                      вопрос выводятся из ответов, а не с нуля. */}
                  <button
                    onClick={resume}
                    aria-label={
                      resumeSection
                        ? `Продолжить диагностику: блок ${resumeSectionIndex + 1} «${BLOCK_RU[resumeSection.id]}», вопрос ${resumeQuestion}`
                        : 'Продолжить диагностику'
                    }
                    className="group inline-flex items-center justify-center gap-2 rounded-full bg-primary px-7 py-3.5 text-base font-bold text-[#003824] shadow-primary-md transition-all hover:bg-primary/90 active:scale-[0.98]"
                  >
                    Продолжить диагностику
                    <span className="material-symbols-outlined text-[18px] transition-transform group-hover:translate-x-0.5" aria-hidden>
                      arrow_forward
                    </span>
                  </button>
                  <button
                    onClick={() => setStep({ kind: 'overview' })}
                    className="inline-flex items-center gap-2 rounded-full border border-white/[0.12] px-6 py-3.5 text-base font-semibold text-on-surface transition-all hover:border-primary/40 hover:bg-white/[0.03]"
                  >
                    <span className="material-symbols-outlined text-[18px]" aria-hidden>list</span>
                    Список блоков
                  </button>
                  <button
                    onClick={() => {
                      resetAll()
                      setStep({ kind: 'onboarding' })
                    }}
                    className="inline-flex items-center gap-2 rounded-full px-4 py-3.5 text-sm font-semibold text-on-surface-variant transition-colors hover:text-red-300"
                  >
                    <span className="material-symbols-outlined text-[18px]" aria-hidden>restart_alt</span>
                    Начать заново
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setStep({ kind: 'onboarding' })}
                  className="group inline-flex items-center justify-center gap-2 rounded-full bg-primary px-7 py-3.5 text-base font-bold text-[#003824] shadow-primary-md transition-all hover:bg-primary/90 active:scale-[0.98]"
                >
                  Начать оценку
                  <span className="material-symbols-outlined text-[18px] transition-transform group-hover:translate-x-0.5" aria-hidden>
                    arrow_forward
                  </span>
                </button>
              )}
            </div>
            {hasPartial && resumeSection ? (
              <p className="flex items-center gap-1.5 font-mono text-xs text-primary/90">
                <span className="material-symbols-outlined text-[15px]" aria-hidden>
                  bookmark
                </span>
                Пройдено {doneCount} из {GRI_SECTIONS.length} блоков · продолжим с блока{' '}
                {resumeSectionIndex + 1} «{BLOCK_RU[resumeSection.id]}», вопрос {resumeQuestion}
              </p>
            ) : (
              <p className="flex items-center gap-1.5 font-mono text-xs text-on-surface-variant">
                <span className="material-symbols-outlined text-[15px]" aria-hidden>
                  schedule
                </span>
                ~15–20 минут · сохраняется автоматически
              </p>
            )}
          </Reveal>

          {/* Right — illustrative radar clearly marked as sample */}
          <Reveal delay={0.12}>
            <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
              <div
                aria-hidden
                className="pointer-events-none absolute -right-16 -top-16 h-52 w-52 rounded-full bg-primary/10 blur-[80px]"
              />
              <div className="mb-1 flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-on-surface-variant">
                  Как выглядит профиль
                </span>
                <span className="rounded-full border border-white/[0.1] bg-white/[0.03] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
                  пример
                </span>
              </div>
              <GriRadar data={DEMO_DATA} height={300} />
              <div className="mt-1 text-center font-mono text-[10px] text-on-surface-variant">
                Иллюстрация · ваш реальный профиль появится после теста
              </div>
            </div>
          </Reveal>
        </div>

        {/* Value strip — что вы получите */}
        <Reveal delay={0.18} className="mt-10">
          <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.22em] text-on-surface-variant">
            Что вы получите
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {VALUE_PROPS.map((v) => (
              <div
                key={v.title}
                className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 transition-colors hover:border-primary/25"
              >
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/[0.08] text-primary">
                  <span className="material-symbols-outlined text-[20px]" aria-hidden>
                    {v.icon}
                  </span>
                </span>
                <h3 className="mt-3 text-sm font-bold text-on-surface">{v.title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">{v.text}</p>
              </div>
            ))}
          </div>
        </Reveal>

        {/* Preview of the 7 blocks */}
        <Reveal delay={0.24} className="mt-8">
          <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.22em] text-on-surface-variant">
            7 блоков диагностики
          </div>
          <div className="flex flex-wrap gap-2">
            {GRI_SECTIONS.map((s, i) => (
              <span
                key={s.id}
                className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.02] px-3 py-1.5 text-xs text-on-surface"
              >
                <span className="font-mono text-[10px] font-bold text-primary">{i + 1}</span>
                {BLOCK_RU[s.id]}
              </span>
            ))}
          </div>
        </Reveal>
      </Shell>
    )
  }

  // -------- Onboarding --------
  if (step.kind === 'onboarding') {
    const form = state.onboarding
    const next = () => {
      if (onboardingStep < 3) {
        setOnboardingStep((s) => s + 1)
        return
      }
      setStep({ kind: 'overview' })
    }
    const back = () => {
      if (onboardingStep > 1) setOnboardingStep((s) => s - 1)
      else setStep({ kind: 'landing' })
    }
    return (
      <Shell>
        <div className="mx-auto max-w-2xl">
          {/* Step indicator */}
          <div className="mb-6">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-on-surface-variant">
                Шаг {onboardingStep} из 3
              </span>
              <span className="text-xs font-semibold text-primary">
                {ONBOARDING_STEPS[onboardingStep - 1]}
              </span>
            </div>
            <div className="flex gap-1.5">
              {ONBOARDING_STEPS.map((_, i) => (
                <div key={i} className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      i + 1 <= onboardingStep ? 'w-full bg-primary' : 'w-0'
                    }`}
                  />
                </div>
              ))}
            </div>
          </div>

          <Reveal
            key={onboardingStep}
            className="space-y-6 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 sm:p-8"
          >
            {onboardingStep === 1 && (
              <>
                <div>
                  <h3 className="font-headline text-2xl font-bold text-on-surface">Давайте познакомимся</h3>
                  <p className="mt-1 text-sm text-on-surface-variant">
                    Чтобы сохранить результат и прислать разбор.
                  </p>
                </div>
                <Field label="Как вас зовут?">
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setOnboarding({ name: e.target.value })}
                    className={inputClass}
                    placeholder="Иван Иванов"
                  />
                </Field>
                <Field label="Email">
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setOnboarding({ email: e.target.value })}
                    className={inputClass}
                    placeholder="ivan@example.com"
                  />
                </Field>
                <Field label="Телефон">
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={(e) => setOnboarding({ phone: e.target.value })}
                    className={inputClass}
                    placeholder="+7 (999) 000-00-00"
                  />
                </Field>
              </>
            )}

            {onboardingStep === 2 && (
              <>
                <h3 className="font-headline text-2xl font-bold text-on-surface">О вашем бизнесе</h3>
                <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                  <Field label="Отрасль">
                    <select
                      value={form.industry}
                      onChange={(e) => setOnboarding({ industry: e.target.value })}
                      className={inputClass}
                    >
                      <option value="">Выберите...</option>
                      <option value="it">IT / SaaS</option>
                      <option value="e-commerce">E-commerce</option>
                      <option value="services">Услуги</option>
                      <option value="manufacturing">Производство</option>
                      <option value="other">Другое</option>
                    </select>
                  </Field>
                  <Field label="Сотрудников">
                    <select
                      value={form.employees}
                      onChange={(e) => setOnboarding({ employees: e.target.value })}
                      className={inputClass}
                    >
                      <option value="">Выберите...</option>
                      <option value="1-5">1-5</option>
                      <option value="6-10">6-10</option>
                      <option value="11-20">11-20</option>
                      <option value="21-50">21-50</option>
                      <option value="51-100">51-100</option>
                      <option value="100+">100+</option>
                    </select>
                  </Field>
                  <Field label="Оборот (в месяц)">
                    <select
                      value={form.revenue}
                      onChange={(e) => setOnboarding({ revenue: e.target.value })}
                      className={inputClass}
                    >
                      <option value="">Выберите...</option>
                      <option value="<10k">До $10,000</option>
                      <option value="10k-50k">$10k – $50k</option>
                      <option value="50k-100k">$50k – $100k</option>
                      <option value="100k+">$100k+</option>
                    </select>
                  </Field>
                  <Field label="Лет на рынке">
                    <select
                      value={form.yearsOnMarket}
                      onChange={(e) => setOnboarding({ yearsOnMarket: e.target.value })}
                      className={inputClass}
                    >
                      <option value="">Выберите...</option>
                      <option value="0-1">0-1</option>
                      <option value="2-3">2-3</option>
                      <option value="4-5">4-5</option>
                      <option value="6-10">6-10</option>
                      <option value="10+">10+</option>
                    </select>
                  </Field>
                </div>
                <Field label="Главная боль">
                  <textarea
                    rows={3}
                    value={form.mainPain}
                    onChange={(e) => setOnboarding({ mainPain: e.target.value })}
                    className={inputClass}
                    placeholder="Опишите главную проблему вашего бизнеса"
                  />
                </Field>
              </>
            )}

            {onboardingStep === 3 && (
              <>
                <div>
                  <h3 className="font-headline text-2xl font-bold text-on-surface">Самооценка готовности</h3>
                  <p className="mt-1 text-sm text-on-surface-variant">Оцените готовность по 10-балльной шкале</p>
                </div>
                <ScoreRow
                  label="Готовность процессов к $2M?"
                  value={form.scoreProcess}
                  onChange={(v) => setOnboarding({ scoreProcess: v })}
                />
                <div className="border-t border-white/[0.08] pt-5">
                  <ScoreRow
                    label="Готовность управлять бизнесом с оборотом $2M?"
                    value={form.scoreManagement}
                    onChange={(v) => setOnboarding({ scoreManagement: v })}
                  />
                </div>
                <div className="border-t border-white/[0.08] pt-5">
                  <ScoreRow
                    label="Готовность команды к $2M?"
                    value={form.scoreTeam}
                    onChange={(v) => setOnboarding({ scoreTeam: v })}
                  />
                </div>
              </>
            )}

            <div className="flex items-center justify-between gap-3 pt-2">
              <button
                onClick={back}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.12] px-5 py-3 text-sm font-medium text-on-surface-variant transition hover:bg-white/[0.04] hover:text-on-surface"
              >
                <span className="material-symbols-outlined text-[16px]" aria-hidden>arrow_back</span>
                Назад
              </button>
              <button
                onClick={next}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary px-7 py-3 text-sm font-bold text-[#003824] transition-all hover:bg-primary/90 active:scale-[0.98]"
              >
                {onboardingStep === 3 ? 'Перейти к оценке' : 'Далее'}
                <span className="material-symbols-outlined text-[16px]" aria-hidden>arrow_forward</span>
              </button>
            </div>
          </Reveal>
        </div>
      </Shell>
    )
  }

  // -------- Overview --------
  if (step.kind === 'overview') {
    const completedCount = doneCount
    const resumeSection = resumeSectionIndex >= 0 ? GRI_SECTIONS[resumeSectionIndex] : null
    return (
      <Shell>
        <Reveal className="mb-6 text-center">
          <Eyebrow>Оценка · 7 блоков</Eyebrow>
          <h3 className="mt-3 font-headline text-2xl font-bold text-on-surface sm:text-3xl">
            Пройдите блоки GRI Index
          </h3>
          <p className="mx-auto mt-2 max-w-xl text-sm text-on-surface-variant">
            Оцените каждый блок — и получите индекс готовности к росту до $2M/год.
          </p>
          <div
            className="mx-auto mt-4 flex max-w-sm items-center gap-3"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={GRI_SECTIONS.length}
            aria-valuenow={completedCount}
            aria-valuetext={`Пройдено ${completedCount} из ${GRI_SECTIONS.length} блоков`}
          >
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${(completedCount / GRI_SECTIONS.length) * 100}%` }}
              />
            </div>
            <span className="font-mono text-xs text-on-surface-variant">
              {completedCount}/{GRI_SECTIONS.length}
            </span>
          </div>
        </Reveal>
        <div className="grid gap-3">
          {GRI_SECTIONS.map((section, index) => {
            const row = blockRows[index]
            const isDone = isSectionDone(section.id, state.scores, state.completedSections)
            // Начатый, но не законченный блок раньше выглядел как нетронутый:
            // балл показывался только у завершённых. Теперь видно «отвечено 3/8».
            const started = !isDone && row.answered > 0
            const stateLabel = isDone
              ? 'завершён'
              : started
                ? `начат, отвечено ${row.answered} из ${row.total}`
                : 'не начат'
            return (
              <button
                key={section.id}
                onClick={() => openSection(index)}
                aria-label={`Блок ${index + 1}: ${BLOCK_RU[section.id]}, ${stateLabel}${
                  row.avg != null ? `, средний балл ${row.avg.toFixed(1)} из 10` : ''
                }`}
                className="group rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 text-left transition-all hover:border-primary/35 hover:bg-white/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-wider text-primary">
                      <span aria-hidden>Блок {index + 1}</span>
                      {isDone ? (
                        <span className="inline-flex items-center gap-1 text-primary" aria-hidden>
                          <span className="material-symbols-outlined text-[13px]" aria-hidden>check_circle</span>
                          завершён
                        </span>
                      ) : started ? (
                        <span className="inline-flex items-center gap-1 text-amber-300" aria-hidden>
                          <span className="material-symbols-outlined text-[13px]" aria-hidden>pending</span>
                          отвечено {row.answered}/{row.total}
                        </span>
                      ) : null}
                    </div>
                    <h4 className="text-base font-bold text-on-surface transition-colors group-hover:text-primary sm:text-lg">
                      {BLOCK_RU[section.id]}
                    </h4>
                    <p className="mt-1 text-xs text-on-surface-variant">{section.description}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {row.avg != null && (
                      <div className="text-right" aria-hidden>
                        <div className="font-headline text-xl font-black text-on-surface">
                          {row.avg.toFixed(1)}
                        </div>
                        <div className="font-mono text-[10px] uppercase text-on-surface-variant">
                          {isDone ? 'балл' : 'пока'}
                        </div>
                      </div>
                    )}
                    <div className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.1] bg-white/[0.03] text-on-surface transition-all group-hover:bg-primary group-hover:text-[#003824]">
                      <span className="material-symbols-outlined text-[18px]" aria-hidden>chevron_right</span>
                    </div>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {/* «Продолжить» вело на первый блок независимо от прогресса — теперь
              открывает первый незавершённый блок на первом неотвеченном вопросе. */}
          {resumeSection ? (
            <button
              onClick={resume}
              aria-label={`Продолжить с блока ${resumeSectionIndex + 1} «${BLOCK_RU[resumeSection.id]}», вопрос ${
                firstUnansweredCriterionIndex(resumeSection.id, state.scores) + 1
              }`}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-bold text-[#003824] shadow-primary-md transition-all hover:bg-primary/90 active:scale-[0.98]"
            >
              {completedCount > 0 ? 'Продолжить' : 'Начать'}
              <span className="material-symbols-outlined text-[18px]" aria-hidden>arrow_forward</span>
            </button>
          ) : (
            <button
              onClick={() => setStep({ kind: 'results' })}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-bold text-[#003824] shadow-primary-md transition-all hover:bg-primary/90 active:scale-[0.98]"
            >
              <span className="material-symbols-outlined text-[18px]" aria-hidden>insights</span>
              Получить результаты
            </button>
          )}
        </div>
      </Shell>
    )
  }

  // -------- Section --------
  if (step.kind === 'section') {
    const sectionIndex = step.sectionIndex
    const section = GRI_SECTIONS[sectionIndex]
    if (!section) return null
    const scoreMap = state.scores[section.id] || {}
    const total = section.criteria.length
    const safeIndex = Math.min(questionIndex, total - 1)
    const current = section.criteria[safeIndex]
    const currentScore = scoreMap[current.id] ?? null
    const allAnswered = section.criteria.every((c) => typeof scoreMap[c.id] === 'number')
    const avg = sectionAvg(section.id)

    const goToQuestion = (idx: number) => {
      if (idx >= 0 && idx < total) setQuestionIndex(idx)
    }

    const handleScore = (val: number) => {
      setScore(section.id, current.id, val)
      window.setTimeout(() => {
        if (safeIndex < total - 1) setQuestionIndex(safeIndex + 1)
      }, 250)
    }

    const handleNextSection = () => {
      markCompleted(section.id)
      if (sectionIndex < GRI_SECTIONS.length - 1) {
        setQuestionIndex(0)
        setStep({ kind: 'section', sectionIndex: sectionIndex + 1 })
      } else {
        setStep({ kind: 'results' })
      }
    }

    return (
      <Shell>
        {/* Header row */}
        <div className="mb-4 flex items-center justify-between gap-4">
          <button
            onClick={() => setStep({ kind: 'overview' })}
            className="-mx-3 -my-2 inline-flex min-h-[44px] items-center gap-1.5 px-3 py-2 text-sm text-on-surface-variant transition hover:text-on-surface"
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden>arrow_back</span>
            К списку
          </button>
          <div className="text-right">
            <div className="font-mono text-[11px] uppercase tracking-wider text-on-surface-variant">
              Блок {sectionIndex + 1} из {GRI_SECTIONS.length}
            </div>
            <div className="text-sm font-bold text-primary">{BLOCK_RU[section.id]}</div>
          </div>
        </div>

        {/* Прогресс по 7 блокам — навигация, а не картинка. Раньше это был
            набор <div> внутри aria-hidden-контейнера: вернуться в пройденный
            блок можно было только через «К списку», а скринридер прогресса
            вообще не видел. Теперь каждый сегмент — кнопка с состоянием. */}
        <nav
          aria-label={`Прогресс по блокам: пройдено ${doneCount} из ${GRI_SECTIONS.length}`}
          className="mb-5"
        >
          <ul className="flex items-center gap-1.5">
            {GRI_SECTIONS.map((s, i) => {
              const row = blockRows[i]
              const done = isSectionDone(s.id, state.scores, state.completedSections)
              const isCurrent = i === sectionIndex
              const stateLabel = done
                ? `завершён, средний балл ${row.avg != null ? row.avg.toFixed(1) : '—'} из 10`
                : row.answered > 0
                  ? `отвечено ${row.answered} из ${row.total}`
                  : 'не начат'
              return (
                <li key={s.id} className="flex-1">
                  <button
                    type="button"
                    onClick={() => openSection(i)}
                    aria-current={isCurrent ? 'step' : undefined}
                    aria-label={`Блок ${i + 1}: ${BLOCK_RU[s.id]}, ${stateLabel}${
                      isCurrent ? ' — вы здесь' : ''
                    }`}
                    className="group -my-2 flex w-full items-center py-2 focus:outline-none"
                  >
                    <span className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08] transition-colors group-hover:bg-white/[0.16] group-focus-visible:ring-2 group-focus-visible:ring-primary/60">
                      <span
                        className={`block h-full rounded-full transition-all duration-500 ${
                          done
                            ? 'w-full bg-primary'
                            : isCurrent
                              ? 'w-full bg-primary/40'
                              : row.answered > 0
                                ? 'bg-amber-400/50'
                                : 'w-0'
                        }`}
                        style={
                          !done && !isCurrent && row.answered > 0
                            ? { width: `${(row.answered / row.total) * 100}%` }
                            : undefined
                        }
                      />
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>

        {/* Within-block question progress */}
        <div className="mb-3 flex items-center justify-between">
          <span className="font-mono text-[11px] uppercase tracking-wider text-on-surface-variant">
            Вопрос {safeIndex + 1} / {total}
          </span>
          <div className="flex gap-1.5">
            {section.criteria.map((c, idx) => {
              const answer = scoreMap[c.id]
              const answered = typeof answer === 'number'
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => goToQuestion(idx)}
                  aria-current={idx === safeIndex ? 'step' : undefined}
                  aria-label={`Вопрос ${idx + 1} из ${total}: ${
                    answered ? `ответ ${answer} из 10` : 'без ответа'
                  }${idx === safeIndex ? ' — вы здесь' : ''}`}
                  className="relative -m-2 inline-flex items-center justify-center rounded-full p-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                >
                  <span
                    className={`block h-2 w-2 rounded-full transition-all ${
                      idx === safeIndex
                        ? 'scale-125 bg-primary'
                        : answered
                          ? 'bg-primary/50'
                          : 'bg-white/15'
                    }`}
                  />
                </button>
              )
            })}
          </div>
        </div>

        {/* Question card — animates on question change */}
        <motion.div
          key={current.id}
          initial={prefersReduced ? false : { opacity: 0, x: 28 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: prefersReduced ? 0 : 0.32, ease: [0.22, 1, 0.36, 1] }}
          className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 sm:p-8"
        >
          <h3 className="mb-2 font-headline text-xl font-bold text-on-surface sm:text-2xl">{current.text}</h3>
          <p className="mb-6 text-sm leading-relaxed text-on-surface-variant">{current.description}</p>

          <AssessmentScale value={currentScore} onChange={handleScore} />

          <div className="mt-6 flex justify-between text-sm">
            <button
              onClick={() => goToQuestion(safeIndex - 1)}
              disabled={safeIndex === 0}
              className="-mx-3 -my-2 inline-flex min-h-[44px] items-center gap-1.5 px-3 py-2 text-on-surface-variant transition hover:text-on-surface disabled:opacity-30"
            >
              <span className="material-symbols-outlined text-[16px]" aria-hidden>arrow_back</span>
              Предыдущий
            </button>
            <button
              onClick={() => goToQuestion(safeIndex + 1)}
              disabled={safeIndex >= total - 1}
              className="-mx-3 -my-2 inline-flex min-h-[44px] items-center gap-1.5 px-3 py-2 text-on-surface-variant transition hover:text-on-surface disabled:opacity-30"
            >
              Следующий
              <span className="material-symbols-outlined text-[16px]" aria-hidden>arrow_forward</span>
            </button>
          </div>
        </motion.div>

        {avg > 0 && <LossAversionBar sectionAvg={avg} />}

        {allAnswered && (
          <Reveal className="mt-6 space-y-4">
            <div className="flex items-center gap-3 rounded-2xl border border-primary/25 bg-primary/[0.06] p-5">
              <span className="material-symbols-outlined text-primary" aria-hidden>task_alt</span>
              <p className="text-sm text-on-surface">
                Раздел завершён · средний балл{' '}
                <span className="font-bold text-on-surface">{avg.toFixed(1)}</span>
              </p>
            </div>
            <button
              onClick={handleNextSection}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3.5 text-sm font-bold text-[#003824] shadow-primary-md transition hover:bg-primary/90 active:scale-[0.99]"
            >
              {sectionIndex === GRI_SECTIONS.length - 1 ? (
                <>
                  <span className="material-symbols-outlined text-[18px]" aria-hidden>insights</span>
                  Получить результаты
                </>
              ) : (
                <>
                  Следующий раздел
                  <span className="material-symbols-outlined text-[18px]" aria-hidden>arrow_forward</span>
                </>
              )}
            </button>
          </Reveal>
        )}
      </Shell>
    )
  }

  // -------- Results --------
  if (step.kind === 'results') {
    // На радар попадают только блоки с ответами. Раньше непройденный блок
    // рисовался как честный 0 — выдуманный «критический» балл, которого
    // пользователь не ставил. Эталон — единая цель GRI, а не литерал 8.
    const scoredRows = blockRows.filter((r) => r.avg != null)
    const chartData = scoredRows.map((r) => ({
      subject: r.label,
      score: parseFloat(r.avg!.toFixed(1)),
      benchmark: GRI_TARGET,
    }))
    const allCriteriaScored: {
      sectionId: SectionId
      block: string
      text: string
      score: number
      improve: string
    }[] = []
    GRI_SECTIONS.forEach((sec) => {
      const map = state.scores[sec.id] || {}
      sec.criteria.forEach((c) => {
        if (typeof map[c.id] === 'number') {
          allCriteriaScored.push({
            sectionId: sec.id,
            block: BLOCK_RU[sec.id],
            text: c.text,
            score: map[c.id]!,
            improve: c.whatToImprove,
          })
        }
      })
    })
    const weakest = [...allCriteriaScored].sort((a, b) => a.score - b.score)
    const top5 = weakest.slice(0, 5)
    // Derived 90-day plan: the weakest criteria mapped onto three horizons, each
    // card carrying its concrete "что улучшить" action (from sections.ts). The
    // expert booking below still offers the fully tailored plan.
    const planHorizons = [
      { label: '1–30 дней', items: weakest.slice(0, 2) },
      { label: '31–60 дней', items: weakest.slice(2, 4) },
      { label: '61–90 дней', items: weakest.slice(4, 6) },
    ]

    const status =
      griIndex >= 8
        ? { text: 'text-primary', dot: 'bg-primary', chip: 'border-primary/25 bg-primary/[0.06]', label: 'Отличная готовность', desc: 'Бизнес готов к агрессивному росту — усиливайте лидирующие блоки.' }
        : griIndex >= 5
          ? { text: 'text-amber-300', dot: 'bg-amber-400', chip: 'border-amber-400/25 bg-amber-400/[0.06]', label: 'Средняя готовность', desc: 'Есть риски. Закройте красные зоны, прежде чем ускоряться.' }
          : { text: 'text-red-300', dot: 'bg-red-400', chip: 'border-red-400/25 bg-red-400/[0.06]', label: 'Критическое состояние', desc: 'Масштабирование невозможно без изменений в слабых блоках.' }

    return (
      <Shell>
        <Reveal className="mb-6">
          <Eyebrow>
            <span className="material-symbols-outlined text-[13px]" aria-hidden>celebration</span>
            Результат готов
          </Eyebrow>
          <h3 className="mt-3 font-headline text-3xl font-black text-on-surface sm:text-4xl">
            Ваш GRI-индекс
          </h3>
          <p className="mt-1 max-w-xl text-sm text-on-surface-variant">
            Теперь вы видите сильные стороны, зоны роста и с чего начать.
          </p>
        </Reveal>

        {/* Hero result card — gauge + status */}
        <Reveal delay={0.05}>
          <div className="relative mb-6 overflow-hidden rounded-3xl border border-white/[0.08] bg-white/[0.02] p-6 sm:p-8">
            <div
              aria-hidden
              className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-primary/10 blur-[90px]"
            />
            <div className="relative grid items-center gap-6 sm:grid-cols-[auto_1fr]">
              <IndexGauge value={griIndex} reduce={prefersReduced} />
              <div className="space-y-4 text-center sm:text-left">
                <div className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 ${status.chip}`}>
                  <span className={`h-2 w-2 rounded-full ${status.dot}`} />
                  <span className={`text-sm font-bold ${status.text}`}>{status.label}</span>
                </div>
                <p className="max-w-md text-sm leading-relaxed text-on-surface-variant">{status.desc}</p>
                <div className="flex items-center justify-center gap-6 sm:justify-start">
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
                      Ваш индекс
                    </div>
                    <div className={`font-headline text-2xl font-black ${status.text}`}>
                      {griIndex.toFixed(1)}
                    </div>
                  </div>
                  <div className="h-10 w-px bg-white/[0.1]" />
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
                      Цель
                    </div>
                    <div className="font-headline text-2xl font-black text-primary">{GRI_TARGET}+</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Reveal>

        {/* Radar + per-block averages */}
        <div className="mb-6 grid gap-5 lg:grid-cols-2">
          <Reveal delay={0.1} className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
            <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.2em] text-on-surface-variant">
              Профиль по блокам
            </div>
            {chartData.length >= 3 ? (
              <>
                <GriRadar data={chartData} height={320} />
                {scoredRows.length < GRI_SECTIONS.length && (
                  <p className="mt-1 text-center font-mono text-[10px] text-amber-300/90">
                    На графике {scoredRows.length} из {GRI_SECTIONS.length} блоков — остальные ещё не пройдены
                  </p>
                )}
              </>
            ) : (
              <div className="flex h-[320px] flex-col items-center justify-center gap-3 text-center">
                <span className="material-symbols-outlined text-[32px] text-on-surface-variant" aria-hidden>
                  radar
                </span>
                <p className="max-w-xs text-sm text-on-surface-variant">
                  Профиль строится минимум по трём блокам. Пройдено {scoredRows.length} из{' '}
                  {GRI_SECTIONS.length} — незаполненные блоки не рисуем нулями.
                </p>
                {resumeSectionIndex >= 0 && (
                  <button
                    type="button"
                    onClick={resume}
                    className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/[0.08] px-4 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/15"
                  >
                    Продолжить диагностику
                  </button>
                )}
              </div>
            )}
          </Reveal>
          {/* Полосы блоков раскрываются в критерии, из которых сложился балл. */}
          <Reveal delay={0.15} className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
            <GriBlockBreakdown
              rows={blockRows}
              onGoToBlock={(id) => openSection(sectionIndexOf(id))}
            />
          </Reveal>
        </div>

        {/* TOP-5 limitations */}
        {top5.length > 0 && (
          <Reveal delay={0.2} className="mb-6 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
            <div className="mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-red-300" aria-hidden>priority_high</span>
              <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-on-surface-variant">
                TOP-5 ограничений
              </span>
            </div>
            <ol className="space-y-2.5">
              {top5.map((w, idx) => (
                <li
                  key={`${w.sectionId}-${idx}`}
                  className="flex items-center gap-3 rounded-xl border border-red-400/15 bg-white/[0.02] p-3"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-red-400/15 text-sm font-bold text-red-300">
                    {idx + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-[10px] uppercase tracking-wide text-on-surface-variant">
                      {w.block}
                    </div>
                    <div className="truncate text-sm text-on-surface">{w.text}</div>
                  </div>
                  <span className="shrink-0 rounded bg-red-400/90 px-2 py-0.5 font-mono text-xs font-bold tabular-nums text-[#3a0000]">
                    {w.score}
                  </span>
                </li>
              ))}
            </ol>
          </Reveal>
        )}

        {/* 90-day plan */}
        {weakest.length > 0 && (
          <Reveal delay={0.25} className="mb-6 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
            <div className="mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-primary" aria-hidden>calendar_month</span>
              <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-on-surface-variant">
                План на 90 дней
              </span>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {planHorizons.map((h) => (
                <div key={h.label} className="space-y-2.5">
                  <div className="text-xs font-semibold text-primary">{h.label}</div>
                  {h.items.length === 0 ? (
                    <p className="text-xs text-on-surface-variant">—</p>
                  ) : (
                    h.items.map((it, i) => (
                      <div
                        key={`${h.label}-${i}`}
                        className="space-y-1.5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3"
                      >
                        <div className="text-sm leading-snug text-on-surface">{it.text}</div>
                        <div className="text-xs leading-snug text-on-surface-variant">{it.improve}</div>
                      </div>
                    ))
                  )}
                </div>
              ))}
            </div>
          </Reveal>
        )}

        {/* Booking CTA */}
        <div className="rounded-3xl border border-primary/25 bg-gradient-to-r from-primary/[0.1] to-transparent p-7 text-center">
          <h4 className="font-headline text-2xl font-bold text-on-surface">
            Разложим план на 90 дней с экспертом
          </h4>
          <p className="mx-auto mb-5 mt-2 max-w-xl text-sm text-on-surface-variant">
            Забронируйте разбор — расставим ограничения по шагам и приоритетам под ваш бизнес.
          </p>
          <a
            href="https://tidycal.com/istart/gtm"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full bg-primary px-7 py-3 text-base font-bold text-[#003824] transition hover:bg-primary/90"
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden>event</span>
            Забронировать разбор
          </a>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3 text-sm">
          <button
            onClick={() => setStep({ kind: 'overview' })}
            className="inline-flex min-h-[44px] items-center gap-1.5 px-3 py-2 text-on-surface-variant transition hover:text-on-surface"
          >
            <span className="material-symbols-outlined text-[16px]" aria-hidden>arrow_back</span>
            Вернуться к списку
          </button>
          <span className="self-center text-on-surface-variant/40">•</span>
          <button
            onClick={resetAll}
            className="inline-flex min-h-[44px] items-center gap-1.5 px-3 py-2 text-on-surface-variant transition hover:text-red-300"
          >
            <span className="material-symbols-outlined text-[16px]" aria-hidden>restart_alt</span>
            Пройти заново
          </button>
        </div>
      </Shell>
    )
  }

  return null
}

const inputClass =
  'w-full appearance-none rounded-xl border border-white/[0.12] bg-black/40 px-4 py-2.5 text-sm text-on-surface outline-none transition-all placeholder:text-on-surface-variant/60 focus:border-transparent focus:ring-2 focus:ring-primary'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block font-mono text-[11px] font-medium uppercase tracking-wide text-on-surface-variant">
        {label}
      </label>
      {children}
    </div>
  )
}

function ScoreRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: number | null
  onChange: (v: number) => void
}) {
  return (
    <div>
      <label className="mb-3 block text-sm font-medium text-on-surface">{label}</label>
      <AssessmentScale value={value} onChange={onChange} />
    </div>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <section className="relative mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-20 left-1/2 h-64 w-[36rem] max-w-full -translate-x-1/2 rounded-full bg-primary/[0.07] blur-[100px]" />
      </div>
      {children}
    </section>
  )
}
