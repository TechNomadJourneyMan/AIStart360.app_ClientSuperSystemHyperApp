/**
 * «Отчёты» / «Проверка выводов ИИ» view model (components/giga-panel/reports/model.ts).
 */
import { describe, expect, it } from 'vitest'
import {
  createdByLabel, fmtConfidence, provenanceMeta, reportStatusMeta, severityMeta, shortHash, versionActions,
} from '@/components/giga-panel/reports/model'
import { PROVENANCE_LABELS, REPORT_STATUSES } from '@/lib/reports/types'

describe('reports view model', () => {
  it('every report status has a Russian label; unknown ones are shown as is', () => {
    for (const st of REPORT_STATUSES) expect(reportStatusMeta(st).label).not.toBe(st)
    expect(reportStatusMeta('ready')).toMatchObject({ label: 'Готов к проверке', tone: 'amber' })
    expect(reportStatusMeta('published')).toMatchObject({ label: 'Опубликован', tone: 'green' })
    expect(reportStatusMeta('weird').label).toBe('weird')
  })

  it('provenance badges use the report labels', () => {
    expect(provenanceMeta('INFERRED').label).toBe('Вывод по правилам')
    expect(provenanceMeta('AI_HYPOTHESIS')).toMatchObject({ label: PROVENANCE_LABELS.AI_HYPOTHESIS, tone: 'violet' })
    expect(severityMeta('critical')).toMatchObject({ label: 'Критично', tone: 'red' })
  })

  it('formats confidence, hash and producer', () => {
    expect(fmtConfidence(0.625)).toBe('63%')
    expect(fmtConfidence(null)).toBe('—')
    expect(shortHash('0123456789abcdef')).toBe('0123456789')
    expect(createdByLabel('agent:report')).toBe('агент «Отчёт»')
    expect(createdByLabel('11111111-2222-3333-4444-555555555555')).toBe('сотрудник 11111111')
  })

  it('offers only the transitions the status allows, and none without the right', () => {
    expect(versionActions('ready', true)).toEqual(['publish', 'reject'])
    expect(versionActions('published', true)).toEqual(['withdraw'])
    expect(versionActions('superseded', true)).toEqual([])
    expect(versionActions('ready', false)).toEqual([])
  })
})

describe('AI review copy (#33)', () => {
  it('says approval exposes the item to the client at once, not only after a published report', async () => {
    const { AI_REVIEW_COPY } = await import('@/components/giga-panel/reports/model')
    for (const text of [AI_REVIEW_COPY.approveDialog('finding'), AI_REVIEW_COPY.approveDialog('recommendation'), AI_REVIEW_COPY.approveToast, AI_REVIEW_COPY.header]) {
      expect(text).toMatch(/сразу|уже видит/)
    }
    expect(AI_REVIEW_COPY.approveDialog('finding')).toContain('«Точке А»')
  })

  it('the review page no longer promises a second gate before the client sees an approved item', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('components/giga-panel/reports/AiReviewPage.tsx', 'utf8')
    expect(src).not.toMatch(/клиент увидит это после следующей сборки/i)
    expect(src).not.toContain('после следующей сборки и публикации отчёта.')
    expect(src).toContain('AI_REVIEW_COPY.approveDialog(')
  })
})
