'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { track } from '@/lib/events/client'
import { isAnswerFilled } from '@/lib/survey/answer-filled'
import {
  SURVEY_MODE_INFO, enabledSurveyModes, modeChosenMetadata, readSurveyPreference, resolveSurveyEntry, surveyBannerDismissPatch,
  surveyPreferencePatch, type SurveyEntry, type SurveyMode, type SurveyPreference,
} from '@/lib/survey/modes'
import { SurveyModeChooser } from './SurveyModeChooser'
import { SurveyModesBanner } from './SurveyModesBanner'

async function patchPreferences(body: unknown): Promise<void> {
  await fetch('/api/v1/settings/preferences', {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => undefined)
}

/**
 * Before the full questionnaire: the mode chooser for a new client, the
 * one-time banner for a client who already started (spec §5.2). With only the
 * full questionnaire selectable (Ф1 in production) it renders the children at
 * once and makes no request.
 */
export function SurveyModeGate({ children }: { children: ReactNode }) {
  const [enabled] = useState(() => enabledSurveyModes())
  const params = useSearchParams()
  const router = useRouter()
  const [entry, setEntry] = useState<SurveyEntry | null>(enabled.length > 1 ? null : { screen: 'mode', mode: 'full', banner: false })
  const [pref, setPref] = useState<SurveyPreference>({})
  const [busy, setBusy] = useState<SurveyMode | null>(null)

  useEffect(() => {
    if (enabled.length <= 1) return
    let cancelled = false
    void (async () => {
      const [prefJson, surveyJson] = await Promise.all([
        fetch('/api/v1/settings/preferences', { credentials: 'include' }).then((r) => r.json()).catch(() => null),
        fetch('/api/v1/onboarding/survey', { credentials: 'include' }).then((r) => r.json()).catch(() => null),
      ])
      if (cancelled) return
      const preference = readSurveyPreference(prefJson?.data)
      const answers = (surveyJson?.data?.answers ?? {}) as Record<string, unknown>
      setPref(preference)
      setEntry(resolveSurveyEntry({
        preference,
        answeredCount: Object.values(answers).filter(isAnswerFilled).length,
        available: enabled,
        explicitStep: !!params.get('step'),
      }))
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A saved choice of another mode: open it (a `?step=N` link always lands in the full questionnaire).
  useEffect(() => {
    if (entry?.screen === 'mode' && entry.mode !== 'full') router.replace(SURVEY_MODE_INFO[entry.mode].href)
  }, [entry, router])

  const choose = async (mode: SurveyMode, from: 'chooser' | 'switch') => {
    setBusy(mode)
    track('SURVEY_MODE_CHOSEN', { metadata: modeChosenMetadata(pref, mode, from) })
    await patchPreferences(surveyPreferencePatch(pref, mode))
    setPref((p) => ({ ...p, ...surveyPreferencePatch(p, mode).survey }))
    setBusy(null)
    if (mode === 'full') setEntry({ screen: 'mode', mode: 'full', banner: false })
    else router.push(SURVEY_MODE_INFO[mode].href)
  }

  if (!entry || (entry.screen === 'mode' && entry.mode !== 'full')) return <div className="min-h-screen bg-[#0c0e14]" aria-busy="true" />
  if (entry.screen === 'chooser') {
    return (
      <div className="min-h-screen bg-[#0c0e14] text-on-surface">
        <SurveyModeChooser enabled={enabled} recommended={entry.recommended} busy={busy} onChoose={(m) => void choose(m, 'chooser')} />
      </div>
    )
  }
  return (
    <>
      {entry.banner && (
        <SurveyModesBanner
          enabled={enabled}
          onTry={(m) => void choose(m, 'switch')}
          onDismiss={() => { setEntry({ ...entry, banner: false }); void patchPreferences(surveyBannerDismissPatch()) }}
        />
      )}
      {children}
    </>
  )
}
