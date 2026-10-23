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
import { overallFill, pointAMinimum, stepFillFromAnswers, stepTimeHint } from '@/lib/survey/progress'
import SurveyProgressHeader from '@/components/onboarding/SurveyProgressHeader'
import StepHeader from '@/components/onboarding/StepHeader'
import SurveyReview from '@/components/onboarding/SurveyReview'
import SaveStatusChip, { type SaveState } from '@/components/onboarding/SaveStatusChip'
import DocumentSuggestions from '@/components/onboarding/DocumentSuggestions'
import FieldIssueNote, { questionLabel } from '@/components/onboarding/FieldIssueNote'
import SurveyFieldLayer, { type EditorRequest } from '@/components/onboarding/SurveyFieldLayer'
import AnswerEditorModal, { type AnswerEditorTarget } from '@/components/onboarding/AnswerEditorModal'
import type { AnswerAttribution } from '@/lib/survey/attribution-label'
import { profanityRejection } from '@/lib/moderation/client'
import { toAnswerEnvelope } from '@/lib/survey/answer-value'

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

// /api/v1/onboarding/company body field → survey question key (for errors).
const COMPANY_BODY_TO_KEY: Record<string, string> = {
  name: 's1_company_name', industry: 's1_industry', regions: 's1_regions', business_model: 's1_business_model',
  contact_name: 's1_contact_name', contact_position: 's1_contact_position', contact_phone: 's1_contact_phone', contact_email: 's1_contact_email',
}

/** The server refused a text answer (e.g. profanity): show it next to the question. */
class FieldRejectedError extends Error {
  constructor(message: string, readonly field: string | null) {
    super(message)
  }
}

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

// After step 12 the wizard shows a review screen before the final submit.
const REVIEW_STEP = TOTAL_STEPS + 1
const AUTOSAVE_DELAY_MS = 2500
const RETRY_DELAYS_MS = [4000, 12000, 30000]
// Where a finished (or early-finished) survey lands.
const AFTER_SURVEY_PATH = '/client/home'

function OnboardingPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [currentStep, setCurrentStep] = useState(1)
  // Full view of the answers: server copy + unsaved local edits on top.
  const [stepData, setStepData] = useState<Record<string, unknown>>({})
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // A question the server refused (profanity): the note sits next to the field.
  const [fieldIssue, setFieldIssue] = useState<{ key: string; message: string } | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [hasDocs, setHasDocs] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // Who filled each answer (line under the field) and the open answer editor.
  const [attribution, setAttribution] = useState<Record<string, AnswerAttribution>>({})
  const [editor, setEditor] = useState<AnswerEditorTarget | null>(null)
  const retryAttemptRef = useRef(0)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const submittedRef = useRef(false)

  // Refs mirror state for async save logic (no stale closures).
  const stepDataRef = useRef<Record<string, unknown>>({})
  const dirtyRef = useRef<Set<string>>(new Set())
  // Keys whose value was accepted from a document (→ «ИИ (из документов)»).
  const originRef = useRef<Map<string, 'document'>>(new Map())
  // The last save failure, for the answer editor's own error line.
  const lastSaveErrorRef = useRef<string | null>(null)
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
        if (surveyRes.ok && surveyJson?.ok) {
          server = surveyJson.data?.answers ?? {}
          setAttribution(surveyJson.data?.attribution ?? {})
        }
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
      if (dirtyKeys.length) setSaveState('dirty')
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
  const saveToServer = useCallback((step: number, opts: { final?: boolean; autosave?: boolean } = {}): Promise<boolean> => {
    const run = async (): Promise<boolean> => {
      const uid = userIdRef.current
      if (!uid) {
        setSaveError('Сессия истекла — войдите заново. Ответы сохранены на этом устройстве.')
        return false
      }
      const keys = Array.from(dirtyRef.current)
      if (keys.length === 0 && !opts.final) return true // nothing changed → no network round-trip
      const quiet = opts.autosave === true
      const snapshot: Record<string, unknown> = {}
      for (const k of keys) snapshot[k] = stepDataRef.current[k]

      if (!quiet) setIsSaving(true)
      setSaveState('saving')
      try {
        // Step-1 company fields also live in `companies` (name is NOT NULL there,
        // so a background save waits until the name is typed).
        const hasCompanyName = typeof stepDataRef.current['s1_company_name'] === 'string' && (stepDataRef.current['s1_company_name'] as string).trim() !== ''
        if (keys.some((k) => COMPANY_FIELD_KEYS.has(k)) && (!quiet || hasCompanyName)) {
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
          const compRejected = profanityRejection(compData)
          if (compRejected) {
            const bodyField = compRejected.field?.split('.')[0] ?? ''
            throw new FieldRejectedError(compRejected.message, COMPANY_BODY_TO_KEY[bodyField] ?? null)
          }
          if (!compRes.ok || !compData?.ok) throw new Error(compData?.error || `HTTP ${compRes.status}`)
          if (compData.data?.id) {
            companyIdRef.current = String(compData.data.id)
            setCompanyId(String(compData.data.id))
          }
        }

        // «Не знаю» / «примерно» go as their own envelope, never nested in { value }.
        const formatted: Record<string, Record<string, unknown>> = {}
        for (const k of keys) formatted[k] = toAnswerEnvelope(snapshot[k])
        const origins: Record<string, 'document'> = {}
        for (const k of keys) if (originRef.current.get(k) === 'document') origins[k] = 'document'
        lastSaveErrorRef.current = null
        const res = await fetch('/api/v1/onboarding/survey', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            step: Math.min(step, TOTAL_STEPS), answers: formatted, final: opts.final === true, autosave: quiet,
            // The path of the answer (migration 134): the full questionnaire.
            via: 'full',
            ...(Object.keys(origins).length ? { origins } : {}),
          }),
        })
        const json = await res.json().catch(() => null)
        if (res.status === 401) throw new Error('Сессия истекла — войдите заново. Ответы сохранены на этом устройстве.')
        const rejected = profanityRejection(json)
        if (rejected) throw new FieldRejectedError(rejected.message, rejected.field)
        if (!res.ok || !json?.ok) throw new Error(json?.error || `HTTP ${res.status}`)

        // Clear only the keys that did not change again while the request was in flight.
        for (const k of keys) {
          if (Object.is(stepDataRef.current[k], snapshot[k])) {
            dirtyRef.current.delete(k)
            originRef.current.delete(k)
          }
        }
        const saved = json.data?.attribution as Record<string, AnswerAttribution> | undefined
        if (saved && Object.keys(saved).length) setAttribution((prev) => ({ ...prev, ...saved }))
        persistDraft()
        setSaveError(null)
        setFieldIssue(null)
        retryAttemptRef.current = 0
        setSavedAt(new Date())
        setSaveState(dirtyRef.current.size ? 'dirty' : 'saved')
        return true
      } catch (e) {
        lastSaveErrorRef.current = e instanceof Error ? e.message : String(e)
        if (e instanceof FieldRejectedError) {
          // Not a network problem: no retry. Shown even for a background save —
          // the answer stays in the form and in the local draft until fixed.
          const label = e.field ? questionLabel(e.field) : null
          setFieldIssue(e.field ? { key: e.field, message: e.message } : null)
          setSaveError(label ? `${e.message} Вопрос: «${label}».` : e.message)
          setSaveState('dirty')
          persistDraft()
          return false
        }
        const msg = e instanceof Error ? e.message : String(e)
        // A background save fails quietly: the chip shows it and a retry is scheduled.
        if (!quiet || msg.startsWith('Сессия')) {
          setSaveError(msg.startsWith('Сессия') ? msg : `Не удалось сохранить ответы (${msg}). Проверьте соединение и нажмите ещё раз — введённое сохранено на этом устройстве.`)
        }
        setSaveState('error')
        persistDraft()
        return false
      } finally {
        if (!quiet) setIsSaving(false)
      }
    }
    const next = saveChainRef.current.then(run, run)
    saveChainRef.current = next
    return next
  }, [persistDraft])

  // Server autosave: a pause in typing sends the changed keys. The server copy
  // is the source of truth; the local draft only bridges the gap until it lands.
  useEffect(() => {
    if (!loaded || submitting || dirtyRef.current.size === 0) return
    const id = setTimeout(() => { void saveToServer(currentStepRef.current, { autosave: true }) }, AUTOSAVE_DELAY_MS)
    return () => clearTimeout(id)
  }, [stepData, loaded, submitting, saveToServer])

  // Retry a failed save with backoff, and immediately when the network returns.
  useEffect(() => {
    if (saveState !== 'error') return
    const retry = () => { void saveToServer(currentStepRef.current, { autosave: true }) }
    const delay = RETRY_DELAYS_MS[Math.min(retryAttemptRef.current, RETRY_DELAYS_MS.length - 1)]
    retryAttemptRef.current += 1
    retryTimerRef.current = setTimeout(retry, delay)
    window.addEventListener('online', retry)
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
      window.removeEventListener('online', retry)
    }
  }, [saveState, saveToServer])

  // Closing the tab with unsent edits asks for confirmation (the local draft
  // still keeps them, but only on this device).
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current.size === 0 || submittedRef.current) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [])

  const handleFieldChange = (key: string, value: unknown) => {
    if (fieldIssue?.key === key) {
      setFieldIssue(null)
      setSaveError(null)
    }
    originRef.current.delete(key)
    dirtyRef.current.add(key)
    setSaveState((s) => (s === 'saving' ? s : 'dirty'))
    setStepData(prev => ({ ...prev, [key]: value }))
  }

  // A value accepted from a document: saved like a typed answer, attributed to the AI.
  const applySuggestion = (key: string, value: unknown) => {
    handleFieldChange(key, value)
    originRef.current.set(key, 'document')
  }

  // The answer editor (modal): a click on a text field opens it; «Сохранить»
  // goes through the same save path as the inline field.
  const openEditor = useCallback((req: EditorRequest) => {
    setEditor({ ...req, value: stepDataRef.current[req.key] ?? '' })
  }, [])
  const closeEditor = useCallback(() => setEditor(null), [])
  const saveFromEditor = async (key: string, value: string): Promise<{ ok: true } | { ok: false; error: string }> => {
    handleFieldChange(key, value)
    stepDataRef.current = { ...stepDataRef.current, [key]: value }
    const ok = await saveToServer(currentStepRef.current)
    if (ok) return { ok: true }
    const msg = lastSaveErrorRef.current
    return {
      ok: false,
      error: msg && /[а-яё]/i.test(msg) ? msg : 'Не удалось сохранить ответ. Проверьте соединение и попробуйте ещё раз — текст не потерян.',
    }
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
    const ok = await saveToServer(currentStep)
    if (!ok) return // stay on the step; the error banner explains why
    setCurrentStep(Math.min(currentStep + 1, REVIEW_STEP))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const recalcAndLeave = async (target: string) => {
    try {
      await fetch('/api/v1/diagnostics/recalculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userIdRef.current }),
      })
    } catch {}
    router.push(target)
  }

  // Final submit from the review screen. `submittedRef` makes it idempotent
  // against double clicks; the server announces completion only once anyway.
  const submitSurvey = async () => {
    if (submitting || submittedRef.current) return
    setSubmitting(true)
    const ok = await saveToServer(TOTAL_STEPS, { final: true })
    if (!ok) { setSubmitting(false); return }
    submittedRef.current = true
    // Everything is confirmed on the server — the local draft is no longer needed.
    if (userIdRef.current) clearDraft(window.localStorage, userIdRef.current)
    let target = AFTER_SURVEY_PATH
    try {
      const statusRes = await fetch(`/api/client/status?userId=${userIdRef.current}`)
      const statusData = await statusRes.json()
      if (statusData.status !== 'approved') target = '/client/waiting-room'
    } catch {}
    await recalcAndLeave(target)
  }

  // Early exit: form Точка А now and finish the survey later.
  const finishEarly = async () => {
    if (isSaving || submitting) return
    const ok = await saveToServer(currentStep)
    if (!ok) return
    setSubmitting(true)
    await recalcAndLeave(AFTER_SURVEY_PATH)
  }

  const goBack = () => { setCurrentStep(s => Math.max(1, s - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const isReview = currentStep === REVIEW_STEP
  // Progress = how much is actually filled, not which tab is open.
  const fill = stepFillFromAnswers(stepData)
  const overall = overallFill(fill)
  const progress = overall.percent
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
  const canFinishEarly = !isLastStep && !isReview && (planFilled || hasDocs)

  return (
    <div className="min-h-screen bg-[#0c0e14] text-on-surface">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-[#0c0e14]/90 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/client/dashboard" className="flex items-center gap-2 group">
            <Image src="/logo-icon.svg" alt="AIStart360" width={28} height={28} className="opacity-80 group-hover:opacity-100 transition-opacity" />
            <span className="text-sm font-bold text-on-surface/70 hidden sm:block">AIStart360</span>
          </Link>
          <div className="flex items-center gap-3">
            <SaveStatusChip state={saveState} savedAt={savedAt} />
            <span className="text-[10px] font-mono text-on-surface-variant whitespace-nowrap">
              {isReview ? 'Проверка' : `Шаг ${currentStep} из ${TOTAL_STEPS}`}
            </span>
          </div>
        </div>

        {/* Honest progress: «Минимум для Точки А» + «Глубина» (lib/survey/progress.ts) */}
        <SurveyProgressHeader answers={stepData} />
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
            const isFilled = fill[i]?.started === true
            return (
              <button
                key={stepN}
                onClick={() => { void goToStep(stepN) }}
                disabled={isSaving || submitting || !loaded}
                title={`${s.title}: заполнено ${fill[i]?.filled ?? 0} из ${fill[i]?.total ?? 0} · ${stepTimeHint(fill[i], s.minutes)}`}
                aria-current={isActive ? 'step' : undefined}
                className={`
                  flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-mono whitespace-nowrap transition-all flex-shrink-0 cursor-pointer
                  ${isActive ? 'bg-primary/15 text-primary border border-primary/20' :
                    isFilled ? 'bg-white/[0.04] text-on-surface-variant hover:text-on-surface hover:bg-white/[0.06]' :
                    'bg-white/[0.02] text-on-surface-variant/60 hover:text-on-surface-variant hover:bg-white/[0.05]'}
                `}
              >
                <span className={`material-symbols-outlined text-xs ${isFilled && !isActive ? 'text-primary/80' : ''}`}>{isFilled ? 'check_circle' : s.icon}</span>
                {s.title}
              </button>
            )
          })}
        </div>

        {/* Step header: title, time, hint, «Зачем спрашиваем → что получите» */}
        {!isReview && <StepHeader step={currentStep} config={stepConfig} fill={fill[currentStep - 1]} />}

        {saveError && (
          <div role="alert" className="mb-5 flex items-start gap-2 rounded-xl border border-error/30 bg-error/10 px-4 py-3">
            <span className="material-symbols-outlined text-base text-error mt-0.5 flex-shrink-0">error</span>
            <p className="text-xs text-on-surface leading-snug">{saveError}</p>
          </div>
        )}
        {fieldIssue && !isReview && <FieldIssueNote fieldKey={fieldIssue.key} message={fieldIssue.message} />}

        {isReview ? (
          <SurveyReview
            fill={fill}
            percent={progress}
            minimum={pointAMinimum(stepData)}
            answers={stepData}
            submitting={submitting}
            hasUnsaved={saveState === 'dirty' || saveState === 'error'}
            onEditStep={(n) => { setCurrentStep(n); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
            onBack={goBack}
            onSubmit={() => { void submitSurvey() }}
          />
        ) : (<>
        {/* Step form */}
        <div className="mb-8">
          {!loaded ? (
            <div className="rounded-2xl border border-white/[0.06] p-10 flex items-center justify-center">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
            </div>
          ) : (
            <>
              {/* F-076: answers found in the user's documents — accept = normal field change + autosave */}
              {hasDocs && <DocumentSuggestions step={currentStep} answers={stepData} onApply={applySuggestion} />}
              {StepForm && (
                <SurveyFieldLayer attribution={attribution} viewer={{ viewerId: userId, viewerIsOwner: true }} onOpenEditor={openEditor}>
                  <StepForm data={stepData} onChange={handleFieldChange} userId={userId ?? undefined} />
                </SurveyFieldLayer>
              )}
            </>
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
          <button onClick={goNext} disabled={isSaving || submitting || !loaded}
            className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-primary to-[#00e29e] text-[#003824] font-bold text-sm hover:scale-[0.99] transition-all disabled:opacity-50">
            {isSaving ? (
              <><span className="material-symbols-outlined text-base animate-spin">progress_activity</span> Сохранение...</>
            ) : isLastStep ? (
              <><span className="material-symbols-outlined text-base">fact_check</span> Проверить и отправить</>
            ) : (
              <><span className="material-symbols-outlined text-base">arrow_forward</span> Далее</>
            )}
          </button>
        </div>
        </>)}

        {/* Early exit — form Точка А now, finish the survey later */}
        {canFinishEarly && (
          <div className="mb-8 -mt-2">
            <button
              onClick={finishEarly}
              disabled={isSaving || submitting}
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

        <AnswerEditorModal target={editor} onSave={saveFromEditor} onClose={closeEditor} companyId={companyId} />

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
