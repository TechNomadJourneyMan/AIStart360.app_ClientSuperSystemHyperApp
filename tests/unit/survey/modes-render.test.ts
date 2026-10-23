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
  it('three cards with PO names and time; unavailable modes are «Скоро» and disabled', () => {
    const html = renderToStaticMarkup(createElement(SurveyModeChooser, { enabled: ['full'], recommended: 'full', onChoose: noop }))
    expect(html).toContain('Расширенная полная анкета')
    expect(html).toContain('Экспресс + блоки')
    expect(html).toContain('Диагностическая беседа с ИИ')
    expect(html).toContain('~1,5 ч чистого ввода')
    expect(html).toContain('7–9 мин до первичной Точки А')
    expect(html.match(/Скоро/g)).toHaveLength(2)
    expect(html.match(/disabled=""/g)).toHaveLength(2)
    expect(html).toContain('Способ можно сменить в любой момент — ответы сохранятся.')
  })

  it('the full questionnaire is marked main, the recommended quick mode «Быстрый старт»', () => {
    const html = renderToStaticMarkup(createElement(SurveyModeChooser, { enabled: ['full', 'express', 'chat'], recommended: 'express', onChoose: noop }))
    expect(html.match(/Основная/g)).toHaveLength(1)
    expect(html.match(/Быстрый старт/g)).toHaveLength(1)
    expect(html).not.toContain('Скоро')
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
