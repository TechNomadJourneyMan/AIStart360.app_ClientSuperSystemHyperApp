/**
 * Mode chooser, switch and banner (spec §5.2) rendered to static markup.
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SurveyModeChooser } from '@/components/onboarding/modes/SurveyModeChooser'
import { SurveyModeSwitch } from '@/components/onboarding/modes/SurveyModeSwitch'
import { SurveyModesBanner } from '@/components/onboarding/modes/SurveyModesBanner'

const noop = () => undefined

describe('SurveyModeChooser', () => {
  // R4-B4: a mode switched off in GIGA is not «coming soon» — it is not shown (was: «Скоро», disabled).
  it('cards of the modes that are on, with PO names and time; nothing «Скоро», nothing disabled', () => {
    const html = renderToStaticMarkup(createElement(SurveyModeChooser, { enabled: ['full', 'express', 'chat'], recommended: 'express', onChoose: noop }))
    expect(html).toContain('Расширенная полная анкета')
    expect(html).toContain('Экспресс + блоки')
    expect(html).toContain('Диагностическая беседа с ИИ')
    expect(html).toContain('~1,5 ч чистого ввода')
    expect(html).toContain('7–9 мин до первичной Точки А')
    expect(html).not.toContain('Скоро')
    expect(html).not.toContain('disabled=""')
    expect(html).toContain('Способ можно сменить в любой момент — ответы сохранятся.')
    const two = renderToStaticMarkup(createElement(SurveyModeChooser, { enabled: ['full', 'express'], recommended: 'express', onChoose: noop }))
    expect(two).not.toContain('Диагностическая беседа с ИИ')
  })

  // R4-B4 (PO, Round 4): the default mode (express) first, one mark «Рекомендуем» (was: «Основная» + «Быстрый старт»).
  it('the recommended mode comes first and alone is marked «Рекомендуем»', () => {
    const html = renderToStaticMarkup(createElement(SurveyModeChooser, { enabled: ['full', 'express', 'chat'], recommended: 'express', onChoose: noop }))
    expect(html.match(/Рекомендуем/g)).toHaveLength(1)
    expect(html.indexOf('Экспресс + блоки')).toBeLessThan(html.indexOf('Расширенная полная анкета'))
    expect(html).not.toContain('Основная</span>')
    const full = renderToStaticMarkup(createElement(SurveyModeChooser, { enabled: ['full', 'express'], recommended: 'full', onChoose: noop }))
    expect(full.indexOf('Расширенная полная анкета')).toBeLessThan(full.indexOf('Экспресс + блоки'))
  })
})

describe('SurveyModeSwitch', () => {
  it('one mode: only «Мои ответы»; several: pressed segments', () => {
    const one = renderToStaticMarkup(createElement(SurveyModeSwitch, { current: 'full', enabled: ['full'] }))
    expect(one).toContain('href="/client/onboarding/answers"')
    expect(one).not.toContain('aria-pressed')
    const many = renderToStaticMarkup(createElement(SurveyModeSwitch, { current: 'express', enabled: ['full', 'express'] }))
    expect(many).toMatch(/aria-pressed="true"[^>]*>Экспресс</)
    expect(many).toMatch(/aria-pressed="false"[^>]*>Полная</)
  })
})

describe('SurveyModesBanner', () => {
  it('names the other modes; nothing when only the full questionnaire exists', () => {
    expect(renderToStaticMarkup(createElement(SurveyModesBanner, { enabled: ['full'], onTry: noop, onDismiss: noop }))).toBe('')
    const html = renderToStaticMarkup(createElement(SurveyModesBanner, { enabled: ['full', 'express', 'chat'], onTry: noop, onDismiss: noop }))
    expect(html).toContain('Новые способы заполнить: быстрый старт и беседа с ИИ-помощником')
    expect(html).toContain('Понятно')
  })
})
