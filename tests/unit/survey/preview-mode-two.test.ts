/**
 * /dev/survey-preview ?mode=express|snapshot|blocks (survey Ф2) renders on
 * every variant without network; the snapshot of the express answers is a
 * PRIMARY Point A computed by the real v4 engine.
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }), useSearchParams: () => new URLSearchParams() }))

const { ModeTwoPreview } = await import('@/app/dev/survey-preview/ModeTwoPreview')
const { SURVEY_PREVIEW_VARIANTS } = await import('@/app/dev/survey-preview/fixture')

const render = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(ModeTwoPreview, props as never))

describe('mode-two preview', () => {
  it('every view of every variant renders', () => {
    for (const variant of SURVEY_PREVIEW_VARIANTS) {
      for (const view of ['express', 'snapshot', 'blocks'] as const) expect(render({ view, variant }).length).toBeGreaterThan(500)
    }
  })
  it('express screen N, phone split', () => {
    expect(render({ view: 'express', variant: 'empty', screen: 7 })).toContain('Экран 7 из 15')
    expect(render({ view: 'express', variant: 'empty', screen: 13, phone: true })).toContain('вопрос 1 из 5')
  })
  it('snapshot of the filled express answers: primary Point A by the v4 engine', () => {
    const html = render({ view: 'snapshot', variant: 'filled' })
    expect(html).toContain('Первичная · по быстрым данным')
    expect(html).toContain('Общий балл')
  })
  it('a block page', () => {
    expect(render({ view: 'blocks', variant: 'half', block: 'b5' })).toContain('Продажи и воронка')
  })
})
