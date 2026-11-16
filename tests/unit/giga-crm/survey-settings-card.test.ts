/**
 * R4-B4 (R-027): GIGA → Настройки → «Анкета» — the survey modes are a setting
 * (no rebuild): the full questionnaire always on, express switch, the chat =
 * the AI helper switch, the mode offered first to a new client, the AI budget.
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { SurveySettingsCard, type SurveySettingsValues } from '@/components/giga-panel/settings/SurveySettingsCard'

const values: SurveySettingsValues = {
  survey_modes: { express: true, default_mode: 'express' },
  survey_chat_enabled: true,
  survey_ai_budget_usd_per_client: 0.5,
}
const render = (over: Partial<SurveySettingsValues> = {}, opts: { disabled?: boolean } = {}) =>
  renderToStaticMarkup(createElement(SurveySettingsCard, {
    values: { ...values, ...over }, meta: {}, disabled: opts.disabled ?? false, saving: null, onSave: async () => true,
  }))

describe('SurveySettingsCard', () => {
  it('the modes and the default for new clients, as clients get them now', () => {
    const html = render()
    expect(html).toContain('Анкета')
    expect(html).toContain('Способы заполнения анкеты')
    expect(html).toContain('Полная анкета — 12 разделов')
    expect(html).toMatch(/role="switch" aria-checked="true" aria-label="Полная анкета — 12 разделов: включена всегда" disabled=""/)
    expect(html).toMatch(/role="switch" aria-checked="true" aria-label="Экспресс \+ блоки — снимок бизнеса и блоки"/)
    expect(html).toMatch(/role="radio" aria-checked="true"[^>]*>Экспресс</)
    expect(html).toMatch(/role="radio" aria-checked="false"[^>]*>Полная</)
    expect(html).toMatch(/role="radio" aria-checked="false"[^>]*>Беседа</)
    expect(html).toContain('Сейчас у клиентов: Полная · Экспресс · Беседа; новым первым — «Экспресс».')
    expect(html).toContain('ИИ-помощник анкеты')
    expect(html).toContain('Потолок ИИ-помощника анкеты на клиента (Free), $')
    expect(html).not.toContain('NEXT_PUBLIC_SURVEY_MODES')
  })

  it('a switched-off mode cannot be the default; the stored default that is off is explained', () => {
    const html = render({ survey_chat_enabled: false, survey_modes: { express: true, default_mode: 'chat' } })
    expect(html).not.toMatch(/role="radio"[^>]*>Беседа</)
    expect(html).toContain('«Беседа» сейчас выключен — новым клиентам первым предлагается «Экспресс».')
    expect(html).toContain('ИИ-помощник выключен — потолок сейчас не действует.')
  })

  it('read-only: the switches are disabled', () => {
    expect(render({}, { disabled: true })).toMatch(/aria-label="Экспресс \+ блоки — снимок бизнеса и блоки" disabled=""/)
  })

  it('is on the GIGA settings page', () => {
    const page = readFileSync('app/admin-giga-panel/settings/page.tsx', 'utf8')
    expect(page).toContain('<SurveySettingsCard values={v} meta={meta} disabled={!canEdit} saving={saving} onSave={save} />')
  })
})
