'use client'

// Dev preview of the survey Ф1 screens on fixture data (no network):
//   ?view=answers [&as=staff]  — «Мои ответы» (client) / the staff view (GIGA, expert)
//   ?view=chooser              — the mode chooser with all three cards switched on
import { useState } from 'react'
import { SurveyAnswersView } from '@/components/onboarding/answers/SurveyAnswersView'
import { SurveyModeChooser } from '@/components/onboarding/modes/SurveyModeChooser'
import { SurveyModeSwitch } from '@/components/onboarding/modes/SurveyModeSwitch'
import { SurveyModesBanner } from '@/components/onboarding/modes/SurveyModesBanner'
import type { SurveyMode } from '@/lib/survey/modes'
import type { AnswerAttribution } from '@/lib/survey/attribution-label'
import { previewAnswers, previewAttribution, type SurveyPreviewVariant } from './fixture'

const STAFF_VIEWER = { viewerId: 'preview-expert', ownerName: 'Айгуль Сапарова' }
const OWNER_VIEWER = { viewerIsOwner: true }

export function AnswersPreview({ variant, staff }: { variant: SurveyPreviewVariant; staff: boolean }) {
  const [answers, setAnswers] = useState<Record<string, unknown>>(() => previewAnswers(variant))
  const [attribution, setAttribution] = useState<Record<string, AnswerAttribution>>(() => previewAttribution(variant, previewAnswers(variant)))
  // Saves stay in memory, stamped like the server would.
  const save = async (key: string, value: unknown) => {
    setAnswers((a) => ({ ...a, [key]: value }))
    setAttribution((a) => ({
      ...a,
      [key]: staff
        ? { updatedBy: 'preview-expert', updatedByRole: 'expert', updatedAt: new Date().toISOString(), updatedByName: 'Вы', updatedVia: 'staff' }
        : { updatedBy: 'preview-owner', updatedByRole: 'user', updatedAt: new Date().toISOString(), updatedByName: null, updatedVia: 'full' },
    }))
    return { ok: true as const }
  }
  return (
    <div className="min-h-screen bg-[#0c0e14] text-on-surface">
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-bold">{staff ? 'Анкета клиента (вид эксперта)' : 'Мои ответы'}</h1>
          {!staff && <SurveyModeSwitch current="answers" enabled={['full']} />}
        </div>
        <SurveyAnswersView
          answers={answers}
          attribution={attribution}
          viewer={staff ? STAFF_VIEWER : OWNER_VIEWER}
          mode={staff ? 'staff' : 'client'}
          canEdit
          reason={staff ? 'required' : 'none'}
          onSave={save}
          pdfHref={staff ? null : '#pdf'}
          onHistory={staff ? () => undefined : undefined}
        />
      </main>
    </div>
  )
}

export function ChooserPreview() {
  const [picked, setPicked] = useState<SurveyMode | null>(null)
  const all: SurveyMode[] = ['full', 'express', 'chat']
  return (
    <div className="min-h-screen bg-[#0c0e14] text-on-surface">
      <SurveyModesBanner enabled={all} onTry={setPicked} onDismiss={() => setPicked(null)} />
      <SurveyModeChooser enabled={all} recommended="express" onChoose={setPicked} />
      <div className="mx-auto max-w-4xl px-4 pb-6">
        <p className="text-xs text-on-surface-variant">Сегодня (Ф1) в продукте выбирается только полная анкета — остальные карточки показываются как «Скоро»:</p>
        <SurveyModeChooser enabled={['full']} recommended="full" onChoose={setPicked} />
        {picked && <p className="mt-2 text-xs text-primary" role="status">Выбрано: {picked}</p>}
      </div>
    </div>
  )
}
