/**
 * documentStatusView (lib/documents/status-view.ts): a documents row → what the
 * client sees. Shows only what the server reports; an empty extraction is
 * never a success; rejected / needs_ocr / error carry the server's reason.
 */
import { describe, expect, it } from 'vitest'
import {
  documentSize,
  documentStatusView,
  emptyReasonOf,
  EMPTY_RESULT_LABEL,
  formatDocumentSize,
  isDocumentInFlight,
  NEEDS_OCR_LABEL,
  pipelineStepIndex,
  STAGE_LABELS,
  type ClientDocument,
} from '@/lib/documents/status-view'

const NOW = Date.parse('2026-10-06T12:00:00Z')

function doc(over: Partial<ClientDocument> = {}): ClientDocument {
  return {
    id: 'd1',
    file_name: 'pl.xlsx',
    doc_type: 'pl_report',
    parse_status: 'queued',
    processing_stage: 'validated',
    security_status: 'clean',
    attempts: 0,
    uploaded_at: '2026-10-06T11:58:00Z',
    updated_at: '2026-10-06T11:58:00Z',
    parsed_data: null,
    ...over,
  }
}

describe('documentStatusView', () => {
  it('queued + validated: in flight, «Проверен» reached, no reprocess yet', () => {
    const v = documentStatusView(doc(), NOW)
    expect(v.label).toBe('В очереди на обработку')
    expect(v.tone).toBe('neutral')
    expect(v.inFlight).toBe(true)
    expect(v.stalled).toBe(false)
    expect(v.canReprocess).toBe(false)
    expect(v.stage).toBe('validated')
    expect(v.stageLabel).toBe('Проверен')
    expect(pipelineStepIndex(v)).toBe(0)
  })

  it('queued longer than the stale threshold → stalled, may be started manually', () => {
    const v = documentStatusView(doc({ updated_at: '2026-10-06T11:00:00Z' }), NOW)
    expect(v.stalled).toBe(true)
    expect(v.canReprocess).toBe(true)
    expect(v.inFlight).toBe(true)
  })

  it('requeued by the reaper shows the server explanation', () => {
    const v = documentStatusView(doc({
      attempts: 1,
      last_error_code: 'REAPED',
      parse_error: 'Обработка прервалась — документ поставлен в очередь повторно.',
    }), NOW)
    expect(v.detail).toBe('Обработка прервалась — документ поставлен в очередь повторно.')
  })

  it.each([
    ['parsing', 'Чтение'],
    ['extracting', 'Извлечение данных'],
    ['binding', 'Привязка к метрикам'],
  ] as const)('processing at %s → label «%s»', (stage, label) => {
    const v = documentStatusView(doc({ parse_status: 'processing', processing_stage: stage, attempts: 1 }), NOW)
    expect(v.label).toBe(label)
    expect(v.tone).toBe('progress')
    expect(v.inFlight).toBe(true)
    expect(v.canReprocess).toBe(false)
    expect(v.detail).toBeNull()
    expect(STAGE_LABELS[stage]).toBe(label)
  })

  it('processing retry shows the attempt number', () => {
    const v = documentStatusView(doc({ parse_status: 'processing', processing_stage: 'parsing', attempts: 3 }), NOW)
    expect(v.detail).toBe('Попытка 3')
  })

  it('parsed with facts → «Обработан» with real counts and warnings', () => {
    const v = documentStatusView(doc({
      parse_status: 'parsed',
      processing_stage: 'done',
      parsed_data: {
        fields: [{ key: 'revenue' }],
        stats: { field_count: 12, row_count: 340, unverified_count: 2 },
        warnings: ['2 значений не подтверждены цитатой из документа и не используются в метриках.'],
        coverage: { partial: true },
        unverified_fields: [{ key: 'a' }, { key: 'b' }],
      },
    }), NOW)
    expect(v.label).toBe('Обработан')
    expect(v.tone).toBe('success')
    expect(v.detail).toBe('Извлечено: 12 показателей · 340 строк')
    expect(v.fieldCount).toBe(12)
    expect(v.rowCount).toBe(340)
    expect(v.unverifiedCount).toBe(2)
    expect(v.partial).toBe(true)
    expect(v.warnings).toHaveLength(1)
    expect(v.inFlight).toBe(false)
    expect(v.canReprocess).toBe(true)
  })

  it.each(['NO_FACTS', 'UNVERIFIED_ONLY', 'EMPTY_DOCUMENT'])(
    'parsed with empty_reason %s → never a success',
    (code) => {
      const message = 'Текст прочитан, но бизнес-показатели в нём не найдены.'
      for (const status of ['parsed', 'completed']) {
        const v = documentStatusView(doc({
          parse_status: status,
          processing_stage: 'done',
          parsed_data: { fields: [], empty_reason: { code, message }, stats: { field_count: 0, row_count: 0 } },
        }), NOW)
        expect(v.label).toBe(EMPTY_RESULT_LABEL)
        expect(v.label).not.toBe('Обработан')
        expect(v.tone).toBe('warning')
        expect(v.detail).toBe(message)
        expect(v.emptyReasonCode).toBe(code)
      }
    },
  )

  it('needs_ocr → scan label + server text', () => {
    const v = documentStatusView(doc({
      parse_status: 'needs_ocr',
      processing_stage: 'done',
      parse_error: 'Документ — скан или фото без текстового слоя.',
      parsed_data: { empty_reason: { code: 'NEEDS_OCR', message: 'Документ — скан или фото без текстового слоя.' } },
    }), NOW)
    expect(v.label).toBe(NEEDS_OCR_LABEL)
    expect(v.label).toBe('Скан без текстового слоя — распознавание недоступно')
    expect(v.detail).toBe('Документ — скан или фото без текстового слоя.')
    expect(v.tone).toBe('warning')
    expect(v.emptyReasonCode).toBe('NEEDS_OCR')
  })

  it('rejected → security reason, never reprocessable', () => {
    const v = documentStatusView(doc({
      parse_status: 'rejected',
      processing_stage: 'failed',
      security_status: 'rejected',
      security_reason: 'Файл .pdf на самом деле исполняемый файл (Windows (EXE/DLL)). Такие файлы не принимаются.',
      parse_error: 'другое',
    }), NOW)
    expect(v.label).toBe('Отклонён проверкой')
    expect(v.tone).toBe('error')
    expect(v.detail).toContain('исполняемый файл')
    expect(v.canReprocess).toBe(false)
    expect(v.inFlight).toBe(false)
  })

  it('security_status rejected wins over any parse_status', () => {
    const v = documentStatusView(doc({ parse_status: 'parsed', security_status: 'rejected', security_reason: null, parse_error: 'Макросы' }), NOW)
    expect(v.label).toBe('Отклонён проверкой')
    expect(v.detail).toBe('Макросы')
  })

  it('error → server message, else the error code', () => {
    const a = documentStatusView(doc({ parse_status: 'error', processing_stage: 'failed', parse_error: 'Не удалось прочитать PDF.' }), NOW)
    expect(a.label).toBe('Ошибка обработки')
    expect(a.detail).toBe('Не удалось прочитать PDF.')
    expect(a.canReprocess).toBe(true)
    expect(a.stageLabel).toBe('Ошибка')
    const b = documentStatusView(doc({ parse_status: 'error', parse_error: null, last_error_code: 'MAX_ATTEMPTS' }), NOW)
    expect(b.detail).toBe('Код ошибки: MAX_ATTEMPTS')
  })

  it('unknown status is shown as reported, not as success', () => {
    const v = documentStatusView(doc({ parse_status: 'weird' }), NOW)
    expect(v.label).toBe('Статус: weird')
    expect(v.tone).toBe('neutral')
    expect(documentStatusView(doc({ parse_status: null }), NOW).label).toBe('Статус не указан')
  })

  it('legacy parsed rows without stats count their fields', () => {
    const v = documentStatusView(doc({ parse_status: 'parsed', parsed_data: { fields: [{}, {}, {}] } }), NOW)
    expect(v.detail).toBe('Извлечено: 3 показателя')
    expect(documentStatusView(doc({ parse_status: 'parsed', parsed_data: null }), NOW).detail).toBeNull()
  })
})

