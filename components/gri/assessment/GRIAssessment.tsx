'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { GRI_SECTIONS, type SectionId } from '@/lib/gri-assessment/sections'

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

function AssessmentScale({
  value,
  onChange,
}: {
  value: number | null | undefined
  onChange: (v: number) => void
}) {
  return (
    <div className="grid grid-cols-10 gap-1.5 sm:gap-2">
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
        const active = value === n
        const tone =
          n <= 3
            ? 'red'
            : n <= 6
              ? 'yellow'
              : 'green'
        const activeClass =
          tone === 'red'
            ? 'bg-red-500 text-white border-red-400'
            : tone === 'yellow'
              ? 'bg-yellow-500 text-black border-yellow-400'
              : 'bg-emerald-500 text-black border-emerald-400'
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`h-10 sm:h-12 rounded-lg border text-sm font-bold transition-all ${
              active
                ? activeClass
                : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:border-white/20'
            }`}
          >
            {n}
          </button>
        )
      })}
    </div>
  )
}

function LossAversionBar({ sectionAvg }: { sectionAvg: number }) {
  const tone =
    sectionAvg >= 7
      ? { label: '✅ Сильная зона', text: 'text-emerald-300', bg: 'bg-emerald-500/10 border-emerald-500/30' }
      : sectionAvg >= 4
        ? { label: '⚠️ Зона риска', text: 'text-yellow-300', bg: 'bg-yellow-500/10 border-yellow-500/30' }
        : { label: '🚨 Критическая зона', text: 'text-red-300', bg: 'bg-red-500/10 border-red-500/30' }
  return (
    <div className={`mt-4 rounded-xl border px-4 py-3 ${tone.bg}`}>
      <div className={`text-xs font-bold uppercase tracking-wide ${tone.text}`}>{tone.label}</div>
      <div className="text-xs text-white/70 mt-1">
        Средний балл по разделу:{' '}
        <span className="font-bold text-white">{sectionAvg.toFixed(1)}</span>
      </div>
    </div>
  )
}

const DEMO_DATA = GRI_SECTIONS.map((s) => ({
  subject: s.shortTitle,
  score: 4.9,
  benchmark: 8,
}))

