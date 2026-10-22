'use client'

// The questionnaire wizard's chrome around the REAL step forms, on fixture data.
// Nothing leaves the page: edits stay in memory, and the few components that
// fetch on their own (document suggestions, inline hints, the answer editor's
// attachments) get fixture answers from a fetch stub installed below — any other
// /api/ call is refused. Mirrors app/client/onboarding/page.tsx; keep in step.
import { useCallback, useState } from 'react'
import { STEPS, TOTAL_STEPS } from '@/components/onboarding/constants/step-config'
import InlineValidationHints from '@/components/assistant/InlineValidationHints'
import { getSectionByStep } from '@/lib/assistant/sections'
import { overallFill, stepFillFromAnswers } from '@/lib/survey/progress'
import SurveyReview from '@/components/onboarding/SurveyReview'
import SaveStatusChip from '@/components/onboarding/SaveStatusChip'
import DocumentSuggestions from '@/components/onboarding/DocumentSuggestions'
import SurveyFieldLayer, { type EditorRequest } from '@/components/onboarding/SurveyFieldLayer'
import AnswerEditorModal, { type AnswerEditorTarget } from '@/components/onboarding/AnswerEditorModal'
import type { AnswerAttribution } from '@/lib/survey/attribution-label'
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
import {
  previewAnswers, previewAttribution, previewIssues, previewSuggestions,
  SURVEY_PREVIEW_VARIANT_LABEL, SURVEY_PREVIEW_VARIANTS, type SurveyPreviewVariant,
} from './fixture'

const STEP_FORMS: Record<number, React.ComponentType<{ data: Record<string, unknown>; onChange: (key: string, value: unknown) => void; userId?: string }>> = {
  1: Step1CompanyForm, 2: Step2GoalsForm, 3: Step3PositioningForm, 4: Step4OrgStructureForm,
  5: Step5ClientBaseForm, 6: Step6CJMForm, 7: Step7MarketingForm, 8: Step8MetricsForm,
  9: Step9FinanceForm, 10: Step10PersonalForm, 11: Step11InfluenceForm, 12: Step12ToolsForm,
}
const REVIEW_STEP = TOTAL_STEPS + 1
const PREVIEW_USER = 'preview-owner'

