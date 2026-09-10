'use client'

import { Suspense, useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Image from 'next/image'
import Link from 'next/link'
import { TOTAL_STEPS, STEPS } from '@/components/onboarding/constants/step-config'
import InlineValidationHints from '@/components/assistant/InlineValidationHints'
import { getSectionByStep } from '@/lib/assistant/sections'
import { clearDraft, mergeServerAndDraft, parseStepParam, readDraft, writeDraft } from '@/lib/survey/draft'

// Step form components
import Step1CompanyForm from '@/components/onboarding/steps/Step1CompanyForm'
import Step2GoalsForm from '@/components/onboarding/steps/Step2GoalsForm'
import Step3PositioningForm from '@/components/onboarding/steps/Step3PositioningForm'
import Step4OrgStructureForm from '@/components/onboarding/steps/Step4OrgStructureForm'
import Step5ClientBaseForm from '@/components/onboarding/steps/Step5ClientBaseForm'
import Step6CJMForm from '@/components/onboarding/steps/Step6CJMForm'
import Step7MarketingForm from '@/components/onboarding/steps/Step7MarketingForm'
import Step8MetricsForm from '@/components/onboarding/steps/Step8MetricsForm'
import { Step9FinanceForm } from '@/components/onboarding/steps/Step9FinanceForm'
import Step10PersonalForm from '@/components/onboarding/steps/Step10PersonalForm'
import { Step11InfluenceForm } from '@/components/onboarding/steps/Step11InfluenceForm'
import Step12ToolsForm from '@/components/onboarding/steps/Step12ToolsForm'

// Step-1 fields mirrored into the `companies` row.
const COMPANY_FIELD_KEYS = new Set([
  's1_company_name', 's1_industry', 's1_employee_count', 's1_founded_at', 's1_business_model',
  's1_regions', 's1_contact_name', 's1_contact_position', 's1_contact_phone', 's1_contact_email',
])

// Map step number to component
const STEP_FORMS: Record<number, React.ComponentType<{ data: Record<string, unknown>; onChange: (key: string, value: unknown) => void; userId?: string }>> = {
  1: Step1CompanyForm,
  2: Step2GoalsForm,
  3: Step3PositioningForm,
  4: Step4OrgStructureForm,
  5: Step5ClientBaseForm,
  6: Step6CJMForm,
  7: Step7MarketingForm,
  8: Step8MetricsForm,
  9: Step9FinanceForm,
  10: Step10PersonalForm,
  11: Step11InfluenceForm,
  12: Step12ToolsForm,
}

function OnboardingPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [currentStep, setCurrentStep] = useState(1)
  // Full view of the answers: server copy + unsaved local edits on top.
  const [stepData, setStepData] = useState<Record<string, unknown>>({})
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [hasDocs, setHasDocs] = useState(false)

  // Refs mirror state for async save logic (no stale closures).
  const stepDataRef = useRef<Record<string, unknown>>({})
  const dirtyRef = useRef<Set<string>>(new Set())
  const saveChainRef = useRef<Promise<boolean>>(Promise.resolve(true))
  const userIdRef = useRef<string | null>(null)
  const companyIdRef = useRef<string | null>(null)
  const currentStepRef = useRef(1)
  useEffect(() => { stepDataRef.current = stepData }, [stepData])
  useEffect(() => { companyIdRef.current = companyId }, [companyId])
  useEffect(() => { currentStepRef.current = currentStep }, [currentStep])

  const persistDraft = useCallback(() => {
    const uid = userIdRef.current
    if (!uid || typeof window === 'undefined') return
    const dirty: Record<string, unknown> = {}
    for (const k of dirtyRef.current) dirty[k] = stepDataRef.current[k]
    if (Object.keys(dirty).length === 0) clearDraft(window.localStorage, uid)
    else writeDraft(window.localStorage, uid, currentStepRef.current, dirty)
  }, [])

  // Bootstrap: the SERVER is the source of truth; this user's unsaved local
  // edits (draft) are laid on top. `?step=N` opens a specific step.
  useEffect(() => {
    let cancelled = false
    const bootstrap = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }))
      if (cancelled) return
      const uid = user?.id ?? null
      userIdRef.current = uid
      setUserId(uid)
      if (!uid) {
        setSaveError('Сессия не найдена — войдите заново, иначе ответы не сохранятся.')
        setLoaded(true)
        return
      }

      fetch('/api/v1/onboarding/status', { credentials: 'include' })
        .then((r) => r.json())
        .then((j) => { if (!cancelled && j?.ok && j.data?.documents?.has_files) setHasDocs(true) })
        .catch(() => {})

      let server: Record<string, unknown> = {}
      try {
        const [surveyRes, companyRes] = await Promise.all([
          fetch('/api/v1/onboarding/survey', { credentials: 'include' }),
          fetch('/api/v1/onboarding/company', { credentials: 'include' }),
        ])
        const surveyJson = await surveyRes.json().catch(() => null)
        if (surveyRes.ok && surveyJson?.ok) server = surveyJson.data?.answers ?? {}
        else setSaveError('Не удалось загрузить сохранённые ответы. Обновите страницу, прежде чем продолжать.')
        const companyJson = await companyRes.json().catch(() => null)
        if (companyRes.ok && companyJson?.ok && companyJson.data?.id) setCompanyId(String(companyJson.data.id))
      } catch {
        setSaveError('Нет связи с сервером. Ответы сохраняются локально и отправятся при следующем «Далее».')
      }
      if (cancelled) return

      const draft = readDraft(window.localStorage, uid)
      const { answers, dirtyKeys } = mergeServerAndDraft(server, draft)
      dirtyRef.current = new Set(dirtyKeys)
      stepDataRef.current = answers
      setStepData(answers)
      const fromUrl = parseStepParam(searchParams.get('step'), TOTAL_STEPS)
      setCurrentStep(fromUrl ?? draft?.current_step ?? 1)
      setLoaded(true)
    }
    bootstrap()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Continuous local autosave of unsaved edits (debounced), flushed on unmount
  // and when the tab is hidden — nothing typed is lost on refresh / navigation.
  useEffect(() => {
    if (!loaded) return
    const id = setTimeout(persistDraft, 400)
    return () => clearTimeout(id)
  }, [stepData, currentStep, loaded, persistDraft])
  useEffect(() => {
    const flush = () => persistDraft()
    window.addEventListener('pagehide', flush)
    return () => { window.removeEventListener('pagehide', flush); flush() }
  }, [persistDraft])

  /**
   * Save unsaved edits. Resolves true only when the server confirmed.
   * Saves are serialized (a tab click during a save waits its turn) and send
   * ONLY changed keys, so values edited elsewhere are never overwritten.
   */
  const saveToServer = useCallback((step: number, opts: { final?: boolean } = {}): Promise<boolean> => {
    const run = async (): Promise<boolean> => {
      const uid = userIdRef.current
      if (!uid) {
        setSaveError('Сессия истекла — войдите заново. Ответы сохранены на этом устройстве.')
        return false
      }
      const keys = Array.from(dirtyRef.current)
      if (keys.length === 0 && !opts.final) return true // nothing changed → no network round-trip
      const snapshot: Record<string, unknown> = {}
      for (const k of keys) snapshot[k] = stepDataRef.current[k]

      setIsSaving(true)
      try {
        // Step-1 company fields also live in `companies`.
        if (keys.some((k) => COMPANY_FIELD_KEYS.has(k))) {
          const a = stepDataRef.current
          const compRes = await fetch('/api/v1/onboarding/company', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: a['s1_company_name'], industry: a['s1_industry'],
              employee_count: a['s1_employee_count'],
              founded_at: a['s1_founded_at'], business_model: a['s1_business_model'],
              regions: a['s1_regions'], contact_name: a['s1_contact_name'],
              contact_position: a['s1_contact_position'], contact_phone: a['s1_contact_phone'],
              contact_email: a['s1_contact_email'],
            }),
          })
          const compData = await compRes.json().catch(() => null)
          if (!compRes.ok || !compData?.ok) throw new Error(compData?.error || `HTTP ${compRes.status}`)
          if (compData.data?.id) {
            companyIdRef.current = String(compData.data.id)
            setCompanyId(String(compData.data.id))
          }
        }

        const formatted: Record<string, { value: unknown }> = {}
        for (const k of keys) formatted[k] = { value: snapshot[k] }
        const res = await fetch('/api/v1/onboarding/survey', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ company_id: companyIdRef.current, step, answers: formatted, final: opts.final === true }),
        })
        const json = await res.json().catch(() => null)
        if (res.status === 401) throw new Error('Сессия истекла — войдите заново. Ответы сохранены на этом устройстве.')
        if (!res.ok || !json?.ok) throw new Error(json?.error || `HTTP ${res.status}`)

        // Clear only the keys that did not change again while the request was in flight.
        for (const k of keys) {
          if (Object.is(stepDataRef.current[k], snapshot[k])) dirtyRef.current.delete(k)
        }
        persistDraft()
        setSaveError(null)
        return true
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setSaveError(msg.startsWith('Сессия') ? msg : `Не удалось сохранить ответы (${msg}). Проверьте соединение и нажмите ещё раз — введённое сохранено на этом устройстве.`)
        persistDraft()
        return false
      } finally {
        setIsSaving(false)
      }
    }
    const next = saveChainRef.current.then(run, run)
    saveChainRef.current = next
    return next
  }, [persistDraft])

  const handleFieldChange = (key: string, value: unknown) => {
    dirtyRef.current.add(key)
    setStepData(prev => ({ ...prev, [key]: value }))
  }

  const goToStep = async (target: number) => {
    if (isSaving || target === currentStep) return
    const ok = await saveToServer(currentStep)
    if (!ok) return
    setCurrentStep(target)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const goNext = async () => {
    if (isSaving) return
    const ok = await saveToServer(currentStep, { final: currentStep === TOTAL_STEPS })
    if (!ok) return // stay on the step; the error banner explains why

    if (currentStep < TOTAL_STEPS) {
      setCurrentStep(currentStep + 1)
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    // All 12 steps sent → trigger diagnostics
    setIsSaving(true)
    try {
      await fetch('/api/v1/diagnostics/recalculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userIdRef.current }),
      })
    } catch {}
    // Everything is confirmed on the server — the local draft is no longer needed.
    if (userIdRef.current) clearDraft(window.localStorage, userIdRef.current)
    try {
      const statusRes = await fetch(`/api/client/status?userId=${userIdRef.current}`)
      const statusData = await statusRes.json()
      router.push(statusData.status === 'approved' ? '/client/point-a' : '/client/waiting-room')
    } catch { router.push('/client/point-a') }
  }

  // Early exit: form Точка А now and finish the survey later.
  const finishEarly = async () => {
    if (isSaving) return
    const ok = await saveToServer(currentStep)
    if (!ok) return
    setIsSaving(true)
    try {
      await fetch('/api/v1/diagnostics/recalculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userIdRef.current }),
      })
    } catch {}
    router.push('/client/point-a')
  }

  const goBack = () => setCurrentStep(s => Math.max(1, s - 1))
  const progress = Math.round(((currentStep - 1) / TOTAL_STEPS) * 100)
  const stepConfig = STEPS[currentStep - 1]
  const isLastStep = currentStep === TOTAL_STEPS
  const StepForm = STEP_FORMS[currentStep]
  // Map the wizard step (1–12) to its assistant section id for inline hints.
  const sectionId = getSectionByStep(currentStep)?.id ?? null

  // The early-exit button appears once the user has something to form a
  // Точка А from: either a filled plan (goals on step 2) or uploaded files.
  const planFilled = Boolean(
    (typeof stepData['s2n_goal_12m_what'] === 'string' && (stepData['s2n_goal_12m_what'] as string).trim()) ||
    (typeof stepData['s2n_goal_3y_what'] === 'string' && (stepData['s2n_goal_3y_what'] as string).trim())
  )
  const canFinishEarly = !isLastStep && (planFilled || hasDocs)

  return (
    <div className="min-h-screen bg-[#0c0e14] text-on-surface">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-[#0c0e14]/90 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/client/dashboard" className="flex items-center gap-2 group">
            <Image src="/logo-icon.svg" alt="AIStart360" width={28} height={28} className="opacity-80 group-hover:opacity-100 transition-opacity" />
            <span className="text-sm font-bold text-on-surface/70 hidden sm:block">AIStart360</span>
          </Link>
          <span className="text-[10px] font-mono text-on-surface-variant">
            Шаг {currentStep} из {TOTAL_STEPS}
          </span>
        </div>

        {/* Progress bar */}
        <div className="h-0.5 bg-white/[0.04]">
          <div className="h-full bg-gradient-to-r from-primary to-[#00e29e] transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 md:py-10">
        {/* File upload — separate window, available from the very start */}
        <Link
          data-tour="onb-docs"
          href="/client/onboarding/documents"
          className="group flex items-center gap-3 mb-5 rounded-xl border border-primary/20 bg-primary/[0.06] hover:bg-primary/[0.1] px-4 py-3 transition-colors"
        >
          <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center flex-shrink-0">
            <span className="material-symbols-outlined text-primary text-lg">cloud_upload</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-on-surface">
              Загрузить файлы
              {hasDocs && (
                <span className="ml-2 text-[10px] font-mono text-primary align-middle">✓ загружено</span>
              )}
            </p>
            <p className="text-[11px] text-on-surface-variant">
              Отчёты, P&amp;L, база клиентов · xlsx, csv, pdf — в отдельном окне, можно в любой момент
            </p>
          </div>
          <span className="material-symbols-outlined text-on-surface-variant group-hover:text-primary group-hover:translate-x-0.5 transition-all flex-shrink-0">
            arrow_forward
          </span>
        </Link>

        {/* Step tabs — sticky under the header; wraps so ALL 12 step buttons stay
            visible at once (no horizontal scrolling). */}
        <div data-tour="onb-steps" className="sticky top-[54px] z-20 -mx-4 px-4 py-3 mb-6 bg-[#0c0e14]/95 backdrop-blur-xl border-b border-white/[0.06] flex flex-wrap gap-1.5">
          {STEPS.map((s, i) => {
            const stepN = i + 1
            const isActive = stepN === currentStep
            const isPast = stepN < currentStep
            return (
              <button
                key={stepN}
                onClick={() => { void goToStep(stepN) }}
                disabled={isSaving || !loaded}
                aria-current={isActive ? 'step' : undefined}
                className={`
                  flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-mono whitespace-nowrap transition-all flex-shrink-0 cursor-pointer
                  ${isActive ? 'bg-primary/15 text-primary border border-primary/20' :
                    isPast ? 'bg-white/[0.04] text-on-surface-variant hover:text-on-surface hover:bg-white/[0.06]' :
                    'bg-white/[0.02] text-on-surface-variant/60 hover:text-on-surface-variant hover:bg-white/[0.05]'}
                `}
              >
                <span className="material-symbols-outlined text-xs">{s.icon}</span>
                {s.title}
              </button>
            )
          })}
        </div>

        {/* Step header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <span className="material-symbols-outlined text-lg text-primary">{stepConfig?.icon ?? 'description'}</span>
            </div>
            <div>
              <p className="text-[10px] font-mono text-primary/60 uppercase tracking-[0.15em]">Шаг {currentStep}</p>
              <h1 className="text-xl font-bold text-on-surface">{stepConfig?.title ?? `Шаг ${currentStep}`}</h1>
            </div>
          </div>

          {/* Fill-in hint for this step */}
          {stepConfig?.hint && (
            <div className="flex items-start gap-2 rounded-lg border border-primary/15 bg-primary/[0.05] px-3 py-2">
              <span className="material-symbols-outlined text-sm text-primary/70 mt-0.5 flex-shrink-0">lightbulb</span>
              <p className="text-xs text-on-surface-variant leading-snug">{stepConfig.hint}</p>
            </div>
          )}
        </div>

        {saveError && (
          <div role="alert" className="mb-5 flex items-start gap-2 rounded-xl border border-error/30 bg-error/10 px-4 py-3">
            <span className="material-symbols-outlined text-base text-error mt-0.5 flex-shrink-0">error</span>
            <p className="text-xs text-on-surface leading-snug">{saveError}</p>
          </div>
        )}

        {/* Step form */}
        <div className="mb-8">
          {!loaded ? (
            <div className="rounded-2xl border border-white/[0.06] p-10 flex items-center justify-center">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
            </div>
          ) : (
            StepForm && <StepForm data={stepData} onChange={handleFieldChange} userId={userId ?? undefined} />
          )}

          {/* Inline validation hints — non-blocking, warns but never prevents navigation */}
          {sectionId && (
            <div className="mt-5">
              <InlineValidationHints section={sectionId} draftAnswers={stepData} />
            </div>
          )}
        </div>

        {/* Navigation buttons */}
        <div className="flex items-center gap-3 pb-8">
          {currentStep > 1 && (
            <button onClick={goBack}
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl border border-white/[0.08] text-on-surface-variant text-sm hover:bg-white/[0.04] transition-colors">
              <span className="material-symbols-outlined text-base">arrow_back</span>
              Назад
            </button>
          )}
          <button onClick={goNext} disabled={isSaving || !loaded}
            className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-primary to-[#00e29e] text-[#003824] font-bold text-sm hover:scale-[0.99] transition-all disabled:opacity-50">
            {isSaving ? (
              <><span className="material-symbols-outlined text-base animate-spin">progress_activity</span> Сохранение...</>
            ) : isLastStep ? (
              <><span className="material-symbols-outlined text-base">rocket_launch</span> Получить диагностику</>
            ) : (
              <><span className="material-symbols-outlined text-base">arrow_forward</span> Далее</>
            )}
          </button>
        </div>

        {/* Early exit — form Точка А now, finish the survey later */}
        {canFinishEarly && (
          <div className="mb-8 -mt-2">
            <button
              onClick={finishEarly}
              disabled={isSaving}
              className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl border border-primary/30 bg-primary/[0.06] text-primary font-semibold text-sm hover:bg-primary/[0.12] transition-colors disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-base">insights</span>
              Сформировать Точку А и перейти в кабинет
            </button>
            <p className="text-[10px] text-on-surface-variant/60 text-center mt-2">
              Анкета сохранится — её можно дозаполнить в любой момент.
            </p>
          </div>
        )}

        {/* Last step info */}
        {isLastStep && (
          <div className="bg-primary/5 border border-primary/10 rounded-xl p-4 text-center mb-8">
            <p className="text-xs text-primary/80">
              После отправки ИИ-агент проанализирует ваши данные и сформирует Точку А — объективную оценку текущего состояния бизнеса.
            </p>
          </div>
        )}

        {/* Consent */}
        <p className="text-[10px] text-on-surface-variant/40 text-center px-4">
          Я подтверждаю достоверность данных и даю согласие AIStart360 использовать их для бизнес-диагностики. Данные не передаются третьим лицам.
        </p>
      </main>
    </div>
  )
}

// useSearchParams (for the `?step=N` deep link) needs a Suspense boundary.
export default function OnboardingPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0c0e14]" />}>
      <OnboardingPageInner />
    </Suspense>
  )
}