export default function GRIAssessment() {
  const [step, setStep] = useState<Step>({ kind: 'landing' })
  const [hydrated, setHydrated] = useState(false)
  const [state, setState] = useState<PersistedState>(DEFAULT_STATE)
  const [onboardingStep, setOnboardingStep] = useState(1)
  const [questionIndex, setQuestionIndex] = useState(0)
  const postedRef = useRef(false)

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

        // Reconstruct minimal per-criterion scores so sectionAvgsMemo + griIndex
        // resolve to the server values. Each section gets a single synthetic
        // criterion holding the section average.
        const synth: Record<string, Record<string, number>> = {}
        const completed: Record<string, boolean> = {}
        for (const sec of GRI_SECTIONS) {
          const v = sectionAvgs[sec.id]
          if (typeof v !== 'number' || v <= 0) continue
          const firstCrit = sec.criteria[0]?.id ?? 'avg'
          synth[sec.id] = { [firstCrit]: v }
          completed[sec.id] = true
        }
        if (Object.keys(synth).length === 0) return

        setState((prev) => ({
          ...prev,
          scores: { ...prev.scores, ...synth },
          completedSections: { ...prev.completedSections, ...completed },
          sectionAvgs,
          griIndex: typeof current.gri_index === 'number' ? current.gri_index : prev.griIndex,
        }))
        // If the server has a complete assessment, jump straight to results so
        // the chart matches what the dashboard widget displays.
        const allCovered = GRI_SECTIONS.every(
          (s) => typeof sectionAvgs[s.id] === 'number' && sectionAvgs[s.id] > 0,
        )
        if (allCovered) {
          // Defer so the state update above commits first.
          setTimeout(() => setStep({ kind: 'results' }), 0)
        }
      } catch {
        // server unreachable — local state is fine
      }
    })()
  }, [])

  useEffect(() => {
    if (!hydrated) return
    const avgs: Record<string, number> = {}
    GRI_SECTIONS.forEach((sec) => {
      const map = state.scores[sec.id] || {}
      const vals = sec.criteria
        .map((c) => map[c.id])
        .filter((v): v is number => typeof v === 'number')
      avgs[sec.id] = vals.length === 0 ? 0 : vals.reduce((a, b) => a + b, 0) / vals.length
    })
    const positive = Object.values(avgs).filter((v) => v > 0)
    const index = positive.length === 0
      ? 0
      : Math.round((positive.reduce((a, b) => a + b, 0) / positive.length) * 100) / 100
    saveState({ ...state, sectionAvgs: avgs, griIndex: index })
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('gri:assessment-updated'))
    }
  }, [state, hydrated])

  const setOnboarding = (patch: Partial<OnboardingForm>) =>
    setState((s) => ({ ...s, onboarding: { ...s.onboarding, ...patch } }))

  const setScore = (sectionId: SectionId, criterionId: string, score: number) =>
    setState((s) => ({
      ...s,
      scores: {
        ...s.scores,
        [sectionId]: { ...(s.scores[sectionId] || {}), [criterionId]: score },
      },
    }))

  const markCompleted = (sectionId: SectionId) =>
    setState((s) => ({
      ...s,
      completedSections: { ...s.completedSections, [sectionId]: true },
    }))

  const sectionAvg = (sectionId: SectionId) => {
    const section = GRI_SECTIONS.find((s) => s.id === sectionId)
    if (!section) return 0
    const scores = state.scores[sectionId] || {}
    const vals = section.criteria
      .map((c) => scores[c.id])
      .filter((v): v is number => typeof v === 'number')
    if (vals.length === 0) return 0
    return vals.reduce((a, b) => a + b, 0) / vals.length
  }

  const sectionAvgsMemo = useMemo(() => {
    const out: Record<string, number> = {}
    GRI_SECTIONS.forEach((sec) => {
      out[sec.id] = sectionAvg(sec.id)
    })
    return out
  }, [state.scores])

  const griIndex = useMemo(() => {
    const positive = Object.values(sectionAvgsMemo).filter((v) => v > 0)
    if (positive.length === 0) return 0
    return Math.round((positive.reduce((a, b) => a + b, 0) / positive.length) * 100) / 100
  }, [sectionAvgsMemo])

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
    return (
      <Shell>
        <div className="flex flex-col items-center justify-center text-center space-y-6 py-10">
          <div className="space-y-3 max-w-2xl">
            <div className="inline-block bg-teal-900/30 text-teal-300 text-[11px] font-bold px-3 py-1 rounded-full border border-teal-500/30">
              GRI ASSESSMENT
            </div>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
              Оцените готовность вашего бизнеса к масштабированию
            </h2>
            <p className="text-base text-white/60">
              Пройдите профессиональный GRI-тест из 7 блоков и получите детальный план роста до $2M+.
            </p>
          </div>
          <button
            onClick={() => setStep({ kind: 'onboarding' })}
            className="group inline-flex items-center justify-center gap-2 px-7 py-3.5 text-base font-bold text-black bg-white rounded-full hover:bg-teal-50 hover:scale-105 transition-all"
          >
            Начать оценку
            <svg className="w-4 h-4 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </button>
          <p className="text-xs text-white/40">Займёт около 15–20 минут</p>
        </div>

        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start mt-4">
          <div className="lg:col-span-1 space-y-5">
            <h3 className="text-xl font-bold text-white">Ваш GRI Индекс</h3>
            <p className="text-white/60 text-sm leading-relaxed">
              Growth Readiness Index (GRI) — скоринг готовности к масштабированию (0–10). Большинство имеют сильный продукт, но слабые операции.
            </p>
            <div className="p-4 bg-yellow-500/10 border-l-4 border-yellow-500/70 rounded-r-lg">
              <h4 className="font-bold text-yellow-200 text-sm">⚠️ Инсайт</h4>
              <p className="text-xs text-yellow-100/80 mt-1">
                Вы не можете масштабировать хаос. Сначала исправьте «красные зоны» (Operations).
              </p>
            </div>
            <div className="flex gap-6 pt-2">
              <div>
                <div className="text-3xl font-black text-white">4.9</div>
                <div className="text-[10px] text-white/40 uppercase font-bold">текущий GRI</div>
              </div>
              <div className="w-px bg-white/10 h-12" />
              <div>
                <div className="text-3xl font-black text-emerald-400">8.5+</div>
                <div className="text-[10px] text-white/40 uppercase font-bold">цель GRI</div>
              </div>
            </div>
          </div>
          <div className="lg:col-span-2 bg-white/[0.03] border border-white/10 rounded-2xl p-4 backdrop-blur-sm">
            <GriRadar data={DEMO_DATA} height={320} />
            <div className="text-center mt-1 text-[11px] text-white/40">
              Сравнение: <span className="text-blue-300 font-bold">Ваш бизнес</span> vs{' '}
              <span className="text-emerald-300 font-bold">Эталон $2M</span>
            </div>
          </div>
        </section>
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
        <div className="max-w-2xl mx-auto">
          <div className="mb-6">
            <div className="text-xs text-white/40 mb-2">Шаг {onboardingStep} из 3</div>
            <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-teal-500 transition-all duration-300"
                style={{ width: `${(onboardingStep / 3) * 100}%` }}
              />
            </div>
          </div>

          <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-6 sm:p-8 backdrop-blur-sm space-y-6">
            {onboardingStep === 1 && (
              <>
                <h3 className="text-2xl font-bold text-white">Давайте познакомимся</h3>
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
                <h3 className="text-2xl font-bold text-white">О вашем бизнесе</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
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
                  <h3 className="text-2xl font-bold text-white">Самооценка готовности</h3>
                  <p className="text-white/60 text-sm mt-1">Оцените готовность по 10-балльной шкале</p>
                </div>
                <ScoreRow
                  label="Готовность процессов к $2M?"
                  value={form.scoreProcess}
                  onChange={(v) => setOnboarding({ scoreProcess: v })}
                />
                <div className="border-t border-white/10 pt-5">
                  <ScoreRow
                    label="Готовность управлять бизнесом с оборотом $2M?"
                    value={form.scoreManagement}
                    onChange={(v) => setOnboarding({ scoreManagement: v })}
                  />
                </div>
                <div className="border-t border-white/10 pt-5">
                  <ScoreRow
                    label="Готовность команды к $2M?"
                    value={form.scoreTeam}
                    onChange={(v) => setOnboarding({ scoreTeam: v })}
                  />
                </div>
              </>
            )}

            <div className="flex justify-between gap-3 pt-2">
              <button
                onClick={back}
                className="px-5 py-2.5 rounded-full border border-white/15 text-white/70 hover:bg-white/5 text-sm transition"
              >
                ← Назад
              </button>
              <button
                onClick={next}
                className="bg-white text-black font-bold py-3 px-7 rounded-full hover:bg-teal-50 transition-all"
              >
                {onboardingStep === 3 ? 'Перейти к оценке →' : 'Далее →'}
              </button>
            </div>
          </div>
        </div>
      </Shell>
    )
  }

  // -------- Overview --------
  if (step.kind === 'overview') {
    const completedCount = GRI_SECTIONS.filter((s) => state.completedSections[s.id]).length
    return (
      <Shell>
        <div className="mb-8 text-center">
          <h3 className="text-2xl sm:text-3xl font-bold mb-2 text-teal-300">Оценка GRI Index</h3>
          <p className="text-white/60 max-w-xl mx-auto text-sm">
            Пройдите 7 блоков GRI Index и получите оценку готовности к росту $2M/год.
          </p>
          {completedCount > 0 && (
            <p className="text-xs text-white/40 mt-2">
              Завершено блоков: {completedCount} из {GRI_SECTIONS.length}
            </p>
          )}
        </div>
        <div className="grid gap-3">
          {GRI_SECTIONS.map((section, index) => {
            const isDone = !!state.completedSections[section.id]
            const avg = sectionAvg(section.id)
            return (
              <button
                key={section.id}
                onClick={() => {
                  setQuestionIndex(0)
                  setStep({ kind: 'section', sectionIndex: index })
                }}
                className="group bg-white/[0.03] border border-white/10 hover:border-teal-500/40 p-5 rounded-xl backdrop-blur-sm text-left transition-all"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1">
                    <div className="text-[10px] font-bold mb-1 uppercase tracking-wide text-teal-300">
                      Блок {index + 1}
                      {isDone && <span className="ml-2 text-emerald-400">✓ завершён</span>}
                    </div>
                    <h4 className="text-base sm:text-lg font-bold text-white group-hover:text-teal-200 transition-colors">
                      {section.title}
                    </h4>
                    <p className="text-white/50 text-xs mt-1">{section.description}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {isDone && (
                      <div className="text-right">
                        <div className="text-xl font-black text-white">{avg.toFixed(1)}</div>
                        <div className="text-[10px] text-white/40 uppercase">балл</div>
                      </div>
                    )}
                    <div className="h-9 w-9 flex items-center justify-center rounded-full bg-white/5 border border-white/10 group-hover:bg-teal-500 group-hover:text-black transition-all">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <button
            onClick={() => {
              setQuestionIndex(0)
              setStep({ kind: 'section', sectionIndex: 0 })
            }}
            className="inline-flex items-center gap-2 bg-teal-500 hover:bg-teal-400 text-black font-bold px-6 py-3 rounded-full shadow-lg hover:shadow-teal-500/40 transition-all"
          >
            {completedCount > 0 ? 'Продолжить' : 'Начать'} →
          </button>
          {completedCount === GRI_SECTIONS.length && (
            <button
              onClick={() => setStep({ kind: 'results' })}
              className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-black font-bold px-6 py-3 rounded-full transition-all"
            >
              🎯 Получить результаты
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
        <div className="mb-3 flex items-center justify-between gap-4 text-xs">
          <button
            onClick={() => setStep({ kind: 'overview' })}
            className="text-white/50 hover:text-white transition px-3 py-2 -mx-3 -my-2 min-h-[44px] inline-flex items-center"
          >
            ← К списку
          </button>
          <div className="font-bold text-teal-300 text-sm">
            Блок {sectionIndex + 1}: {section.shortTitle}
          </div>
          <div className="text-white/40">
            {safeIndex + 1} / {total}
          </div>
        </div>

        <div className="h-1.5 bg-white/10 rounded-full mb-5 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-teal-500 to-emerald-400 transition-all duration-300"
            style={{ width: `${((safeIndex + 1) / total) * 100}%` }}
          />
        </div>

        <div className="flex justify-center gap-1.5 mb-5">
          {section.criteria.map((c, idx) => (
            <button
              key={c.id}
              onClick={() => goToQuestion(idx)}
              aria-label={`Вопрос ${idx + 1}`}
              className="relative inline-flex items-center justify-center p-2.5 -m-2.5"
            >
              <span
                className={`block w-2.5 h-2.5 rounded-full transition-all ${
                  idx === safeIndex
                    ? 'bg-teal-400 scale-125'
                    : typeof scoreMap[c.id] === 'number'
                      ? 'bg-teal-500/50'
                      : 'bg-white/15'
                }`}
              />
            </button>
          ))}
        </div>

        <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-6 sm:p-8 backdrop-blur-sm">
          <h3 className="text-xl sm:text-2xl font-bold mb-2 text-white">{current.text}</h3>
          <p className="text-white/60 mb-5 text-sm">{current.description}</p>

          <AssessmentScale value={currentScore} onChange={handleScore} />

          <div className="flex justify-between mt-5 text-sm">
            <button
              onClick={() => goToQuestion(safeIndex - 1)}
              disabled={safeIndex === 0}
              className="text-white/60 hover:text-white disabled:opacity-30 transition px-3 py-2 -mx-3 -my-2 min-h-[44px] inline-flex items-center"
            >
              ← Предыдущий
            </button>
            <button
              onClick={() => goToQuestion(safeIndex + 1)}
              disabled={safeIndex >= total - 1}
              className="text-white/60 hover:text-white disabled:opacity-30 transition px-3 py-2 -mx-3 -my-2 min-h-[44px] inline-flex items-center"
            >
              Следующий →
            </button>
          </div>
        </div>

        {avg > 0 && <LossAversionBar sectionAvg={avg} />}

        {allAnswered && (
          <div className="mt-6 space-y-4">
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-5">
              <h4 className="font-bold text-emerald-300">✅ Раздел завершён</h4>
              <p className="text-white/70 text-sm mt-1">
                Средний балл: <span className="text-white font-bold">{avg.toFixed(1)}</span>
              </p>
            </div>
            <button
              onClick={handleNextSection}
              className="w-full bg-emerald-500 text-black font-bold py-3.5 rounded-full hover:bg-emerald-400 transition shadow-lg shadow-emerald-500/30"
            >
              {sectionIndex === GRI_SECTIONS.length - 1
                ? '🎯 Получить результаты'
                : 'Следующий раздел →'}
            </button>
          </div>
        )}
      </Shell>
    )
  }

  // -------- Results --------
  if (step.kind === 'results') {
    const chartData = GRI_SECTIONS.map((s) => ({
      subject: s.shortTitle,
      score: parseFloat(sectionAvg(s.id).toFixed(1)),
      benchmark: 8,
    }))
    const sectionResults = GRI_SECTIONS.map((s) => ({
      shortTitle: s.shortTitle,
      title: s.title,
      avg: sectionAvg(s.id),
    }))
    const allCriteriaScored: { sectionTitle: string; text: string; score: number }[] = []
    GRI_SECTIONS.forEach((sec) => {
      const map = state.scores[sec.id] || {}
      sec.criteria.forEach((c) => {
        if (typeof map[c.id] === 'number') {
          allCriteriaScored.push({ sectionTitle: sec.title, text: c.text, score: map[c.id]! })
        }
      })
    })
    const top5 = [...allCriteriaScored].sort((a, b) => a.score - b.score).slice(0, 5)

    const status =
      griIndex >= 8
        ? { color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30', label: '✅ Отличная готовность', desc: 'Бизнес готов к агрессивному росту.' }
        : griIndex >= 5
          ? { color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/30', label: '⚠️ Средняя готовность', desc: 'Есть риски. Исправьте красные зоны.' }
          : { color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/30', label: '🚨 Критическое состояние', desc: 'Масштабирование невозможно без изменений.' }

    return (
      <Shell>
        <div className="mb-8">
          <div className="inline-block bg-teal-900/30 text-teal-300 px-3 py-1 rounded-full text-[10px] font-bold mb-3 border border-teal-500/30">
            РЕЗУЛЬТАТ ГОТОВ
          </div>
          <h3 className="text-3xl sm:text-4xl font-bold mb-1 text-white">Ваш GRI Индекс</h3>
          <p className="text-white/60 text-sm max-w-xl">
            Теперь вы знаете свои сильные стороны и зоны роста.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-10">
          <div className="space-y-5">
            <div className="flex items-baseline gap-4">
              <span className={`text-6xl font-black ${status.color}`}>{griIndex.toFixed(1)}</span>
              <div className="text-xs text-white/40">
                <span className="text-teal-300 text-xl font-bold block">8.5+</span>
                ЦЕЛЬ
              </div>
            </div>
            <div className={`p-4 rounded-xl border ${status.bg}`}>
              <h4 className={`font-bold ${status.color}`}>{status.label}</h4>
              <p className="text-white/70 text-sm mt-1">{status.desc}</p>
            </div>
            <div className="space-y-1.5">
              {sectionResults.map((sec, idx) => (
                <div key={idx} className="flex items-center justify-between text-xs">
                  <span className="text-white/70">{sec.shortTitle}</span>
                  <div className="flex items-center gap-2">
                    <div className="w-20 h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          sec.avg >= 7
                            ? 'bg-emerald-500'
                            : sec.avg >= 4
                              ? 'bg-yellow-500'
                              : 'bg-red-500'
                        }`}
                        style={{ width: `${(sec.avg / 10) * 100}%` }}
                      />
                    </div>
                    <span className="font-bold w-6 text-white">{sec.avg.toFixed(1)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="lg:col-span-2 bg-white/[0.03] border border-white/10 rounded-2xl p-4">
            <GriRadar data={chartData} height={340} />
          </div>
        </div>

        {top5.length > 0 && (
          <div className="mb-10">
            <h4 className="text-lg font-bold mb-3 text-red-300">🔥 TOP-5 ограничений</h4>
            <div className="space-y-2.5">
              {top5.map((w, idx) => (
                <div
                  key={idx}
                  className="bg-white/[0.03] border border-red-500/20 p-4 rounded-xl flex items-center gap-4"
                >
                  <div className="w-8 h-8 flex items-center justify-center bg-red-500/15 text-red-300 font-bold rounded-lg text-sm">
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] text-white/40 uppercase">{w.sectionTitle}</div>
                    <div className="font-medium text-white text-sm truncate">{w.text}</div>
                  </div>
                  <div className="px-2.5 py-1 bg-red-500 text-white text-sm font-bold rounded">
                    {w.score}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="bg-gradient-to-br from-teal-900/40 to-black border border-teal-500/30 rounded-3xl p-7 text-center relative overflow-hidden">
          <h4 className="text-2xl font-bold mb-2 text-white">Получите план действий на 90 дней</h4>
          <p className="text-white/70 max-w-xl mx-auto mb-5 text-sm">
            Забронируйте разбор с экспертом и получите пошаговый план роста.
          </p>
          <a
            href="https://tidycal.com/istart/gtm"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center px-7 py-3 text-base font-bold text-black bg-teal-400 rounded-full hover:bg-teal-300 transition"
          >
            📅 Забронировать разбор
          </a>
        </div>

        <div className="mt-6 flex flex-wrap justify-center gap-3 text-sm">
          <button
            onClick={() => setStep({ kind: 'overview' })}
            className="text-white/60 hover:text-white transition px-3 py-2 min-h-[44px] inline-flex items-center"
          >
            ← Вернуться к списку
          </button>
          <span className="text-white/20 self-center">•</span>
          <button
            onClick={resetAll}
            className="text-white/60 hover:text-red-300 transition px-3 py-2 min-h-[44px] inline-flex items-center"
          >
            Пройти заново
          </button>
        </div>
      </Shell>
    )
  }

  return null
}

const inputClass =
  'w-full bg-black/40 border border-white/15 rounded-lg px-4 py-2.5 text-white text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition-all appearance-none'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-white/60 mb-1.5 uppercase tracking-wide">
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
      <label className="block text-sm font-medium text-white mb-3">{label}</label>
      <AssessmentScale value={value} onChange={onChange} />
    </div>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8 py-10">
      <div className="mb-6 flex items-center gap-3">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent to-white/15" />
        <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/40">
          GRI Assessment
        </div>
        <div className="h-px flex-1 bg-gradient-to-l from-transparent to-white/15" />
      </div>
      {children}
    </section>
  )
}
