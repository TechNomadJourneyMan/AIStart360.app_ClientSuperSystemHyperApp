import { createSign } from 'node:crypto'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets'
const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets'

export const DEFAULT_SURVEY_SPREADSHEET_ID =
  '1MkJzT1nvAVIyFV7L6dQif3A3v61G6o4TDIIx_kZ7Mo8'
export const DEFAULT_SURVEY_SHEET_NAME = 'Лист1'

const SHEET_HEADERS = [
  'record_key',
  'user_id',
  'company_id',
  'step',
  'question_key',
  'answer_json',
  'answered_at',
] as const

export interface SurveySheetRow {
  userId: string
  companyId: string | null
  step: number
  questionKey: string
  answer: unknown
  answeredAt: string
}

export type SurveySheetSyncResult =
  | { status: 'synced'; synced: number }
  | { status: 'skipped'; reason: 'disabled' | 'not_configured' }

interface GoogleSheetsConfig {
  spreadsheetId: string
  sheetName: string
  clientEmail: string
  privateKey: string
  timeoutMs: number
}

interface ServiceAccountJson {
  client_email?: unknown
  private_key?: unknown
}

type Fetch = typeof fetch

let cachedAccessToken: {
  clientEmail: string
  value: string
  expiresAt: number
} | null = null

function base64Url(value: string | Buffer): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function serviceAccountFromEnv(
  env: NodeJS.ProcessEnv,
): { clientEmail: string; privateKey: string } | null {
  const json = env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON?.trim()
  if (json) {
    let parsed: ServiceAccountJson
    try {
      parsed = JSON.parse(json) as ServiceAccountJson
    } catch {
      throw new Error('GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON is not valid JSON')
    }
    if (
      typeof parsed.client_email !== 'string' ||
      typeof parsed.private_key !== 'string'
    ) {
      throw new Error(
        'GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON must contain client_email and private_key',
      )
    }
    return {
      clientEmail: parsed.client_email,
      privateKey: parsed.private_key.replace(/\\n/g, '\n'),
    }
  }

  const clientEmail = env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL?.trim()
  const privateKey = env.GOOGLE_SHEETS_PRIVATE_KEY?.trim()
  if (!clientEmail && !privateKey) return null
  if (!clientEmail || !privateKey) {
    throw new Error(
      'GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL and GOOGLE_SHEETS_PRIVATE_KEY must be set together',
    )
  }
  return {
    clientEmail,
    privateKey: privateKey.replace(/\\n/g, '\n'),
  }
}

function configFromEnv(env: NodeJS.ProcessEnv): GoogleSheetsConfig | null {
  const serviceAccount = serviceAccountFromEnv(env)
  if (!serviceAccount) return null

  const parsedTimeout = Number(env.GOOGLE_SHEETS_TIMEOUT_MS)
  const timeoutMs =
    Number.isFinite(parsedTimeout) && parsedTimeout >= 1_000 && parsedTimeout <= 30_000
      ? parsedTimeout
      : 8_000

  return {
    ...serviceAccount,
    spreadsheetId:
      env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim() ||
      DEFAULT_SURVEY_SPREADSHEET_ID,
    sheetName:
      env.GOOGLE_SHEETS_SHEET_NAME?.trim() || DEFAULT_SURVEY_SHEET_NAME,
    timeoutMs,
  }
}

function createServiceAccountAssertion(config: GoogleSheetsConfig): string {
  const now = Math.floor(Date.now() / 1_000)
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = base64Url(
    JSON.stringify({
      iss: config.clientEmail,
      scope: GOOGLE_SHEETS_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      iat: now,
      exp: now + 3_600,
    }),
  )
  const unsigned = `${header}.${payload}`
  const signature = createSign('RSA-SHA256')
    .update(unsigned)
    .end()
    .sign(config.privateKey)
  return `${unsigned}.${base64Url(signature)}`
}

