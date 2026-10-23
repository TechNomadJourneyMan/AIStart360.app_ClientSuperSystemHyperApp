/**
 * «Снимок бизнеса» rendered (spec §7.3): primary label, «данных мало» without
 * v1 scores, «Считаем…», recommended blocks, blind spots, «ответить» links.
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { BusinessSnapshot } from '@/components/onboarding/express/BusinessSnapshot'
import { recommendedBlocks } from '@/lib/survey/blocks'
import { unknownAnswer } from '@/lib/survey/answer-value'
import type { SnapshotPointA } from '@/lib/survey/snapshot'

const b = (key: string, title: string, score: number | null) => ({ key, title, score, status: score === null ? 'insufficient_data' : 'ok' })
const render = (pointA: SnapshotPointA, answers: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(BusinessSnapshot, { answers, pointA, recommended: recommendedBlocks(answers) }))

describe('BusinessSnapshot', () => {
  it('primary Point A: score, label, hint, blocks without data', () => {
    const html = render({ state: 'ready', snapshot: { overall: 58, confidence: 0.45, blocks: [b('operations', 'Операции', 70), b('product', 'Продукт', null)] } })
    expect(html).toContain('Первичная · по быстрым данным')
    expect(html).toContain('Уточните блоки ниже, чтобы оценка стала полной')
    expect(html).toContain('>58</b>')
    expect(html).toContain('данных не хватает')
    expect(html).toContain('href="/client/point-a"')
  })

  it('no v4 overall → «Данных пока мало», no score shown', () => {
    const html = render({ state: 'ready', snapshot: { overall: null, confidence: 0.1, blocks: [b('finance', 'Финансы', null)] } })
    expect(html).toContain('Данных пока мало для общей оценки')
    expect(html).not.toContain('Общий балл')
    expect(html).not.toContain('Первичная · по быстрым данным')
  })

  it('pending → «Считаем Точку А — до минуты»', () => {
    expect(render({ state: 'pending' })).toContain('Считаем Точку А — до минуты')
  })

  it('five numbers with «нет данных · ответить», blind spots, three blocks, documents, the full questionnaire', () => {
    const html = render({ state: 'none' }, { s9n_net_margin: unknownAnswer() })
    expect(html).toContain('href="/client/onboarding/express?key=s1_current_revenue_month"')
    expect(html).toMatch(/не знаю · <a[^>]*href="\/client\/onboarding\/express\?key=s9n_net_margin"/)
    expect(html).toContain('Вы не знаете 1 из 26 цифр быстрого старта')
    expect(html).toContain('href="/client/onboarding/blocks/b10"')
    expect(html).toContain('href="/client/onboarding/blocks/b11"')
    expect(html).toContain('href="/client/onboarding/blocks/b5"')
    expect(html).toContain('Загрузить выгрузки — заполним часть сами')
    expect(html).toContain('Полная анкета — основная')
    expect(html).not.toContain('Продолжить в беседе')
  })
})
