'use client'

/**
 * /dev/survey-preview?mode=chat — the questionnaire chat on a recorded
 * scenario (survey Ф4): no network, no model. `as=staff` — the staff
 * transcript; `helper=1` — the field «Помощник» panel on «Выручка в месяц».
 */
import { useMemo, useState } from 'react'
import { SurveyChat } from '@/components/onboarding/chat/SurveyChat'
import { FieldHelperPanel } from '@/components/onboarding/chat/FieldHelperPanel'
import { SurveyChatTranscriptView } from '@/components/onboarding/chat/SurveyChatTranscript'
import { previewChatTransport, previewTranscript } from './chat-fixture'

export function ChatPreview({ staff, helper }: { staff: boolean; helper: boolean }) {
  const transport = useMemo(() => previewChatTransport(), [])
  const [applied, setApplied] = useState<string | null>(null)
  const [open, setOpen] = useState(helper)
  if (staff) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="mb-4 text-lg font-bold text-on-surface">Беседа с ИИ-помощником — вид эксперта</h1>
        <SurveyChatTranscriptView conversations={previewTranscript()} />
      </main>
    )
  }
  if (helper) {
    return (
      <main className="mx-auto max-w-xl px-4 py-8 text-sm text-on-surface">
        <p>Поле «Выручка в месяц»: <strong>{applied ?? 'пусто'}</strong> (значение из «Помощника» попадает в форму, не в базу).</p>
        <button type="button" onClick={() => setOpen(true)} className="mt-3 min-h-[44px] rounded-lg border border-white/[0.1] px-4">Открыть «Помощник»</button>
        {open && <FieldHelperPanel fieldKey="s1_current_revenue_month" transport={transport} onApply={(_k, v) => { setApplied(JSON.stringify(v)); setOpen(false) }} onClose={() => setOpen(false)} />}
      </main>
    )
  }
  return <SurveyChat transport={transport} />
}
