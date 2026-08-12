import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { StoreImportHistory } from '@/components/store/StoreImportHistory'

describe('StoreImportHistory', () => {
  it('renders an honest empty audit state', () => {
    const html = renderToStaticMarkup(createElement(StoreImportHistory, { entries: [] }))
    expect(html).toContain('История публикаций')
    expect(html).toContain('Публикаций пока нет')
    expect(html).toContain('без исходных строк и PII')
  })

  it('renders published and superseded versions without raw row contents', () => {
    const html = renderToStaticMarkup(createElement(StoreImportHistory, {
      entries: [
        {
          id: 'run-1', kind: 'inventory', scopeKey: 'warehouse:astana',
          sourceSha256: 'a'.repeat(64), status: 'published',
          periodStart: '2026-07-31', periodEnd: '2026-07-31', rowCount: 685,
          warningCount: 2, errorCount: 0, publishedAt: '2026-08-12T12:00:00Z',
        },
        {
          id: 'run-0', kind: 'inventory', scopeKey: 'warehouse:astana',
          sourceSha256: 'b'.repeat(64), status: 'superseded',
          periodStart: '2026-07-01', periodEnd: '2026-07-01', rowCount: 680,
          warningCount: 0, errorCount: 0, publishedAt: '2026-08-01T12:00:00Z',
        },
      ],
    }))
    expect(html).toContain('Опубликовано')
    expect(html).toContain('Заменено')
    expect(html).toContain('685')
    expect(html).toContain('aaaaaaaaaaaa…')
    expect(html).not.toContain('raw_payload')
  })
})
