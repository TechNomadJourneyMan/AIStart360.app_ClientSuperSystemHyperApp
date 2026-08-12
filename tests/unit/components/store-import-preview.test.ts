import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  StoreImportPreviewView,
  storeImportErrorMessage,
  storeImportPublishErrorMessage,
  type StoreImportPreviewData,
  type StoreImportPublishResult,
} from '@/components/store/StoreImportPreview'

const noop = () => undefined

function render(props: Partial<Parameters<typeof StoreImportPreviewView>[0]> = {}) {
  return renderToStaticMarkup(createElement(StoreImportPreviewView, {
    phase: 'idle',
    selectedFileName: null,
    errorMessage: null,
    data: null,
    inputId: 'store-import-file',
    onReset: noop,
    ...props,
  }))
}

const preview: StoreImportPreviewData = {
  ready: true,
  schemaVersion: 1,
  normalizedSha256: 'b'.repeat(64),
  fileName: 'sales-july.xlsx',
  sha256: 'a'.repeat(64),
  kind: 'sales',
  sheetName: 'Продажи',
  rowCount: 1_200,
  acceptedRows: 1_190,
  quarantinedRows: 10,
  headers: ['Товар', 'Выручка'],
  detectedColumns: { 'Товар': 'productName', 'Выручка': 'netRevenue' },
  totals: { revenue: 28_053_253 },
  warnings: ['10 строк отправлены в карантин'],
  errors: [],
  previewRows: [{ 'Товар': '<script>alert(1)</script>', 'Выручка': 120_000 }],
}

const publishResult: StoreImportPublishResult = {
  outcome: 'published',
  importRunId: 'run-1',
  importKind: 'sales',
  scopeKey: 'month:2026-07',
  rowCount: 1_190,
  publishedAt: '2026-08-12T12:00:00.000Z',
  quarantinedRows: 10,
}

describe('StoreImportPreviewView', () => {
  it('renders an accessible, honest upload state with the documented limits', () => {
    const html = render()
    expect(html).toContain('accept=".xls,.xlsx,.csv')
    expect(html).toContain('до 4 МБ')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('база данных не изменяется')
    expect(html).toContain('disabled=""')
  })

  it('renders preview quality and blocks publication until required confirmations', () => {
    const html = render({
      phase: 'success',
      selectedFileName: preview.fileName,
      data: preview,
    })
    expect(html).toContain('sales-july.xlsx')
    expect(html).toContain('1 200')
    expect(html).toContain('1 190')
    expect(html).toContain('Карантин')
    expect(html).toContain('Предупреждения (1)')
    expect(html).toContain('Точное сопоставление вариантов')
    expect(html).toContain('Предупреждения проверены')
    expect(html).toContain('Перейти к подтверждению')
    expect(html).toContain('disabled=""')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('requires an explicit effective date for inventory and prices', () => {
    const inventory = { ...preview, kind: 'inventory', warnings: [], quarantinedRows: 0 }
    const blocked = render({
      phase: 'success',
      selectedFileName: inventory.fileName,
      data: inventory,
      confirmVariants: true,
    })
    expect(blocked).toContain('Дата снимка остатков')
    expect(blocked).toContain('type="date"')
    expect(blocked).toContain('required=""')
    expect(blocked).toContain('aria-required="true"')
    expect(blocked).toContain('Заполните обязательную дату')

    const configured = render({
      phase: 'success',
      selectedFileName: inventory.fileName,
      data: inventory,
      effectiveDate: '2026-07-31',
      confirmVariants: true,
    })
    const continueButton = configured.slice(configured.indexOf('Перейти к подтверждению') - 500)
    expect(continueButton).not.toContain('disabled=""')
  })

  it('renders an accessible confirmation and atomic publication progress', () => {
    const confirmation = render({
      phase: 'success',
      selectedFileName: preview.fileName,
      data: preview,
      publishPhase: 'confirmation',
      confirmVariants: true,
      confirmWarnings: true,
    })
    expect(confirmation).toContain('role="dialog"')
    expect(confirmation).toContain('aria-describedby=')
    expect(confirmation).toContain('Подтвердите публикацию')
    expect(confirmation).toContain('Опубликовать 1 190 строк')
    expect(confirmation).toContain('Операция атомарна')

    const publishing = render({
      phase: 'success',
      selectedFileName: preview.fileName,
      data: preview,
      publishPhase: 'publishing',
      confirmVariants: true,
      confirmWarnings: true,
    })
    expect(publishing).toContain('data-testid="store-import-publishing"')
    expect(publishing).toContain('aria-busy="true"')
    expect(publishing).toContain('Публикуем проверенные данные')
  })

  it('distinguishes published, duplicate and retryable error outcomes', () => {
    const published = render({
      phase: 'success',
      selectedFileName: preview.fileName,
      data: preview,
      publishPhase: 'published',
      publishResult,
    })
    expect(published).toContain('data-testid="store-import-published"')
    expect(published).toContain('Данные опубликованы')
    expect(published).toContain('Открыть Магазин')

    const duplicate = render({
      phase: 'success',
      selectedFileName: preview.fileName,
      data: preview,
      publishPhase: 'duplicate',
      publishResult: { ...publishResult, outcome: 'duplicate' },
    })
    expect(duplicate).toContain('data-testid="store-import-duplicate"')
    expect(duplicate).toContain('Файл уже был опубликован')
    expect(duplicate).toContain('строки не продублированы')

    const error = render({
      phase: 'success',
      selectedFileName: preview.fileName,
      data: preview,
      publishPhase: 'error',
      publishErrorMessage: 'Нет соединения с сервером.',
    })
    expect(error).toContain('role="alert"')
    expect(error).toContain('Публикация не выполнена')
    expect(error).toContain('Повторить публикацию')
    expect(error).toContain('Предыдущие опубликованные данные не изменены')
  })

  it('has explicit safe messages for every required server status', () => {
    expect(storeImportErrorMessage(401)).toContain('Сессия истекла')
    expect(storeImportErrorMessage(413)).toContain('4 МБ')
    expect(storeImportErrorMessage(415)).toContain('XLS, XLSX или CSV')
    expect(storeImportErrorMessage(422)).toContain('Структуру файла')
    expect(storeImportErrorMessage(500)).toContain('внутренней ошибки')
    expect(storeImportPublishErrorMessage(403)).toContain('проверкой безопасности')
    expect(storeImportPublishErrorMessage(409, 'preview_stale')).toContain('предпросмотр заново')
    expect(storeImportPublishErrorMessage(422, 'effective_date_required')).toContain('дату снимка')
    expect(storeImportPublishErrorMessage(500)).toContain('Предыдущие данные не изменены')
  })
})