// ─── Network boundary ─────────────────────────────────────────────────────────
// The variant the stub answers for (set on every render, read by the stub).
let stubVariant: SurveyPreviewVariant = 'empty'
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function installFetchStub() {
  const w = window as unknown as { __surveyPreviewFetch?: boolean }
  if (w.__surveyPreviewFetch) return
  w.__surveyPreviewFetch = true
  const real = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const url = new URL(raw, window.location.origin)
    // Other origins (Supabase storage behind the file pickers, …): refused.
    if (url.origin !== window.location.origin) return json({ ok: false, error: 'Превью: сеть отключена' }, 503)
    if (!url.pathname.startsWith('/api/')) return real(input, init) // Next.js assets / RSC
    const path = url.pathname
    if (path === '/api/v1/onboarding/suggestions') return json({ ok: true, data: previewSuggestions(stubVariant) })
    const decided = path.match(/^\/api\/v1\/onboarding\/suggestions\/([^/]+)\/(accept|reject)$/)
    if (decided) {
      const s = previewSuggestions(stubVariant).find((x) => x.id === decided[1])
      return json({ ok: true, data: { value: s?.value ?? null } })
    }
    if (path === '/api/v1/assistant/validate') {
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as { section?: string }) : {}
      return json({ ok: true, issues: previewIssues(stubVariant, body.section ?? '') })
    }
    if (path === '/api/v1/onboarding/survey/attachments') return json({ ok: true, data: [], available: true })
    return json({ ok: false, error: 'Превью: сеть отключена' }, 503)
  }
}
if (typeof window !== 'undefined') installFetchStub()

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function SurveyPreviewClient({ variant, step }: { variant: SurveyPreviewVariant; step: number }) {
  stubVariant = variant
  const [answers, setAnswers] = useState<Record<string, unknown>>(() => previewAnswers(variant))
  const [attribution, setAttribution] = useState<Record<string, AnswerAttribution>>(() => previewAttribution(variant, previewAnswers(variant)))
  const [currentStep, setCurrentStep] = useState(step)
  const [editor, setEditor] = useState<AnswerEditorTarget | null>(null)
  const [dirty, setDirty] = useState(false)

  const onChange = useCallback((key: string, value: unknown) => {
    setAnswers((prev) => ({ ...prev, [key]: value }))
    setDirty(true)
  }, [])
  const openEditor = useCallback((req: EditorRequest) => setEditor({ ...req, value: answers[req.key] ?? '' }), [answers])
  const saveFromEditor = async (key: string, value: string) => {
    onChange(key, value)
    setAttribution((prev) => ({ ...prev, [key]: { updatedBy: PREVIEW_USER, updatedByRole: 'user', updatedAt: new Date().toISOString(), updatedByName: null } }))
    return { ok: true as const }
  }
  const go = (n: number) => { setCurrentStep(n); window.scrollTo({ top: 0 }) }

  const isReview = currentStep === REVIEW_STEP
  const fill = stepFillFromAnswers(answers)
  const progress = overallFill(fill).percent
  const stepConfig = STEPS[currentStep - 1]
  const StepForm = STEP_FORMS[currentStep]
  const sectionId = getSectionByStep(currentStep)?.id ?? null
  const planFilled = ['s2n_goal_12m_what', 's2n_goal_3y_what'].some((k) => typeof answers[k] === 'string' && (answers[k] as string).trim())
  const canFinishEarly = currentStep !== TOTAL_STEPS && !isReview && (planFilled || variant === 'ai')
  const href = (v: SurveyPreviewVariant, s: number) => `?variant=${v}&step=${s === REVIEW_STEP ? 'review' : s}`

  return (
    <div className="min-h-screen bg-[#0c0e14] text-on-surface">
      <nav aria-label="Превью анкеты" className="border-b border-amber-400/20 bg-amber-400/[0.05] px-4 py-2 text-[11px]">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-1.5">
          <span className="mr-1 font-mono uppercase tracking-wider text-amber-300/80">dev · превью анкеты</span>
          {SURVEY_PREVIEW_VARIANTS.map((v) => (
            <a key={v} href={href(v, currentStep)} aria-current={v === variant ? 'page' : undefined}
              className={`rounded-md border px-2 py-1 ${v === variant ? 'border-primary/40 text-primary' : 'border-white/[0.08] text-on-surface-variant'}`}>
              {SURVEY_PREVIEW_VARIANT_LABEL[v]}
            </a>
          ))}
        </div>
      </nav>

      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#0c0e14]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <span className="text-sm font-bold text-on-surface/70">AIStart360</span>
          <div className="flex items-center gap-3">
            <SaveStatusChip state={dirty ? 'dirty' : variant === 'empty' ? 'idle' : 'saved'} savedAt={new Date('2026-10-22T10:15:00')} />
            <span className="whitespace-nowrap font-mono text-[10px] text-on-surface-variant">
              {isReview ? 'Проверка' : `Шаг ${currentStep} из ${TOTAL_STEPS}`} · {progress}%
            </span>
          </div>
        </div>
        <div className="h-0.5 bg-white/[0.04]" role="progressbar" aria-label="Заполнено анкеты" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
          <div className="h-full bg-gradient-to-r from-primary to-[#00e29e]" style={{ width: `${progress}%` }} />
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6 md:py-10">
        <div className="mb-5 flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/[0.06] px-4 py-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary/15">
            <span className="material-symbols-outlined text-lg text-primary">cloud_upload</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-on-surface">
              Загрузить файлы
              {variant === 'ai' && <span className="ml-2 align-middle font-mono text-[10px] text-primary">✓ загружено</span>}
            </p>
            <p className="text-[11px] text-on-surface-variant">Отчёты, P&amp;L, база клиентов · xlsx, csv, pdf — в отдельном окне, можно в любой момент</p>
          </div>
        </div>

        <div className="sticky top-[54px] z-20 -mx-4 mb-6 flex flex-wrap gap-1.5 border-b border-white/[0.06] bg-[#0c0e14]/95 px-4 py-3 backdrop-blur-xl">
          {STEPS.map((s, i) => {
            const n = i + 1
            const active = n === currentStep
            const started = fill[i]?.started === true
            return (
              <button key={n} type="button" onClick={() => go(n)} aria-current={active ? 'step' : undefined}
                title={`${s.title}: заполнено ${fill[i]?.filled ?? 0} из ${fill[i]?.total ?? 0}`}
                className={`flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 font-mono text-[10px] ${active ? 'border border-primary/20 bg-primary/15 text-primary' : started ? 'bg-white/[0.04] text-on-surface-variant' : 'bg-white/[0.02] text-on-surface-variant/60'}`}>
                <span className={`material-symbols-outlined text-xs ${started && !active ? 'text-primary/80' : ''}`}>{started ? 'check_circle' : s.icon}</span>
                {s.title}
              </button>
            )
          })}
          <button type="button" onClick={() => go(REVIEW_STEP)} aria-current={isReview ? 'step' : undefined}
            className={`rounded-lg px-3 py-1.5 font-mono text-[10px] ${isReview ? 'border border-primary/20 bg-primary/15 text-primary' : 'border border-dashed border-white/[0.1] text-on-surface-variant/70'}`}>
            Проверка (экран)
          </button>
        </div>

        {isReview ? (
          <SurveyReview fill={fill} percent={progress} submitting={false} hasUnsaved={dirty}
            onEditStep={go} onBack={() => go(TOTAL_STEPS)} onSubmit={() => {}} />
        ) : (
          <>
            <div className="mb-6">
              <div className="mb-2 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
                  <span className="material-symbols-outlined text-lg text-primary">{stepConfig?.icon ?? 'description'}</span>
                </div>
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-primary/60">Шаг {currentStep}</p>
                  <h1 className="text-xl font-bold text-on-surface">{stepConfig?.title}</h1>
                </div>
              </div>
              {stepConfig?.hint && (
                <div className="flex items-start gap-2 rounded-lg border border-primary/15 bg-primary/[0.05] px-3 py-2">
                  <span className="material-symbols-outlined mt-0.5 flex-shrink-0 text-sm text-primary/70">lightbulb</span>
                  <p className="text-xs leading-snug text-on-surface-variant">{stepConfig.hint}</p>
                </div>
              )}
            </div>

            <div className="mb-8">
              {variant === 'ai' && <DocumentSuggestions key={`sg-${currentStep}`} step={currentStep} answers={answers} onApply={onChange} />}
              {StepForm && (
                <SurveyFieldLayer attribution={attribution} viewer={{ viewerId: PREVIEW_USER, viewerIsOwner: true }} onOpenEditor={openEditor}>
                  {/* userId is omitted: the file pickers stay disabled, nothing is uploaded. */}
                  <StepForm key={`${variant}-${currentStep}`} data={answers} onChange={onChange} />
                </SurveyFieldLayer>
              )}
              {sectionId && (
                <div className="mt-5">
                  <InlineValidationHints section={sectionId} draftAnswers={answers} />
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 pb-8">
              {currentStep > 1 && (
                <button type="button" onClick={() => go(currentStep - 1)}
                  className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] px-5 py-2.5 text-sm text-on-surface-variant">
                  <span className="material-symbols-outlined text-base">arrow_back</span>
                  Назад
                </button>
              )}
              <button type="button" onClick={() => go(Math.min(currentStep + 1, REVIEW_STEP))}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-[#00e29e] px-5 py-3 text-sm font-bold text-[#003824]">
                <span className="material-symbols-outlined text-base">{currentStep === TOTAL_STEPS ? 'fact_check' : 'arrow_forward'}</span>
                {currentStep === TOTAL_STEPS ? 'Проверить и отправить' : 'Далее'}
              </button>
            </div>
          </>
        )}

        {canFinishEarly && (
          <div className="-mt-2 mb-8">
            <button type="button" className="flex w-full items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/[0.06] px-5 py-3 text-sm font-semibold text-primary">
              <span className="material-symbols-outlined text-base">insights</span>
              Сформировать Точку А и перейти в кабинет
            </button>
            <p className="mt-2 text-center text-[10px] text-on-surface-variant/60">Анкета сохранится — её можно дозаполнить в любой момент.</p>
          </div>
        )}

        <AnswerEditorModal target={editor} onSave={saveFromEditor} onClose={() => setEditor(null)} companyId={null} attachments={false} />

        <p className="px-4 text-center text-[10px] text-on-surface-variant/40">
          Я подтверждаю достоверность данных и даю согласие AIStart360 использовать их для бизнес-диагностики. Данные не передаются третьим лицам.
        </p>
      </main>
    </div>
  )
}
