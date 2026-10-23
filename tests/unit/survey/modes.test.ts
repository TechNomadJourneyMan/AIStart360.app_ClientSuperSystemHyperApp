/**
 * lib/survey/modes.ts — which way of filling in a client gets (spec §5.2, PO §18.3).
 */
import { describe, expect, it } from 'vitest'
import {
  SURVEY_MODE_INFO, SURVEY_MODES_BUILT, availableSurveyModes, enabledSurveyModes, modeChosenMetadata, readSurveyPreference, recommendedSurveyMode, resolveSurveyEntry,
  surveyBannerDismissPatch, surveyPreferencePatch,
} from '@/lib/survey/modes'
import { EVENTS, isClientEvent } from '@/lib/events/registry'

const ALL = ['full', 'express', 'chat'] as const
const NOW = new Date('2026-10-23T09:00:00Z')

describe('availability', () => {
  it('the full questionnaire is always on; the others by NEXT_PUBLIC_SURVEY_MODES', () => {
    expect(availableSurveyModes('')).toEqual(['full'])
    expect(availableSurveyModes(undefined)).toEqual(['full'])
    expect(availableSurveyModes('chat, express,bogus')).toEqual(['full', 'express', 'chat'])
  })

  it('a mode is selectable only when switched on AND built (Ф1: the full questionnaire only)', () => {
    // Ф4 built the chat; express is Ф2's.
    expect(enabledSurveyModes('express,chat')).toEqual(SURVEY_MODES_BUILT.includes('express') ? ['full', 'express', 'chat'] : ['full', 'chat'])
    expect(enabledSurveyModes('')).toEqual(['full'])
    expect(enabledSurveyModes('express,chat', ['full', 'express'])).toEqual(['full', 'express'])
    expect(enabledSurveyModes('', ['full', 'express'])).toEqual(['full'])
  })

  it('cards carry the PO names and time estimates', () => {
    expect(SURVEY_MODE_INFO.full.title).toBe('Расширенная полная анкета')
    expect(SURVEY_MODE_INFO.express.title).toBe('Экспресс + блоки')
    expect(SURVEY_MODE_INFO.chat.title).toBe('Диагностическая беседа с ИИ')
    for (const m of ALL) expect(SURVEY_MODE_INFO[m].time).toMatch(/мин|ч/)
  })
})

describe('resolveSurveyEntry', () => {
  it('only the full questionnaire switched on: nobody sees the chooser or the banner', () => {
    expect(resolveSurveyEntry({ preference: {}, answeredCount: 0, available: ['full'] })).toEqual({ screen: 'mode', mode: 'full', banner: false })
    expect(resolveSurveyEntry({ preference: {}, answeredCount: 40, available: ['full'] })).toEqual({ screen: 'mode', mode: 'full', banner: false })
  })

  it('a new client gets the chooser (express recommended); a deep link to a step skips it', () => {
    expect(resolveSurveyEntry({ preference: {}, answeredCount: 0, available: ALL })).toEqual({ screen: 'chooser', recommended: 'express' })
    expect(resolveSurveyEntry({ preference: {}, answeredCount: 0, available: ['full', 'chat'] })).toEqual({ screen: 'chooser', recommended: 'full' })
    expect(resolveSurveyEntry({ preference: {}, answeredCount: 0, available: ALL, explicitStep: true })).toMatchObject({ screen: 'mode', mode: 'full' })
  })

  it('a client who already started: the full questionnaire without the chooser, and the banner once', () => {
    expect(resolveSurveyEntry({ preference: {}, answeredCount: 12, available: ALL })).toEqual({ screen: 'mode', mode: 'full', banner: true })
    expect(resolveSurveyEntry({ preference: { banner_dismissed_at: NOW.toISOString() }, answeredCount: 12, available: ALL })).toEqual({ screen: 'mode', mode: 'full', banner: false })
  })

  it('a saved choice wins; a switched-off mode falls back to the full questionnaire', () => {
    expect(resolveSurveyEntry({ preference: { mode: 'chat' }, answeredCount: 0, available: ALL })).toEqual({ screen: 'mode', mode: 'chat', banner: false })
    expect(resolveSurveyEntry({ preference: { mode: 'express' }, answeredCount: 3, available: ['full'] })).toEqual({ screen: 'mode', mode: 'full', banner: false })
  })

  it('recommended mode', () => {
    expect(recommendedSurveyMode(0, ALL)).toBe('express')
    expect(recommendedSurveyMode(5, ALL)).toBe('full')
  })
})

describe('preference and events', () => {
  it('reads preferences.survey defensively', () => {
    expect(readSurveyPreference({ survey: { mode: 'express', chosen_at: 'x', junk: 1 } })).toEqual({ mode: 'express', chosen_at: 'x' })
    expect(readSurveyPreference({ survey: { mode: 'hack' } })).toEqual({})
    expect(readSurveyPreference(null)).toEqual({})
    expect(readSurveyPreference({ survey: [] })).toEqual({})
  })

  it('the PATCH keeps the first choice date and stamps a switch', () => {
    expect(surveyPreferencePatch({}, 'full', NOW)).toEqual({ survey: { mode: 'full', chosen_at: NOW.toISOString() } })
    expect(surveyPreferencePatch({ mode: 'full', chosen_at: 'a' }, 'express', NOW)).toEqual({ survey: { mode: 'express', chosen_at: 'a', switched_at: NOW.toISOString() } })
    expect(surveyPreferencePatch({ mode: 'full', chosen_at: 'a' }, 'full', NOW)).toEqual({ survey: { mode: 'full', chosen_at: 'a' } })
    expect(surveyBannerDismissPatch(NOW)).toEqual({ survey: { banner_dismissed_at: NOW.toISOString() } })
  })

  it('SURVEY_MODE_CHOSEN / SURVEY_ANSWERS_VIEWED are browser events of the questionnaire', () => {
    expect(isClientEvent('SURVEY_MODE_CHOSEN')).toBe(true)
    expect(isClientEvent('SURVEY_ANSWERS_VIEWED')).toBe(true)
    expect(EVENTS.SURVEY_MODE_CHOSEN.type).toBe('questionnaire')
    // «Анкета заполнена» stays a server event of the full questionnaire (PO §18.3 item 1).
    expect(isClientEvent('QUESTIONNAIRE_COMPLETED')).toBe(false)
    expect(modeChosenMetadata({ mode: 'full' }, 'express', 'switch')).toEqual({ mode: 'express', previous: 'full', from: 'switch' })
    expect(modeChosenMetadata({}, 'full', 'chooser')).toEqual({ mode: 'full', previous: null, from: 'chooser' })
  })
})
