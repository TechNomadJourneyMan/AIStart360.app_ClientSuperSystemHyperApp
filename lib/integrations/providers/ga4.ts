/**
 * Google Analytics 4 Data API adapter (service account) — «не проверено
 * вживую» until tested with a client's property.
 *
 * Official documentation (read 2026-10-06):
 *   runReport            https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport
 *                        POST https://analyticsdata.googleapis.com/v1beta/{property=properties/*}:runReport,
 *                        body dateRanges / dimensions / metrics / limit / offset / currencyCode /
 *                        keepEmptyRows; scope https://www.googleapis.com/auth/analytics.readonly
 *   response             https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/RunReportResponse
 *                        rows[].dimensionValues[].value, rows[].metricValues[].value, rowCount;
 *                        ResponseMetaData.currencyCode («If currencyCode was specified in the request,
 *                        this response parameter will echo the request parameter»)
 *   dimensions / metrics https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema
 *                        date («formatted as YYYYMMDD»), sessions, activeUsers, ecommercePurchases,
 *                        purchaseRevenue
 *   quotas               https://developers.google.com/analytics/devguides/reporting/data/v1/quotas
 *                        (core tokens per property per day / hour, concurrent requests)
 *   service account      https://developers.google.com/identity/protocols/oauth2/service-account
 *                        JWT {"alg":"RS256","typ":"JWT"}, claims iss / scope / aud
 *                        "https://oauth2.googleapis.com/token" / exp / iat (≤ 1 h), signed
 *                        SHA256withRSA; POST https://oauth2.googleapis.com/token with
 *                        grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=<JWT>
 *
 * OAuth sign-in with Google is NOT used: the platform has no Google OAuth
 * client (docs/platform/06-integrations.md, BLOCKED part). The client grants
 * its own service account the Viewer role on the property.
 */
import { createSign } from 'node:crypto'
import { COUNT_UNIT, roundFact, type FactInput } from '../facts'
import { IntegrationError, num, requestJson } from '../http'
import { addDays, advanceCursor, dayOf, daysBetween, maxDaysFor, planDays, type DayCursor } from '../period'
import type { AdapterContext, ProviderAdapter, SyncResult } from './types'

export const GA4_DATA_API_BASE = 'https://analyticsdata.googleapis.com/v1beta'
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const GA4_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly'
const LABEL = 'Google Analytics 4'
const MAX_DAYS_PER_RUN = 35
/** Revenue is requested in tenge: GA4 converts and echoes currencyCode. */
const REPORT_CURRENCY = 'KZT'

interface ServiceAccount { client_email: string; private_key: string; private_key_id?: string }

export function parseServiceAccount(json: string): ServiceAccount {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(json) as Record<string, unknown>
  } catch {
    throw new IntegrationError('config', `${LABEL}: ключ сервисного аккаунта — не JSON`)
  }
  const email = parsed.client_email
  const key = parsed.private_key
  if (parsed.type !== 'service_account' || typeof email !== 'string' || typeof key !== 'string' || !key.includes('PRIVATE KEY')) {
    throw new IntegrationError('config', `${LABEL}: в JSON нет client_email / private_key сервисного аккаунта`)
  }
  return { client_email: email, private_key: key, private_key_id: typeof parsed.private_key_id === 'string' ? parsed.private_key_id : undefined }
}

const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64url')

