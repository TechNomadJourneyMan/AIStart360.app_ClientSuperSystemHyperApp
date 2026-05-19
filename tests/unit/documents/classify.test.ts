import { describe, it, expect } from 'vitest'
import { classifyDocument } from '@/lib/documents/classify'

describe('classifyDocument — happy paths', () => {
  it('classifies a Russian P&L filename + text as pl_report with confidence > 0.5', () => {
    const result = classifyDocument({
      fileName: 'PnL_отчет_Q1_2026.xlsx',
      textPreview:
        'Отчет о прибылях и убытках за Q1 2026. Выручка составила 12 500 000 руб. Себестоимость — 7 200 000 руб. Чистая прибыль — 3 100 000 руб. EBITDA положительная.',
    })

    expect(result.docType).toBe('pl_report')
    expect(result.confidence).toBeGreaterThan(0.5)
  })

  it('detects marketing_report from text-only signals', () => {
    const result = classifyDocument({
      fileName: 'monthly_review.pdf',
      textPreview:
        'Маркетинг за апрель: CTR 2.4%, CPC 18 руб, ROAS 4.7. Клики и показы по основным каналам.',
    })

    expect(result.docType).toBe('marketing_report')
  })

  it('detects patient_base from medical filename', () => {
    const result = classifyDocument({
      fileName: 'patient_base_2026_clinic.csv',
      textPreview: 'ФИО,Дата рождения,Диагноз\nИванов,1990-01-01,J20',
    })

    expect(result.docType).toBe('patient_base')
  })

  it('detects pricelist from Russian text', () => {
    const result = classifyDocument({
      fileName: 'document_42.pdf',
      textPreview:
        'Прайс-лист на услуги клиники. Наименование, цена, руб. Консультация терапевта — 2500. УЗИ органов брюшной полости — 3800.',
    })

    expect(result.docType).toBe('pricelist')
  })
})

describe('classifyDocument — declared override', () => {
  it('keeps declaredDocType=balance_sheet on ambiguous text', () => {
    const result = classifyDocument({
      fileName: 'unknown.xlsx',
      textPreview: 'Some neutral content with numbers and headers.',
      declaredDocType: 'balance_sheet',
    })

    expect(result.docType).toBe('balance_sheet')
  })

  it("ignores declaredDocType='other' — no prior applied", () => {
    const result = classifyDocument({
      fileName: 'marketing_april.pdf',
      textPreview: 'CTR, CPC, ROAS, клики, маркетинг.',
      declaredDocType: 'other',
    })

    expect(result.docType).toBe('marketing_report')
  })

  it('lets strong text evidence override a weak declared prior', () => {
    // Declared pl_report has no supporting signal; text is overwhelmingly a balance sheet.
    const result = classifyDocument({
      fileName: 'q1_report.xlsx',
      textPreview:
        'Итого активы: 50 000 000. Итого пассивы: 50 000 000. Собственный капитал, обязательства, долгосрочные и краткосрочные. Balance sheet snapshot. Total assets, total liabilities, equity.',
      declaredDocType: 'pl_report',
    })

    expect(result.docType).toBe('balance_sheet')
  })
})

describe('classifyDocument — edge cases', () => {
  it('returns other with confidence 0 on empty input', () => {
    const result = classifyDocument({ fileName: '', textPreview: '' })

    expect(result.docType).toBe('other')
    expect(result.confidence).toBe(0)
    expect(result.reasoning).toMatch(/Недостаточно/i)
  })

  it('returns reasoning that is non-empty and contains Russian characters for top picks', () => {
    const result = classifyDocument({
      fileName: 'pnl.xlsx',
      textPreview: 'выручка чистая прибыль себестоимость',
    })

    expect(result.reasoning.length).toBeGreaterThan(0)
    // Reasoning for a positive hit should contain Cyrillic.
    expect(/[А-Яа-яЁё]/.test(result.reasoning)).toBe(true)
  })

  it('returns exactly 5 entries in scores list', () => {
    const result = classifyDocument({
      fileName: 'pnl.xlsx',
      textPreview: 'выручка себестоимость чистая прибыль',
    })

    expect(result.scores).toHaveLength(5)
    // Sorted descending by score.
    for (let i = 1; i < result.scores.length; i++) {
      expect(result.scores[i - 1].score).toBeGreaterThanOrEqual(
        result.scores[i].score,
      )
    }
  })
})

describe('classifyDocument — additional coverage', () => {
  it('classifies a CRM export', () => {
    const result = classifyDocument({
      fileName: 'amocrm_deals_export_2026.csv',
      textPreview:
        'Сделка,Клиент,Этап воронки,Ответственный,Сумма\n123,ООО Ромашка,Переговоры,Иванов,250000',
    })

    expect(result.docType).toBe('crm_export')
  })

  it('classifies a sales script', () => {
    const result = classifyDocument({
      fileName: 'call_script_v2.docx',
      textPreview:
        'Скрипт продаж. Приветствие. Возражения клиента и их обработка. Диалог с клиентом.',
    })

    expect(result.docType).toBe('scripts')
  })

  it('classifies a brand guidelines doc', () => {
    const result = classifyDocument({
      fileName: 'brandbook_2026.pdf',
      textPreview:
        'Брендбук компании. Tone of voice, фирменный стиль, логотип, цветовая палитра.',
    })

    expect(result.docType).toBe('brand_rules')
  })

  it('prefers a more specific type on a tie', () => {
    // Both `services_catalog` and `financial_report` get a single filename hit
    // (and zero text hits). Tie-broken by specificity → services_catalog wins.
    const result = classifyDocument({
      fileName: 'service_financial.bin',
      textPreview: '',
    })

    expect(result.docType).toBe('services_catalog')
  })
})
