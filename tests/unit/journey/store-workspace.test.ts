import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { StoreJourneyWorkspace } from '@/components/journey/StoreJourneyWorkspace'
import { createEmptyWorkspace } from '@/components/journey/model'

describe('Store Journey surface', () => {
  it('links directly to the same company’s protected import and explains account-based device access', () => {
    const html = renderToStaticMarkup(createElement(StoreJourneyWorkspace, {
      companyId: 'company-1', initialState: createEmptyWorkspace('test-store-workspace'),
    }))
    expect(html).toContain('href="/store/imports?companyId=company-1"')
    expect(html).toContain('Загрузить данные магазина через защищённый импорт')
    expect(html).toContain('На другом устройстве войдите в тот же аккаунт')
    expect(html).not.toContain('accessToken')
    expect(html).not.toContain('Одноразовый код')
    expect(html).toContain('Загружаем сохранённый путь')
  })
})
