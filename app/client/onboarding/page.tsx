'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Image from 'next/image'
import Link from 'next/link'
import { TOTAL_STEPS, STEPS } from '@/components/onboarding/constants/step-config'

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

  // Bootstrap: load from localStorage → server
  useEffect(() => {
    const bootstrap = async () => {
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        setUserId(user?.id ?? null)

        // Redirect medical-vertical users to their 8-field clinic intake —
        // the generic 12-step wizard doesn't fit the clinic flow.
        if (user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('vertical')
            .eq('id', user.id)
            .maybeSingle()
          if (profile?.vertical === 'medical') {
            router.replace('/client/onboarding-medical')
            return
          }
        }

        // 1. Try localStorage
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw) {
          const data = JSON.parse(raw)
          const answers = data.answers ?? {}
          setSavedAnswers(answers)
          setStepData(answers)
          setCurrentStep(data.current_step ?? 1)
          setCompanyId(data.company_id ?? null)
          return
        }

        // 2. Load from server
        if (user?.id) {
          const [surveyRes, companyRes] = await Promise.all([
            fetch(`/api/v1/onboarding/survey?user_id=${user.id}`),
            fetch(`/api/v1/onboarding/company?user_id=${user.id}`),
          ])

          if (surveyRes.ok) {
            const surveyData = await surveyRes.json()
            if (surveyData.ok && surveyData.data) {
              const { answers: serverAnswers, completed_steps } = surveyData.data
              if (Object.keys(serverAnswers ?? {}).length > 0) {
                setSavedAnswers(serverAnswers)
                setStepData(serverAnswers)
                const lastStep = completed_steps?.length
                  ? Math.min(Math.max(...completed_steps) + 1, TOTAL_STEPS)
                  : 1
                setCurrentStep(lastStep)
              }
            }
          }
          if (companyRes.ok) {
            const companyData = await companyRes.json()
            if (companyData.ok && companyData.data?.id) setCompanyId(companyData.data.id)
          }
        }
      } catch { setUserId(null) }
    }
    bootstrap()
  }, [])

  const persistLocal = useCallback((step: number, answers: Record<string, unknown>) => {
    const merged = { ...savedAnswers, ...answers }
    setSavedAnswers(merged)
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      current_step: step, answers: merged, company_id: companyId, saved_at: new Date().toISOString(),
    }))
  }, [savedAnswers, companyId])

  const saveToServer = async (step: number, answers: Record<string, unknown>) => {
    if (!userId) return
    setIsSaving(true)
    try {
      // Step 1: also create/update company record
      if (step === 1) {
        const compRes = await fetch('/api/v1/onboarding/company', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: userId, name: answers['s1_company_name'], industry: answers['s1_industry'],
            stage: answers['s1_stage'], employee_count: answers['s1_employee_count'],
            founded_at: answers['s1_founded_at'], business_model: answers['s1_business_model'],
            regions: answers['s1_regions'], contact_name: answers['s1_contact_name'],
            contact_position: answers['s1_contact_position'], contact_phone: answers['s1_contact_phone'],
            contact_email: answers['s1_contact_email'],
          }),
        })
        const compData = await compRes.json()
        if (compData.ok && compData.data?.id) {
          setCompanyId(compData.data.id)
          localStorage.setItem(STORAGE_KEY, JSON.stringify({
            ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'), company_id: compData.data.id,
          }))
        }
      }

      // Save survey answers
      const formatted: Record<string, { value: unknown }> = {}
      for (const [k, v] of Object.entries(answers)) {
        formatted[k] = { value: v }
      }
      await fetch('/api/v1/onboarding/survey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, company_id: companyId, step, answers: formatted }),
      })
    } catch (e) {
      console.error('[onboarding] save error', e)
    } finally { setIsSaving(false) }
  }

  const handleFieldChange = (key: string, value: unknown) => {
    setStepData(prev => ({ ...prev, [key]: value }))
  }

  const goNext = async () => {
    persistLocal(currentStep, stepData)
    await saveToServer(currentStep, stepData)

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

  const goBack = () => setCurrentStep(s => Math.max(1, s - 1))
  const progress = Math.round(((currentStep - 1) / TOTAL_STEPS) * 100)
  const stepConfig = STEPS[currentStep - 1]
  const isLastStep = currentStep === TOTAL_STEPS
  const StepForm = STEP_FORMS[currentStep]

  return (
    <div className="min-h-screen bg-[#0c0e14] text-on-surface">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-[#0c0e14]/90 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/client/dashboard" className="flex items-center gap-2 group">
            <Image src="/images/logo.svg" alt="AIStart360" width={28} height={28} className="opacity-80 group-hover:opacity-100 transition-opacity" />
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
        {/* Step tabs (scrollable, all clickable) */}
        <div className="flex gap-1 overflow-x-auto pb-3 mb-6 scrollbar-hide">
          {STEPS.map((s, i) => {
            const stepN = i + 1
            const isActive = stepN === currentStep
            const isPast = stepN < currentStep
            return (
              <button
                key={stepN}
                onClick={() => {
                  // Save current step before switching
                  persistLocal(currentStep, stepData)
                  saveToServer(currentStep, stepData)
                  setCurrentStep(stepN)
                }}
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
        </div>

        {/* Step form */}
        <div className="mb-8">
          {StepForm && <StepForm data={stepData} onChange={handleFieldChange} userId={userId ?? undefined} />}
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
          <button onClick={goNext} disabled={isSaving}
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