/** Signed JWT assertion (service-account flow, RS256). */
export function signAssertion(sa: ServiceAccount, now: Date): string {
  const iat = Math.floor(now.getTime() / 1000)
  const header = { alg: 'RS256', typ: 'JWT', ...(sa.private_key_id ? { kid: sa.private_key_id } : {}) }
  const claims = { iss: sa.client_email, scope: GA4_SCOPE, aud: GOOGLE_TOKEN_URL, exp: iat + 3600, iat }
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`
  let signature: string
  try {
    signature = createSign('RSA-SHA256').update(input).sign(sa.private_key).toString('base64url')
  } catch {
    throw new IntegrationError('config', `${LABEL}: закрытый ключ сервисного аккаунта не читается`)
  }
  return `${input}.${signature}`
}

async function accessToken(sa: ServiceAccount, ctx: AdapterContext): Promise<string> {
  const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signAssertion(sa, ctx.now) })
  try {
    const res = await requestJson<{ access_token?: string }>(
      { fetch: ctx.fetch, budget: ctx.budget, secrets: ctx.secrets },
      { url: GOOGLE_TOKEN_URL, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(), label: LABEL },
    )
    if (!res.data.access_token) throw new IntegrationError('permanent', `${LABEL}: сервер авторизации не вернул токен`)
    return res.data.access_token
  } catch (err) {
    // invalid_grant / invalid key → the credentials themselves are wrong.
    if (err instanceof IntegrationError && (err.status === 400 || err.status === 401)) {
      throw new IntegrationError('auth', `${LABEL}: ключ сервисного аккаунта не принят Google — создайте новый ключ`, err.status)
    }
    throw err
  }
}

interface RunReportResponse {
  rows?: Array<{ dimensionValues?: Array<{ value?: string }>; metricValues?: Array<{ value?: string }> }>
  rowCount?: number
  metadata?: { currencyCode?: string; timeZone?: string }
}

async function runReport(token: string, propertyId: string, body: Record<string, unknown>, ctx: AdapterContext): Promise<RunReportResponse> {
  const res = await requestJson<RunReportResponse>(
    { fetch: ctx.fetch, budget: ctx.budget, secrets: ctx.secrets },
    {
      url: `${GA4_DATA_API_BASE}/properties/${encodeURIComponent(propertyId)}:runReport`,
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      label: LABEL,
    },
  )
  return res.data
}

const METRICS = ['sessions', 'activeUsers', 'ecommercePurchases', 'purchaseRevenue'] as const

function ymd(v: string | undefined): string | null {
  return v && /^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : null
}

export const ga4Adapter: ProviderAdapter = {
  key: 'ga4',
  maxDaysPerRun: MAX_DAYS_PER_RUN,
  requestBudget: 4,
  backfillIntervalMinutes: 5,
  refreshIntervalMinutes: 360,

  async test(secret, settings, ctx) {
    const sa = parseServiceAccount(secret.service_account_json ?? '')
    const token = await accessToken(sa, ctx)
    const day = addDays(dayOf(ctx.now), -1)
    await runReport(token, settings.property_id, { dateRanges: [{ startDate: day, endDate: day }], metrics: [{ name: 'sessions' }], limit: '1' }, ctx)
    return { accountLabel: `GA4 · ресурс ${settings.property_id}` }
  },

  async sync(secret, settings, rawCursor, ctx): Promise<SyncResult> {
    const cursor = rawCursor as DayCursor
    const window = planDays(cursor, ctx.now, 0, maxDaysFor(rawCursor, MAX_DAYS_PER_RUN))
    if (!window) return { facts: [], cursor: { ...cursor }, caughtUp: true }
    const sa = parseServiceAccount(secret.service_account_json ?? '')
    const token = await accessToken(sa, ctx)
    const report = await runReport(token, settings.property_id, {
      dateRanges: [{ startDate: window.from, endDate: window.to }],
      dimensions: [{ name: 'date' }],
      metrics: METRICS.map((name) => ({ name })),
      currencyCode: REPORT_CURRENCY,
      keepEmptyRows: true,
      limit: '1000',
    }, ctx)
    const currency = report.metadata?.currencyCode && /^[A-Z]{3}$/.test(report.metadata.currencyCode) ? report.metadata.currencyCode : REPORT_CURRENCY

    const byDay = new Map<string, number[]>(daysBetween(window.from, window.to).map((d) => [d, [0, 0, 0, 0]]))
    for (const row of report.rows ?? []) {
      const day = ymd(row.dimensionValues?.[0]?.value)
      if (!day || !byDay.has(day)) continue
      byDay.set(day, METRICS.map((_, i) => num(row.metricValues?.[i]?.value) ?? 0))
    }
    const facts: FactInput[] = []
    for (const [day, [sessions, users, purchases, revenue]] of byDay) {
      const ref = `ga4:${settings.property_id}:${day}`
      facts.push(
        { metricKey: 'sessions', periodStart: day, periodEnd: day, value: roundFact('sessions', sessions), unit: COUNT_UNIT, sourceRef: ref },
        { metricKey: 'users', periodStart: day, periodEnd: day, value: roundFact('users', users), unit: COUNT_UNIT, sourceRef: ref },
        { metricKey: 'web_purchases', periodStart: day, periodEnd: day, value: roundFact('web_purchases', purchases), unit: COUNT_UNIT, sourceRef: ref },
        { metricKey: 'web_revenue', periodStart: day, periodEnd: day, value: roundFact('web_revenue', revenue), unit: currency, sourceRef: ref },
      )
    }
    return { facts, cursor: advanceCursor({ ...cursor }, window) as Record<string, unknown>, caughtUp: window.refresh }
  },
}