async function fetchWithTimeout(
  fetchImpl: Fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function readJson<T>(
  fetchImpl: Fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<T> {
  const response = await fetchWithTimeout(fetchImpl, url, init, timeoutMs)
  if (!response.ok) {
    // Do not include Google's response body: it may echo configuration details.
    throw new Error(`Google Sheets API request failed with status ${response.status}`)
  }
  return (await response.json()) as T
}

async function getAccessToken(
  config: GoogleSheetsConfig,
  fetchImpl: Fetch,
  timeoutMs: number,
): Promise<string> {
  if (
    cachedAccessToken &&
    cachedAccessToken.clientEmail === config.clientEmail &&
    cachedAccessToken.expiresAt > Date.now() + 60_000
  ) {
    return cachedAccessToken.value
  }

  const assertion = createServiceAccountAssertion(config)
  const response = await readJson<{ access_token?: unknown; expires_in?: unknown }>(
    fetchImpl,
    GOOGLE_TOKEN_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
      cache: 'no-store',
    },
    timeoutMs,
  )
  if (typeof response.access_token !== 'string') {
    throw new Error('Google OAuth response did not contain an access token')
  }

  const expiresIn =
    typeof response.expires_in === 'number' && response.expires_in > 0
      ? response.expires_in
      : 3_600
  cachedAccessToken = {
    clientEmail: config.clientEmail,
    value: response.access_token,
    expiresAt: Date.now() + expiresIn * 1_000,
  }
  return response.access_token
}

function quotedSheetName(sheetName: string): string {
  return `'${sheetName.replace(/'/g, "''")}'`
}

function recordKey(row: SurveySheetRow): string {
  return `${row.userId}:${row.questionKey}`
}

function sheetValues(row: SurveySheetRow): Array<string | number> {
  return [
    recordKey(row),
    row.userId,
    row.companyId ?? '',
    row.step,
    row.questionKey,
    JSON.stringify(row.answer),
    row.answeredAt,
  ]
}

async function ensureSheet(
  config: GoogleSheetsConfig,
  fetchImpl: Fetch,
  headers: HeadersInit,
  remainingTimeout: () => number,
): Promise<void> {
  const metadata = await readJson<{
    sheets?: Array<{ properties?: { title?: unknown } }>
  }>(
    fetchImpl,
    `${GOOGLE_SHEETS_API}/${encodeURIComponent(config.spreadsheetId)}?fields=sheets.properties.title`,
    { headers, cache: 'no-store' },
    remainingTimeout(),
  )
  const exists = metadata.sheets?.some(
    (sheet) => sheet.properties?.title === config.sheetName,
  )
  if (exists) return

  await readJson(
    fetchImpl,
    `${GOOGLE_SHEETS_API}/${encodeURIComponent(config.spreadsheetId)}:batchUpdate`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        requests: [{ addSheet: { properties: { title: config.sheetName } } }],
      }),
      cache: 'no-store',
    },
    remainingTimeout(),
  )
}

/**
 * Best-effort projection of authoritative Supabase survey rows into Google
 * Sheets. Rows are keyed by `user_id:question_key`, so a later answer updates
 * the existing Sheet row instead of appending a second logical record.
 */
export async function syncSurveyAnswersToGoogleSheet(
  rows: SurveySheetRow[],
  options: {
    env?: NodeJS.ProcessEnv
    fetchImpl?: Fetch
  } = {},
): Promise<SurveySheetSyncResult> {
  const env = options.env ?? process.env
  if (env.GOOGLE_SHEETS_SYNC_ENABLED?.trim().toLowerCase() === 'false') {
    return { status: 'skipped', reason: 'disabled' }
  }
  const config = configFromEnv(env)
  if (!config) return { status: 'skipped', reason: 'not_configured' }
  if (rows.length === 0) return { status: 'synced', synced: 0 }

  const fetchImpl = options.fetchImpl ?? fetch
  const deadline = Date.now() + config.timeoutMs
  const remainingTimeout = () => Math.max(1, deadline - Date.now())
  const accessToken = await getAccessToken(
    config,
    fetchImpl,
    remainingTimeout(),
  )
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  }
  await ensureSheet(config, fetchImpl, headers, remainingTimeout)

  const spreadsheet = encodeURIComponent(config.spreadsheetId)
  const sheet = quotedSheetName(config.sheetName)
  const valuesBase = `${GOOGLE_SHEETS_API}/${spreadsheet}/values`

  await readJson(
    fetchImpl,
    `${valuesBase}/${encodeURIComponent(`${sheet}!A1:G1`)}?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers,
      body: JSON.stringify({ values: [SHEET_HEADERS] }),
      cache: 'no-store',
    },
    remainingTimeout(),
  )

  const existing = await readJson<{ values?: unknown[][] }>(
    fetchImpl,
    `${valuesBase}/${encodeURIComponent(`${sheet}!A2:A`)}`,
    { headers, cache: 'no-store' },
    remainingTimeout(),
  )
  const rowNumberByKey = new Map<string, number>()
  for (const [index, valueRow] of (existing.values ?? []).entries()) {
    const key = valueRow[0]
    if (typeof key === 'string' && !rowNumberByKey.has(key)) {
      rowNumberByKey.set(key, index + 2)
    }
  }

  const updates: Array<{ range: string; values: Array<Array<string | number>> }> = []
  const appends: Array<Array<string | number>> = []
  for (const row of rows) {
    const rowNumber = rowNumberByKey.get(recordKey(row))
    if (rowNumber) {
      updates.push({
        range: `${sheet}!A${rowNumber}:G${rowNumber}`,
        values: [sheetValues(row)],
      })
    } else {
      appends.push(sheetValues(row))
    }
  }

  if (updates.length > 0) {
    await readJson(
      fetchImpl,
      `${valuesBase}:batchUpdate`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ valueInputOption: 'RAW', data: updates }),
        cache: 'no-store',
      },
      remainingTimeout(),
    )
  }
  if (appends.length > 0) {
    await readJson(
      fetchImpl,
      `${valuesBase}/${encodeURIComponent(`${sheet}!A:G`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ values: appends }),
        cache: 'no-store',
      },
      remainingTimeout(),
    )
  }

  return { status: 'synced', synced: rows.length }
}

/** Test-only reset for the in-memory OAuth token cache. */
export function resetGoogleSheetsTokenCache(): void {
  cachedAccessToken = null
}
