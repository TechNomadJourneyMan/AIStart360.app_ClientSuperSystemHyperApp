'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import SurveyProgressHeader from '@/components/onboarding/SurveyProgressHeader'
import SaveStatusChip from '@/components/onboarding/SaveStatusChip'
import { SurveyModeSwitch } from '@/components/onboarding/modes/SurveyModeSwitch'
import { track } from '@/lib/events/client'
import { enabledSurveyModes, type SurveyMode, type SurveyPreference } from '@/lib/survey/modes'
import { loadSurveyPreference, patchSurveyPreference, switchSurveyMode } from '@/lib/survey/mode-switch'
import { surveyQuestion } from '@/lib/survey/questions'
import type { UseSurveyAnswers } from '@/hooks/useSurveyAnswers'

const ENABLED = enabledSurveyModes()

/**
 * The frame of the «Экспресс + блоки» screens: logo, the mode switch
 * (switching saves first — lib/survey/mode-switch.ts), save status, the
 * honest progress («Минимум для Точки А», «Глубина»), the links of mode 2
 * (Экспресс · Снимок · Блоки), and the error / «изменён в другом режиме»
 * notes. Not sticky on top: the cabinet bar above already is.
 */
export function ModeTwoChrome({ survey, current, children }: {
  survey: UseSurveyAnswers
  current: 'express' | 'snapshot' | 'blocks'
  children: ReactNode
}) {
  const router = useRouter()
  const [pref, setPref] = useState<SurveyPreference>({})
  const [switchError, setSwitchError] = useState<string | null>(null)
  useEffect(() => { void loadSurveyPreference().then(setPref) }, [])

  const onSwitch = async (mode: SurveyMode) => {
    setSwitchError(null)
    const r = await switchSurveyMode({ to: mode, preference: pref }, {
      save: survey.save,
      patchPreferences: patchSurveyPreference,
      track: (name, metadata) => track(name, { metadata }),
      navigate: (href) => router.push(href),
    })
    if (!r.ok) setSwitchError(r.error)
  }

  const tab = (id: typeof current, href: string, label: string) => (
    <Link href={href} aria-current={current === id ? 'page' : undefined}
      className={`inline-flex min-h-[36px] items-center rounded-lg px-3 text-xs ${current === id ? 'bg-primary/15 text-primary' : 'text-on-surface-variant hover:text-on-surface'}`}>
      {label}
    </Link>
  )

  return (
    <div className="min-h-screen bg-[#0c0e14] text-on-surface">
      <header className="border-b border-white/[0.06] bg-[#0c0e14]">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-4 py-3">
          <Link href="/client/home" className="flex items-center gap-2">
            <Image src="/logo-icon.svg" alt="AIStart360" width={28} height={28} className="opacity-80" />
          </Link>
          <div className="flex items-center gap-2">
            <SurveyModeSwitch current="express" enabled={ENABLED} onSwitch={(m) => void onSwitch(m)} />
            <SaveStatusChip state={survey.saveState} savedAt={survey.savedAt} />
          </div>
        </div>
        <SurveyProgressHeader answers={survey.answers} />
        <nav aria-label="Быстрый старт" className="mx-auto flex max-w-3xl flex-wrap gap-1 px-4 pb-2">
          {tab('express', '/client/onboarding/express', 'Экспресс')}
          {tab('snapshot', '/client/onboarding/snapshot', 'Снимок бизнеса')}
          {tab('blocks', '/client/onboarding/blocks', 'Блоки')}
        </nav>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">
        {(survey.error || switchError) && (
          <div role="alert" className="mb-5 flex items-start gap-2 rounded-xl border border-error/30 bg-error/10 px-4 py-3">
            <span className="material-symbols-outlined mt-0.5 text-base text-error" aria-hidden="true">error</span>
            <p className="text-xs leading-snug text-on-surface">{switchError ?? survey.error}</p>
          </div>
        )}
        {survey.staleKeys.length > 0 && (
          <div role="status" className="mb-5 flex items-start gap-2 rounded-xl border border-amber-300/30 bg-amber-300/10 px-4 py-3">
            <span className="material-symbols-outlined mt-0.5 text-base text-amber-200" aria-hidden="true">sync_problem</span>
            <p className="flex-1 text-xs leading-snug text-on-surface">
              Ответ изменён в другом режиме — показан новый: {survey.staleKeys.map((k) => `«${surveyQuestion(k)?.label ?? k}»`).join(', ')}.
            </p>
            <button type="button" onClick={survey.dismissStale} aria-label="Скрыть" className="min-h-[32px] px-2 text-on-surface-variant hover:text-on-surface">
              <span className="material-symbols-outlined text-base" aria-hidden="true">close</span>
            </button>
          </div>
        )}
        {children}
      </main>
    </div>
  )
}