describe('helpers', () => {
  it('isDocumentInFlight', () => {
    expect(isDocumentInFlight({ parse_status: 'queued' })).toBe(true)
    expect(isDocumentInFlight({ parse_status: 'processing' })).toBe(true)
    for (const s of ['parsed', 'completed', 'error', 'needs_ocr', 'rejected', null]) {
      expect(isDocumentInFlight({ parse_status: s })).toBe(false)
    }
  })

  it('emptyReasonOf ignores missing / malformed markers', () => {
    expect(emptyReasonOf(null)).toBeNull()
    expect(emptyReasonOf({ empty_reason: null })).toBeNull()
    expect(emptyReasonOf({ empty_reason: 'x' })).toBeNull()
    expect(emptyReasonOf({ empty_reason: { code: 'NO_FACTS', message: 'm' } })).toEqual({ code: 'NO_FACTS', message: 'm' })
  })

  it('processing stage index follows the server order', () => {
    const at = (stage: string) => pipelineStepIndex(documentStatusView(doc({ parse_status: 'processing', processing_stage: stage }), NOW))
    expect(at('parsing')).toBe(1)
    expect(at('extracting')).toBe(2)
    expect(at('binding')).toBe(3)
    expect(at('uploaded')).toBe(-1)
  })

  it('formats sizes', () => {
    expect(formatDocumentSize(null)).toBe('')
    expect(formatDocumentSize(512)).toBe('512 Б')
    expect(formatDocumentSize(2048)).toBe('2 КБ')
    expect(formatDocumentSize(5 * 1024 * 1024)).toBe('5.0 МБ')
    expect(documentSize({ size_bytes: 10, file_size: 20 })).toBe(10)
    expect(documentSize({ size_bytes: null, file_size: 20 })).toBe(20)
  })
})
