/**
 * R-225 — lib/crm/bitrix24.ts must not fetch arbitrary user-typed URLs. Every call goes through
 * guardCrmEndpoint (allowlisted Bitrix24 hosts, /rest/<id>/<key>/ webhook shape on the same host,
 * public addresses only), the OAuth token is URL-encoded and redirects are not followed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as bitrix24 from '@/lib/crm/bitrix24'

const publicDns = async () => ['93.184.216.34']
const privateDns = async () => ['10.0.0.5']

const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
  new Response(JSON.stringify({ result: { ID: '1' } }), { status: 200 }))

beforeEach(() => {
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('R-225 bitrix24 SSRF guard', () => {
  it('R-225: a webhook URL pointing at an internal host is never fetched', async () => {
    const r = await bitrix24.testConnection({
      domain: 'metadata.google.internal', accessToken: 'x',
      webhookUrl: 'http://169.254.169.254/latest/meta-data/', resolve: publicDns,
    })
    expect(r.ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('R-225: a webhook on another host than the portal is refused', async () => {
    const r = await bitrix24.testConnection({
      domain: 'acme.bitrix24.kz', accessToken: 'x',
      webhookUrl: 'https://evil.example.com/rest/1/abc123/', resolve: publicDns,
    })
    expect(r.ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('R-225: an allowlisted name that resolves to a private address is refused', async () => {
    const r = await bitrix24.testConnection({ domain: 'acme.bitrix24.kz', accessToken: 't', resolve: privateDns })
    expect(r.ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('R-225: a valid webhook is called on the guarded URL, without following redirects', async () => {
    const r = await bitrix24.testConnection({
      domain: 'acme.bitrix24.kz', accessToken: 'x',
      webhookUrl: 'https://acme.bitrix24.kz/rest/1/abc123', resolve: publicDns,
    })
    expect(r.ok).toBe(true)
    expect(fetchMock.mock.calls[0][0]).toBe('https://acme.bitrix24.kz/rest/1/abc123/profile.json')
    expect(fetchMock.mock.calls[0][1]?.redirect).toBe('manual')
  })

  it('R-225: OAuth mode URL-encodes the token and strips the scheme from the domain', async () => {
    await bitrix24.testConnection({ domain: 'https://acme.bitrix24.kz/', accessToken: 'a&b=c#d', resolve: publicDns })
    expect(fetchMock.mock.calls[0][0]).toBe('https://acme.bitrix24.kz/rest/profile.json?auth=a%26b%3Dc%23d')
  })
})
