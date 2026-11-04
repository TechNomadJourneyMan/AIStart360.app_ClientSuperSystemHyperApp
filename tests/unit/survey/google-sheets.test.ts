import { generateKeyPairSync } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SURVEY_SPREADSHEET_ID,
  resetGoogleSheetsTokenCache,
  syncSurveyAnswersToGoogleSheet,
} from '@/lib/google-sheets/survey-sync'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function serviceAccountEnv(): NodeJS.ProcessEnv {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })
  return {
    NODE_ENV: 'test',
    GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL: 'survey-sync@example.iam.gserviceaccount.com',
    GOOGLE_SHEETS_PRIVATE_KEY: privateKey.replace(/\n/g, '\\n'),
  }
}

describe('Google Sheets survey projection', () => {
  beforeEach(() => {
    resetGoogleSheetsTokenCache()
  })

  it('skips cleanly when credentials are not configured', async () => {
    const fetchImpl = vi.fn()
    await expect(
      syncSurveyAnswersToGoogleSheet([], {
        env: { NODE_ENV: 'test' },
        fetchImpl,
      }),
    ).resolves.toEqual({ status: 'skipped', reason: 'not_configured' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('initializes headers, updates existing keys, and appends new keys', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = []
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url
      requests.push({ url, init: init ?? {} })

      if (url === 'https://oauth2.googleapis.com/token') {
        return jsonResponse({ access_token: 'access-token', expires_in: 3600 })
      }
      if (url.includes('?fields=sheets.properties.title')) {
        return jsonResponse({ sheets: [{ properties: { title: 'Лист1' } }] })
      }
      if (url.includes(encodeURIComponent("'Лист1'!A2:A"))) {
        return jsonResponse({ values: [['user-1:existing']] })
      }
      return jsonResponse({})
    }) as unknown as typeof fetch

    const result = await syncSurveyAnswersToGoogleSheet(
      [
        {
          userId: 'user-1',
          companyId: 'company-1',
          step: 2,
          questionKey: 'existing',
          answer: { value: 10 },
          answeredAt: '2026-07-25T12:00:00.000Z',
        },
        {
          userId: 'user-1',
          companyId: null,
          step: 2,
          questionKey: 'new',
          answer: { value: ['a', 'b'] },
          answeredAt: '2026-07-25T12:00:00.000Z',
        },
      ],
      { env: serviceAccountEnv(), fetchImpl },
    )

    expect(result).toEqual({ status: 'synced', synced: 2 })
    expect(requests.some(({ url }) => url.includes(DEFAULT_SURVEY_SPREADSHEET_ID))).toBe(true)

    const tokenRequest = requests.find(({ url }) =>
      url.includes('oauth2.googleapis.com/token'),
    )
    expect(String(tokenRequest?.init.body)).toContain(
      'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer',
    )

    const headerRequest = requests.find(({ url }) =>
      url.includes(encodeURIComponent("'Лист1'!A1:G1")),
    )
    expect(JSON.parse(String(headerRequest?.init.body))).toEqual({
      values: [
        [
          'record_key',
          'user_id',
          'company_id',
          'step',
          'question_key',
          'answer_json',
          'answered_at',
        ],
      ],
    })

    const batch = requests.find(({ url }) => url.endsWith('/values:batchUpdate'))
    expect(JSON.parse(String(batch?.init.body))).toMatchObject({
      valueInputOption: 'RAW',
      data: [
        {
          range: "'Лист1'!A2:G2",
          values: [
            [
              'user-1:existing',
              'user-1',
              'company-1',
              2,
              'existing',
              '{"value":10}',
              '2026-07-25T12:00:00.000Z',
            ],
          ],
        },
      ],
    })

    const append = requests.find(({ url }) => url.includes(':append?'))
    expect(JSON.parse(String(append?.init.body))).toEqual({
      values: [
        [
          'user-1:new',
          'user-1',
          '',
          2,
          'new',
          '{"value":["a","b"]}',
          '2026-07-25T12:00:00.000Z',
        ],
      ],
    })
  })

  it('creates the configured tab when it does not exist', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = []
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url
      requests.push({ url, init: init ?? {} })
      if (url.includes('oauth2.googleapis.com/token')) {
        return jsonResponse({ access_token: 'token', expires_in: 3600 })
      }
      if (url.includes('?fields=sheets.properties.title')) {
        return jsonResponse({ sheets: [] })
      }
      if (url.includes(encodeURIComponent("'Answers'!A2:A"))) {
        return jsonResponse({})
      }
      return jsonResponse({})
    }) as unknown as typeof fetch

    await syncSurveyAnswersToGoogleSheet(
      [
        {
          userId: 'u',
          companyId: null,
          step: 1,
          questionKey: 'q',
          answer: { value: true },
          answeredAt: '2026-07-25T00:00:00.000Z',
        },
      ],
      {
        env: {
          ...serviceAccountEnv(),
          GOOGLE_SHEETS_SHEET_NAME: 'Answers',
        },
        fetchImpl,
      },
    )

    const createTab = requests.find(({ url }) => url.endsWith(':batchUpdate'))
    expect(JSON.parse(String(createTab?.init.body))).toEqual({
      requests: [{ addSheet: { properties: { title: 'Answers' } } }],
    })
  })

  it('reports sanitized Google API status errors', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ error: { message: 'sensitive provider detail' } }, 403),
    ) as unknown as typeof fetch

    await expect(
      syncSurveyAnswersToGoogleSheet(
        [
          {
            userId: 'u',
            companyId: null,
            step: 1,
            questionKey: 'q',
            answer: { value: 1 },
            answeredAt: '2026-07-25T00:00:00.000Z',
          },
        ],
        { env: serviceAccountEnv(), fetchImpl },
      ),
    ).rejects.toThrow('Google Sheets API request failed with status 403')
  })
})
