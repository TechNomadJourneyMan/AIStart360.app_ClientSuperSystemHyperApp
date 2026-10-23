/**
 * Survey Ф5 — the three modes with the flag on (NEXT_PUBLIC_SURVEY_MODES =
 * full,express,chat): three cards without «Скоро», old clients land in the
 * full questionnaire with the banner, a step link is the full questionnaire,
 * a switch from ANY mode (the chat included) remembers the choice — the full
 * questionnaire no longer sends the client back to the saved mode.
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SurveyModeChooser } from '@/components/onboarding/modes/SurveyModeChooser'
import { enabledSurveyModes, resolveSurveyEntry, type SurveyPreference } from '@/lib/survey/modes'
import { switchSurveyMode } from '@/lib/survey/mode-switch'
import { readFileSync } from 'node:fs'

const FLAG = 'full,express,chat'
const enabled = enabledSurveyModes(FLAG)

describe('flag full,express,chat', () => {
  it('all three modes are selectable; spaces and unknown names are tolerated; without the flag only «full»', () => {
    expect(enabled).toEqual(['full', 'express', 'chat'])
    expect(enabledSurveyModes(' express , chat, paper ')).toEqual(['full', 'express', 'chat'])
    expect(enabledSurveyModes('')).toEqual(['full'])
    expect(enabledSurveyModes(null)).toEqual(['full'])
  })

  it('a new client sees three cards, none «Скоро», express recommended', () => {
    const entry = resolveSurveyEntry({ preference: {}, answeredCount: 0, available: enabled })
    expect(entry).toEqual({ screen: 'chooser', recommended: 'express' })
    const html = renderToStaticMarkup(createElement(SurveyModeChooser, { enabled, recommended: 'express', onChoose: () => undefined }))
    expect(html).not.toContain('Скоро')
    expect(html).not.toContain('disabled=""')
    for (const t of ['Расширенная полная анкета', 'Экспресс + блоки', 'Диагностическая беседа с ИИ']) expect(html).toContain(t)
  })

  it('an old client (answers, no choice) → the full questionnaire with the one-time banner; a step link → full', () => {
    expect(resolveSurveyEntry({ preference: {}, answeredCount: 40, available: enabled })).toEqual({ screen: 'mode', mode: 'full', banner: true })
    expect(resolveSurveyEntry({ preference: { banner_dismissed_at: '2026-10-23T00:00:00Z' }, answeredCount: 40, available: enabled })).toEqual({ screen: 'mode', mode: 'full', banner: false })
    expect(resolveSurveyEntry({ preference: { mode: 'chat' }, answeredCount: 40, available: enabled, explicitStep: true })).toMatchObject({ screen: 'mode', mode: 'full' })
  })

  it('a saved mode opens; a saved mode switched off by the flag → the full questionnaire', () => {
    expect(resolveSurveyEntry({ preference: { mode: 'chat' }, answeredCount: 3, available: enabled })).toEqual({ screen: 'mode', mode: 'chat', banner: false })
    expect(resolveSurveyEntry({ preference: { mode: 'chat' }, answeredCount: 3, available: enabledSurveyModes('full,express') })).toEqual({ screen: 'mode', mode: 'full', banner: false })
  })

  it('chat → full: the choice is saved and the event written; /client/onboarding then opens the full questionnaire', async () => {
    let pref: SurveyPreference = { mode: 'chat', chosen_at: '2026-10-23T09:00:00Z' }
    const tracked: unknown[] = []
    const went: string[] = []
    const r = await switchSurveyMode({ to: 'full', preference: pref, now: new Date('2026-10-24T09:00:00Z') }, {
      save: async () => ({ ok: true }),
      patchPreferences: async (body) => { pref = { ...pref, ...body.survey } },
      track: (name, metadata) => { tracked.push({ name, metadata }) },
      navigate: (href) => { went.push(href) },
    })
    expect(r).toEqual({ ok: true, href: '/client/onboarding' })
    expect(tracked).toEqual([{ name: 'SURVEY_MODE_CHOSEN', metadata: { mode: 'full', previous: 'chat', from: 'switch' } }])
    expect(pref).toMatchObject({ mode: 'full', switched_at: '2026-10-24T09:00:00.000Z' })
    expect(resolveSurveyEntry({ preference: pref, answeredCount: 3, available: enabled })).toEqual({ screen: 'mode', mode: 'full', banner: false })
  })

  it('every mode screen switches through switchSurveyMode (no bare router.push of a mode)', () => {
    for (const f of ['components/onboarding/chat/SurveyChat.tsx', 'components/onboarding/express/ModeTwoChrome.tsx', 'app/client/onboarding/page.tsx']) {
      const src = readFileSync(f, 'utf8')
      expect(src, f).toContain('switchSurveyMode(')
      expect(src, f).not.toMatch(/onSwitch=\{\(m\) => router\.push/)
    }
  })
})
