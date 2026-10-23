/**
 * Deepening blocks rendered (spec §7.4): header «зачем → что получите», time,
 * progress, questions from the registry, tables → the full form, twins,
 * calcs, «Что изменилось в Точке А», «Следующий блок»; the list with
 * recommended blocks first.
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { BlockPage } from '@/components/onboarding/blocks/BlockPage'
import { BlockList } from '@/components/onboarding/blocks/BlockList'
import { surveyBlock } from '@/lib/survey/questions'
import { blockV4Impact, recommendedBlocks } from '@/lib/survey/blocks'
import { previewAnswers } from '@/app/dev/survey-preview/fixture'

const noop = () => undefined
const page = (id: string, answers: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(BlockPage, { block: surveyBlock(id)!, answers, onChange: noop, onSave: noop, next: surveyBlock('b12'), onNext: noop, impact: [], ...extra }))

describe('BlockPage', () => {
  it('header, every question of the block once, progress', () => {
    const html = page('b11')
    expect(html).toContain('Финансы')
    expect(html).toContain('Зачем:</span> Прибыль, расходы, учёт, налоги, дебиторка')
    expect(html).toContain('что получите:</span> Блок «Финансы» до полной оценки')
    expect(html).toContain('~7 мин · Заполнено 0 из 21')
    expect(html.match(/data-question=/g)).toHaveLength(21)
  })

  it('a table links to the full questionnaire', () => {
    expect(page('b10')).toContain('href="/client/onboarding?step=8#s8n_metrics_table"')
  })

  it('the twin of a block offers the express answer', () => {
    const html = page('b13', { s4m_hours_on_ops: 6 })
    expect(html).toContain('Вы уже ответили на похожий вопрос')
  })

  it('block calcs on filled answers; «Что изменилось в Точке А» with the linked v4 blocks', () => {
    const v4 = [{ key: 'finance', title: 'Финансы', score: null, status: 'insufficient_data', coverage: 0.41 }, { key: 'team', title: 'Команда', score: 60, status: 'ok', coverage: 0.8 }]
    const html = page('b11', previewAnswers('filled'), { impact: blockV4Impact(surveyBlock('b11')!, v4) })
    expect(html).toContain('data-calc="expense_structure"')
    expect(html).toContain('полнота 41 %')
    expect(html).not.toContain('Команда</span>')
    expect(html).toContain('Следующий блок: Команда и управление')
  })
})

describe('BlockList', () => {
  it('15 blocks, the recommended three first and marked', () => {
    const html = renderToStaticMarkup(createElement(BlockList, { answers: {}, recommended: recommendedBlocks({}) }))
    expect(html.match(/data-block=/g)).toHaveLength(15)
    const order = [...html.matchAll(/data-block="(b\d+)"/g)].map((m) => m[1])
    expect(order.slice(0, 3)).toEqual(['b10', 'b11', 'b5'])
    expect(html.match(/Рекомендуем/g)).toHaveLength(3)
  })
})
