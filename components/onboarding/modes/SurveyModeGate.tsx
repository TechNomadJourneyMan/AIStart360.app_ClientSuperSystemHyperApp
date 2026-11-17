'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { track } from '@/lib/events/client'
import { isAnswerFilled } from '@/lib/survey/answer-filled'
import {
  SURVEY_MODE_INFO, SURVEY_MODE_OFF_NOTICE, isSurveyMode, modeChosenMetadata, readSurveyPreference, resolveSurveyEntry, surveyBannerDismissPatch,
  surveyPreferencePatch, withoutSwitchedOff, type SurveyEntry, type SurveyMode, type SurveyPreference,
} from '@/lib/survey/modes'
import { SurveyModeChooser } from './SurveyModeChooser'
import { SurveyModesBanner } from './SurveyModesBanner'
import { useSurveyModes } from './SurveyModesContext'

async function patchPreferences(body: unknown): Promise<void> {
  await fetch('/api/v1/settings/preferences', {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => undefined)
}

/**
 * `?off=<mode>`: the server page of that mode found it switched off in GIGA
 * and sent the client here (lib/survey/modes.ts surveyModeOffRedirect).
 */
export function SurveyModeOffNotice({ off }: { off: string | null }) {
  if (!isSurveyMode(off) || off === 'full') return null
  return (
    <div role="status" className="mx-auto mt-3 flex max-w-3xl items-start gap-2 rounded-xl border border-amber-300/30 bg-amber-300/10 px-4 py-3">
      <span className="material-symbols-outlined mt-0.5 text-base text-amber-200" aria-hidden="true">info</span>
      <p className="text-sm leading-snug text-on-surface">{SURVEY_MODE_OFF_NOTICE[off]}</p>
    </div>
  )
}

/**
 * Before the full questionnaire: the mode chooser for a new client (the
 * default mode of the GIGA setting first, «Рекомендуем»), the one-time banner
 * for a client who already started (spec §5.2). The modes come from the server
 * (SurveyModesContext, R4-B4). With only the full questionnaire selectable it
 * renders the children at once and makes no request.
 */
export function SurveyModeGate({ children }: { children: ReactNode }) {
  const params = useSearchParams()
  const off = params.get('off')
  const server = useSurveyModes()
  const modes = useMemo(() => withoutSwitchedOff(server, off), [server, off])
  const enabled = modes.enabled
  // The entry is decided anew when the list changes — e.g. a mode page sent the client back with `?off=`
  // (the children are not remounted: the questionnaire keeps its state).
  const enabledKey = enabled.join(',')
  const router = useRouter()
  const [entry, setEntry] = useState<SurveyEntry | null>(enabled.length > 1 ? null : { screen: 'mode', mode: 'full', banner: false })
  const [pref, setPref] = useState<SurveyPreference>({})
  const [busy, setBusy] = useState<SurveyMode | null>(null)

  useEffect(() => {
    if (enabled.length <= 1) {
      setEntry((e) => (e?.screen === 'mode' && e.mode === 'full' ? e : { screen: 'mode', mode: 'full', banner: false }))
      return
    }
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
        defaultMode: modes.defaultMode,
      }))
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledKey, modes.defaultMode])

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
        <SurveyModeOffNotice off={off} />
        <SurveyModeChooser enabled={enabled} recommended={entry.recommended} busy={busy} onChoose={(m) => void choose(m, 'chooser')} />
      </div>
    )
  }
  return (
    <>
      <SurveyModeOffNotice off={off} />
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
