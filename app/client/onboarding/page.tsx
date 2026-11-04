'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Image from 'next/image'
import Link from 'next/link'
import { TOTAL_STEPS, STEPS } from '@/components/onboarding/constants/step-config'
import {
  mergeSurveyAnswerSources,
  normalizeSurveyAnswers,
  RETIRED_SURVEY_KEYS,
} from '@/components/onboarding/utils/answers'
import {
  sheetProjectionWarning,
  surveySaveError,
  type SurveySavePayload,
} from '@/components/onboarding/utils/save-response'
import InlineValidationHints from '@/components/assistant/InlineValidationHints'
import { getSectionByStep } from '@/lib/assistant/sections'

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

const STORAGE_KEY = 'aistart360_onboarding'

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

export default function OnboardingPage() {
  const router = useRouter()
  const [currentStep, setCurrentStep] = useState(1)
  const [savedAnswers, setSavedAnswers] = useState<Record<string, unknown>>({})
  const [stepData, setStepData] = useState<Record<string, unknown>>({})
  const [isSaving, setIsSaving] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [hasDocs, setHasDocs] = useState(false)
  const [isHydrating, setIsHydrating] = useState(true)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Bootstrap: load the local draft first, then merge server-prefilled answers
  // underneath it. Local/manual values win when both sources have the same key,
  // including an intentionally cleared field.
  useEffect(() => {
    let cancelled = false

    const bootstrap = async () => {
      let localAnswers: Record<string, unknown> = {}
      let localStep: number | null = null

      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw) {
          const draft = JSON.parse(raw) as {
            answers?: unknown
            current_step?: unknown
            company_id?: unknown
          }
          localAnswers = normalizeSurveyAnswers(draft.answers)
          const parsedStep = Number(draft.current_step)
          localStep = Number.isInteger(parsedStep)
            ? Math.min(TOTAL_STEPS, Math.max(1, parsedStep))
            : null

          if (!cancelled) {
            setSavedAnswers(localAnswers)
            setStepData((current) => ({ ...localAnswers, ...current }))
            if (localStep) setCurrentStep(localStep)
            setCompanyId(typeof draft.company_id === 'string' ? draft.company_id : null)
          }
        }

        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (cancelled) return
        setUserId(user?.id ?? null)

        // Note: medical-vertical users are NOT force-redirected to the short
        // clinic intake anymore — the full 12-step survey is available to
        // everyone, and the clinic form stays reachable as an optional link.

        // Check whether any documents are already uploaded (controls the
        // "Сформировать Точку А" early-exit button).
        if (user?.id) {
          fetch('/api/v1/onboarding/status', { credentials: 'include' })
            .then((r) => r.json())
            .then((j) => { if (j?.ok && j.data?.documents?.has_files) setHasDocs(true) })
            .catch(() => {})
        }

        // Always load the server snapshot: document extraction and other
        // backend prefill can add answers after the local draft was created.
        if (user?.id) {
          const [surveyRes, companyRes] = await Promise.all([
            fetch(`/api/v1/onboarding/survey?user_id=${user.id}`),
            fetch(`/api/v1/onboarding/company?user_id=${user.id}`),
          ])

          if (surveyRes.ok) {
            const surveyData = await surveyRes.json()
            if (surveyData.ok && surveyData.data) {
              const serverAnswers = normalizeSurveyAnswers(surveyData.data.answers)
              if (!cancelled && Object.keys(serverAnswers).length > 0) {
                const hydrated = mergeSurveyAnswerSources(serverAnswers, localAnswers)
                setSavedAnswers((current) => ({ ...hydrated, ...current }))
                // Preserve any edits made while the request was in flight.
                setStepData((current) => ({ ...hydrated, ...current }))
              }
              if (!cancelled && !localStep) {
                // Keep the start predictable for returning users while all step
                // tabs remain directly accessible.
                setCurrentStep(1)
              }
            }
          }
          if (companyRes.ok) {
            const companyData = await companyRes.json()
            if (!cancelled && companyData.ok && companyData.data?.id) {
              setCompanyId(companyData.data.id)
            }
          }
        }
      } catch {
        if (!cancelled) setUserId(null)
      } finally {
        if (!cancelled) setIsHydrating(false)
      }
    }
    bootstrap()
    return () => { cancelled = true }
  }, [])

  // Continuous autosave — persist the in-progress step to localStorage on every
  // change (debounced). Guarantees no data loss on step switch / refresh / loss of
  // connection. Writes localStorage directly (no setState) to avoid render loops.
  useEffect(() => {
    if (!Object.keys(stepData).length) return
    const id = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          current_step: currentStep,
          answers: { ...savedAnswers, ...stepData },
          company_id: companyId,
          saved_at: new Date().toISOString(),
        }))
      } catch { /* storage full / unavailable — ignore */ }
    }, 600)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepData, currentStep])

  const persistLocal = useCallback((step: number, answers: Record<string, unknown>) => {
    const merged = normalizeSurveyAnswers({ ...savedAnswers, ...answers })
    setSavedAnswers(merged)
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      current_step: step, answers: merged, company_id: companyId, saved_at: new Date().toISOString(),
    }))
  }, [savedAnswers, companyId])

  const saveToServer = async (
    step: number,
    answers: Record<string, unknown>,
  ): Promise<boolean> => {
    if (!userId) {
      setSaveError('Не удалось определить пользователя. Обновите страницу и войдите снова.')
      return false
    }
    setSaveError(null)
    setIsSaving(true)
    try {
      let resolvedCompanyId = companyId
      // Step 1: also create/update company record
      if (step === 1) {
        const compRes = await fetch('/api/v1/onboarding/company', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: userId, name: answers['s1_company_name'], industry: answers['s1_industry'],
            employee_count: answers['s1_employee_count'],
            founded_at: answers['s1_founded_at'],
            regions: answers['s1_regions'], contact_name: answers['s1_contact_name'],
            contact_position: answers['s1_contact_position'], contact_phone: answers['s1_contact_phone'],
            contact_email: answers['s1_contact_email'],
          }),
        })
        const compData = await compRes.json() as {
          ok?: boolean
          error?: string
          data?: { id?: string }
        }
        if (!compRes.ok || !compData.ok || !compData.data?.id) {
          throw new Error(compData.error || 'Не удалось сохранить данные компании')
        }
        resolvedCompanyId = compData.data.id
        setCompanyId(resolvedCompanyId)
        if (resolvedCompanyId) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({
            ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'),
            company_id: resolvedCompanyId,
          }))
        }
      }

      // Save survey answers
      const formatted: Record<string, { value: unknown }> = {}
      for (const [k, v] of Object.entries(answers)) {
        if (RETIRED_SURVEY_KEYS.has(k)) continue
        formatted[k] = { value: v }
      }
      const surveyRes = await fetch('/api/v1/onboarding/survey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          company_id: resolvedCompanyId,
          step,
          answers: formatted,
        }),
      })
      const surveyData = await surveyRes.json() as SurveySavePayload
      const saveFailure = surveySaveError(surveyRes.ok, surveyData)
      if (saveFailure) throw new Error(saveFailure)
      const sheetWarning = sheetProjectionWarning(surveyData)
      if (sheetWarning) {
        console.warn(
          '[onboarding] Google Sheets projection is not current',
          sheetWarning,
        )
      }
      return true
    } catch (e) {
      console.error('[onboarding] save error', e)
      setSaveError(
        e instanceof Error
          ? e.message
          : 'Не удалось сохранить ответы. Черновик остался на этом устройстве.',
      )
      return false
    } finally {
      setIsSaving(false)
    }
  }

  const handleFieldChange = (key: string, value: unknown) => {
    setStepData(prev => ({ ...prev, [key]: value }))
  }

  const goNext = async () => {
    persistLocal(currentStep, stepData)
    const saved = await saveToServer(currentStep, stepData)
    if (!saved) return

    if (currentStep < TOTAL_STEPS) {
      setCurrentStep(currentStep + 1)
    } else {
      // All 12 steps done → trigger diagnostics
      if (userId) {
        setIsSaving(true)
        try {
          await fetch('/api/v1/diagnostics/recalculate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId }),
          })
        } catch {}
        setIsSaving(false)
      }
      localStorage.removeItem(STORAGE_KEY)
      try {
        const statusRes = await fetch(`/api/client/status?userId=${userId}`)
        const statusData = await statusRes.json()
        router.push(statusData.status === 'approved' ? '/client/dashboard' : '/client/waiting-room')
      } catch { router.push('/client/dashboard') }
    }
  }

  // Early exit: form Точка А now and finish the survey later. Survey progress
  // stays in localStorage + server, so the user can come back any time.
  const finishEarly = async () => {
    persistLocal(currentStep, stepData)
    const saved = await saveToServer(currentStep, stepData)
    if (!saved) return
    if (userId) {
      setIsSaving(true)
      try {
        await fetch('/api/v1/diagnostics/recalculate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: userId }),
        })
      } catch {}
      setIsSaving(false)
    }
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
    (typeof stepData['s2n_goal_3y_what'] === 'string' && (stepData['s2n_goal_3y_what'] as string).trim()) ||
    (typeof savedAnswers['s2n_goal_12m_what'] === 'string' && (savedAnswers['s2n_goal_12m_what'] as string).trim()) ||
    (typeof savedAnswers['s2n_goal_3y_what'] === 'string' && (savedAnswers['s2n_goal_3y_what'] as string).trim())
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
                type="button"
                disabled={isHydrating || isSaving}
                onClick={async () => {
                  // Save current step before switching
                  persistLocal(currentStep, stepData)
                  const saved = await saveToServer(currentStep, stepData)
                  if (!saved) return
                  setCurrentStep(stepN)
                }}
                className={`
                  flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-mono whitespace-nowrap transition-all flex-shrink-0 cursor-pointer disabled:cursor-wait disabled:opacity-50
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

        {/* Step form */}
        <div className="mb-8">
          {isHydrating ? (
            <div
              className="flex items-center justify-center gap-2 rounded-2xl border border-white/[0.04] bg-surface-container-low px-4 py-12 text-sm text-on-surface-variant"
              role="status"
              aria-live="polite"
            >
              <span className="material-symbols-outlined animate-spin text-lg text-primary">
                progress_activity
              </span>
              Загружаем сохранённые ответы…
            </div>
          ) : (
            StepForm && <StepForm data={stepData} onChange={handleFieldChange} userId={userId ?? undefined} />
          )}

          {/* Inline validation hints — non-blocking, warns but never prevents navigation */}
          {!isHydrating && sectionId && (
            <div className="mt-5">
              <InlineValidationHints section={sectionId} draftAnswers={stepData} />
            </div>
          )}
        </div>

        {/* Navigation buttons */}
        {saveError && (
          <div
            role="alert"
            className="mb-4 flex items-start gap-2 rounded-xl border border-red-400/25 bg-red-400/[0.08] px-4 py-3 text-sm text-red-200"
          >
            <span className="material-symbols-outlined mt-0.5 text-base" aria-hidden="true">
              error
            </span>
            <div className="min-w-0">
              <p className="font-semibold">Не удалось завершить сохранение</p>
              <p className="mt-0.5 text-xs text-red-100/80">{saveError}</p>
              <p className="mt-1 text-[10px] text-red-100/60">
                Ваш черновик сохранён локально и не потеряется после обновления страницы.
              </p>
            </div>
          </div>
        )}
        <div className="flex items-center gap-3 pb-8">
          {currentStep > 1 && (
            <button onClick={goBack} disabled={isHydrating || isSaving}
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl border border-white/[0.08] text-on-surface-variant text-sm hover:bg-white/[0.04] transition-colors disabled:cursor-wait disabled:opacity-50">
              <span className="material-symbols-outlined text-base">arrow_back</span>
              Назад
            </button>
          )}
          <button onClick={goNext} disabled={isHydrating || isSaving}
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
