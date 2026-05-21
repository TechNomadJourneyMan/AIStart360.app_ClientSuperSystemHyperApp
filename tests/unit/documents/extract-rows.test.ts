import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  extractSalesRows,
  extractClientRows,
  normalizePhone,
  parseAmount,
  parseDateIso,
  __internal,
} from '@/lib/documents/extract-rows'

// Sanity guard: tests must never reach OpenRouter. If anything tries to fetch,
// fail loudly.
const fetchSpy = vi.spyOn(global, 'fetch')

beforeEach(() => {
  fetchSpy.mockReset()
  // Make absolutely sure no AI fallback fires from within these tests.
  delete process.env.OPENROUTER_API_KEY
})

afterEach(() => {
  fetchSpy.mockReset()
})

describe('normalizePhone', () => {
  it('normalises "8 707 555 1234" to "77075551234"', () => {
    expect(normalizePhone('8 707 555 1234')).toBe('77075551234')
  })

  it('normalises "+7 (707) 555-12-34" to "77075551234"', () => {
    expect(normalizePhone('+7 (707) 555-12-34')).toBe('77075551234')
  })

  it('normalises a bare 10-digit number with leading "707"', () => {
    expect(normalizePhone('707 555 1234')).toBe('77075551234')
  })

  it('returns null for non-phone input', () => {
    expect(normalizePhone('abc')).toBe(null)
    expect(normalizePhone('')).toBe(null)
  })
})

describe('parseAmount', () => {
  it('strips ₸ / тг / тенге tokens', () => {
    expect(parseAmount('1 250 000 ₸')).toBe(1250000)
    expect(parseAmount('1 250 000 тг')).toBe(1250000)
    expect(parseAmount('1250000 тенге')).toBe(1250000)
    expect(parseAmount('1250000 KZT')).toBe(1250000)
  })

  it('handles european decimals "1.250,50"', () => {
    expect(parseAmount('1.250,50')).toBe(1250.5)
  })

  it('handles american decimals "1,250.50"', () => {
    expect(parseAmount('1,250.50')).toBe(1250.5)
  })

  it('returns null for unparseable input', () => {
    expect(parseAmount('not a number')).toBe(null)
    expect(parseAmount('')).toBe(null)
  })
})

describe('parseDateIso', () => {
  it('normalises DD.MM.YYYY (Russian)', () => {
    expect(parseDateIso('21.05.2026')).toBe('2026-05-21T00:00:00.000Z')
  })

  it('normalises DD/MM/YYYY', () => {
    expect(parseDateIso('21/05/2026')).toBe('2026-05-21T00:00:00.000Z')
  })

  it('passes ISO through', () => {
    expect(parseDateIso('2026-05-21T10:00:00Z')).toBe('2026-05-21T10:00:00.000Z')
  })

  it('returns null for garbage', () => {
    expect(parseDateIso('хз когда')).toBe(null)
  })
})

describe('extractSalesRows — Russian CSV happy path', () => {
  it('parses 10 rows from a "Дата;Клиент;Сумма;Менеджер" CSV', async () => {
    const csv = [
      'Дата;Клиент;Сумма;Менеджер;Продукт',
      '01.01.2026;Клиент-1;240000 ₸;Аида;AIStart360 Pro',
      '02.01.2026;Клиент-2;480000 ₸;Еркин;AIStart360 Team',
      '03.01.2026;Клиент-3;1200000 ₸;Камила;AIStart360 Enterprise',
      '04.01.2026;Клиент-4;350000 ₸;Руслан;Внедрение',
      '05.01.2026;Клиент-5;25000 ₸;Аида;Консалтинг (час)',
      '06.01.2026;Клиент-6;180000 ₸;Еркин;Дата-пакет',
      '07.01.2026;Клиент-1;240000 ₸;Аида;AIStart360 Pro',
      '08.01.2026;Клиент-2;480000 ₸;Еркин;AIStart360 Team',
      '09.01.2026;Клиент-7;1200000 ₸;Камила;AIStart360 Enterprise',
      '10.01.2026;Клиент-8;350000 ₸;Руслан;Внедрение',
    ].join('\n')

    const rows = await extractSalesRows(csv, {
      fileName: 'sales.csv',
      mimeType: 'text/csv',
    })

    expect(rows).toHaveLength(10)
    // Spot-check types and normalisation.
    for (const r of rows) {
      expect(typeof r.client_id).toBe('string')
      expect(typeof r.amount).toBe('number')
      expect(r.amount).toBeGreaterThan(0)
      expect(r.occurred_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    }
    expect(rows[0].client_name).toBe('Клиент-1')
    expect(rows[0].manager_name).toBe('Аида')
    expect(rows[0].product_name).toBe('AIStart360 Pro')
    expect(rows[0].amount).toBe(240000)
    expect(rows[0].occurred_at).toBe('2026-01-01T00:00:00.000Z')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('normalises a Телефон column into client_id and strips formatting', async () => {
    const csv = [
      'Дата,Телефон,Сумма',
      '21.05.2026,8 707 555 1234,250000 ₸',
      '21.05.2026,+7 (707) 555-12-35,250000 тг',
    ].join('\n')

    const rows = await extractSalesRows(csv, {
      fileName: 'phones.csv',
      mimeType: 'text/csv',
    })
    expect(rows).toHaveLength(2)
    expect(rows[0].client_id).toBe('77075551234')
    expect(rows[1].client_id).toBe('77075551235')
  })
})

describe('extractSalesRows — degenerate inputs', () => {
  it('returns [] for an empty CSV', async () => {
    const rows = await extractSalesRows('', {
      fileName: 'empty.csv',
      mimeType: 'text/csv',
    })
    expect(rows).toEqual([])
  })

  it('returns [] for a CSV that has headers but no body', async () => {
    const rows = await extractSalesRows('Дата;Клиент;Сумма\n', {
      fileName: 'headers_only.csv',
      mimeType: 'text/csv',
    })
    expect(rows).toEqual([])
  })

  it('returns [] when required columns are missing (no key + no AI fallback)', async () => {
    // Only "Категория" → none of {amount, occurred_at, client_id/name/phone} present.
    const csv = 'Категория;Описание\nUSB;кабель'
    const rows = await extractSalesRows(csv, {
      fileName: 'no_required.csv',
      mimeType: 'text/csv',
    })
    expect(rows).toEqual([])
    // No OPENROUTER_API_KEY → AI fallback must short-circuit, not actually fetch.
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('extractClientRows — happy path', () => {
  it('parses client_base rows from a Russian CSV', async () => {
    const csv = [
      'Клиент;Дата первой покупки;Дата последней покупки;Общая сумма;Покупок',
      'Клиент-1;01.01.2024;15.05.2026;1 250 000 ₸;5',
      'Клиент-2;10.02.2024;20.04.2026;800 000 ₸;3',
    ].join('\n')

    const rows = await extractClientRows(csv, {
      fileName: 'clients.csv',
      mimeType: 'text/csv',
    })
    expect(rows).toHaveLength(2)
    expect(rows[0].name).toBe('Клиент-1')
    expect(rows[0].total_spent_kzt).toBe(1250000)
    expect(rows[0].purchase_count).toBe(5)
    expect(rows[0].first_purchase_date).toBe('2024-01-01T00:00:00.000Z')
    expect(rows[0].last_purchase_date).toBe('2026-05-15T00:00:00.000Z')
  })

  it('returns [] when required columns are missing', async () => {
    const csv = 'Клиент;Город\nКлиент-1;Алматы'
    const rows = await extractClientRows(csv, {
      fileName: 'no_cols.csv',
      mimeType: 'text/csv',
    })
    expect(rows).toEqual([])
  })
})

describe('header matching internals', () => {
  it('maps Russian synonyms to canonical keys', () => {
    expect(__internal.matchHeader('Дата')).toBe('occurred_at')
    expect(__internal.matchHeader('Сумма')).toBe('amount')
    expect(__internal.matchHeader('Клиент')).toBe('client_name')
    expect(__internal.matchHeader('Покупатель')).toBe('client_name')
    expect(__internal.matchHeader('Менеджер')).toBe('manager_name')
    expect(__internal.matchHeader('Ответственный')).toBe('manager_name')
    expect(__internal.matchHeader('Продукт')).toBe('product_name')
    expect(__internal.matchHeader('Услуга')).toBe('product_name')
    expect(__internal.matchHeader('Телефон')).toBe('phone')
  })

  it('detects ";" as a delimiter when more frequent than ","', () => {
    expect(__internal.detectDelimiter('a;b;c;d')).toBe(';')
    expect(__internal.detectDelimiter('a,b,c,d')).toBe(',')
  })
})
