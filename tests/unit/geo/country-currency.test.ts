/**
 * lib/geo/country.ts + lib/geo/currency.ts — which country (and so which price currency) the landing
 * page shows. On Vercel the edge sets `x-vercel-ip-country`; on Railway there is no such header, so
 * the country comes from the visitor's IP through an offline GeoIP lookup. The lookup is injected here:
 * these tests never load the GeoIP data.
 */
import { describe, expect, it, vi } from 'vitest'
import { countryFromHeaders } from '@/lib/geo/country'
import { GEO_CURRENCIES, currencyForCountry } from '@/lib/geo/currency'

/** A Headers-like bag: names are matched case-insensitively, like real Headers. */
function headers(init: Record<string, string> = {}) {
  const map = new Map(Object.entries(init).map(([k, v]) => [k.toLowerCase(), v]))
  return { get: (name: string) => map.get(name.toLowerCase()) ?? null }
}

describe('countryFromHeaders', () => {
  it('takes the Vercel header, upper-cased, without calling the lookup', () => {
    const lookup = vi.fn(() => 'DE')
    expect(countryFromHeaders(headers({ 'x-vercel-ip-country': 'ru' }), lookup)).toBe('RU')
    expect(lookup).not.toHaveBeenCalled()
  })

  it('prefers the Vercel header over any IP', () => {
    const lookup = vi.fn(() => 'DE')
    const h = headers({ 'x-vercel-ip-country': 'KZ', 'x-real-ip': '5.34.0.1' })
    expect(countryFromHeaders(h, lookup)).toBe('KZ')
    expect(lookup).not.toHaveBeenCalled()
  })

  it('looks up the first x-forwarded-for address (the client, not the proxies behind it)', () => {
    const lookup = vi.fn(() => 'KZ')
    expect(countryFromHeaders(headers({ 'x-forwarded-for': '5.34.0.1, 10.0.0.1' }), lookup)).toBe('KZ')
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(lookup).toHaveBeenCalledWith('5.34.0.1')
  })

  it('prefers x-real-ip over x-forwarded-for', () => {
    const lookup = vi.fn(() => 'RU')
    const h = headers({ 'x-real-ip': '77.88.8.8', 'x-forwarded-for': '5.34.0.1' })
    expect(countryFromHeaders(h, lookup)).toBe('RU')
    expect(lookup).toHaveBeenCalledWith('77.88.8.8')
  })

  it('upper-cases what the lookup returns', () => {
    expect(countryFromHeaders(headers({ 'x-real-ip': '8.8.8.8' }), () => 'us')).toBe('US')
  })

  it('returns null when the lookup finds nothing', () => {
    expect(countryFromHeaders(headers({ 'x-real-ip': '8.8.8.8' }), () => null)).toBeNull()
  })

  it('returns null when the lookup throws', () => {
    const lookup = () => {
      throw new Error('boom')
    }
    expect(countryFromHeaders(headers({ 'x-real-ip': '8.8.8.8' }), lookup)).toBeNull()
  })

  it('returns null with no headers at all, without calling the lookup', () => {
    const lookup = vi.fn(() => 'KZ')
    expect(countryFromHeaders(headers(), lookup)).toBeNull()
    expect(lookup).not.toHaveBeenCalled()
  })

  it.each([
    ['10.1.2.3'],
    ['172.16.0.1'],
    ['172.31.255.254'],
    ['192.168.1.1'],
    ['127.0.0.1'],
    ['169.254.10.10'],
    ['100.64.0.1'],
    ['0.0.0.0'],
    ['::1'],
    ['::'],
    ['fc00::1'],
    ['fd12:3456:789a::1'],
    ['fe80::1'],
    ['::ffff:10.0.0.1'],
    ['not-an-ip'],
    ['999.1.1.1'],
    ['1.2.3'],
    ['5.34.0.1.7'],
    [''],
  ])('%j in x-real-ip gives null without calling the lookup', (ip) => {
    const lookup = vi.fn(() => 'KZ')
    expect(countryFromHeaders(headers({ 'x-real-ip': ip }), lookup)).toBeNull()
    expect(lookup).not.toHaveBeenCalled()
  })

  it('does not fall through to a later address when the first one is private', () => {
    // The first x-forwarded-for entry is the client; if it is private, the request came from inside.
    const lookup = vi.fn(() => 'KZ')
    expect(countryFromHeaders(headers({ 'x-forwarded-for': '10.0.0.1, 5.34.0.1' }), lookup)).toBeNull()
    expect(lookup).not.toHaveBeenCalled()
  })

  it('hands the lookup the bare address: whitespace, port and brackets are stripped', () => {
    const lookup = vi.fn(() => 'KZ')
    countryFromHeaders(headers({ 'x-forwarded-for': '  5.34.0.1:51234 , 10.0.0.1' }), lookup)
    expect(lookup).toHaveBeenLastCalledWith('5.34.0.1')
    countryFromHeaders(headers({ 'x-real-ip': '[2a02:6b8::feed:0ff]:443' }), lookup)
    expect(lookup).toHaveBeenLastCalledWith('2a02:6b8::feed:0ff')
  })

  it('passes a public IPv6 address through to the lookup', () => {
    const lookup = vi.fn(() => 'RU')
    expect(countryFromHeaders(headers({ 'x-real-ip': '2a02:6b8::2:242' }), lookup)).toBe('RU')
    expect(lookup).toHaveBeenCalledWith('2a02:6b8::2:242')
  })

  it('ignores a malformed Vercel header and falls back to the IP', () => {
    const lookup = vi.fn(() => 'KZ')
    const h = headers({ 'x-vercel-ip-country': 'not a country', 'x-real-ip': '5.34.0.1' })
    expect(countryFromHeaders(h, lookup)).toBe('KZ')
    expect(lookup).toHaveBeenCalledWith('5.34.0.1')
  })
})

describe('countryFromHeaders with the bundled GeoIP database', () => {
  // No injected lookup: this is the geoip-country data the portal reads on Railway.
  it('finds a Kazakh, a Russian and an American address', () => {
    expect(countryFromHeaders(headers({ 'x-real-ip': '5.34.0.1' }))).toBe('KZ')
    expect(countryFromHeaders(headers({ 'x-forwarded-for': '2a02:6b8::2:242' }))).toBe('RU')
    expect(countryFromHeaders(headers({ 'x-forwarded-for': '8.8.8.8, 10.0.0.1' }))).toBe('US')
  })

  it('returns null for an address the database has no country for', () => {
    expect(countryFromHeaders(headers({ 'x-real-ip': '203.0.113.7' }))).toBeNull()
  })
})

describe('currencyForCountry', () => {
  it('shows tenge for no country (the fallback) and for Kazakhstan', () => {
    expect(currencyForCountry(null)).toBe(GEO_CURRENCIES.KZT)
    expect(currencyForCountry('KZ')).toBe(GEO_CURRENCIES.KZT)
  })

  it('shows roubles for Russia and Belarus', () => {
    expect(currencyForCountry('RU')).toBe(GEO_CURRENCIES.RUB)
    expect(currencyForCountry('BY')).toBe(GEO_CURRENCIES.RUB)
  })

  it('shows dollars everywhere else', () => {
    expect(currencyForCountry('DE')).toBe(GEO_CURRENCIES.USD)
    expect(currencyForCountry('US')).toBe(GEO_CURRENCIES.USD)
  })

  it('is case-insensitive', () => {
    expect(currencyForCountry('kz')).toBe(GEO_CURRENCIES.KZT)
    expect(currencyForCountry('by')).toBe(GEO_CURRENCIES.RUB)
  })

  it('treats an empty string like no country', () => {
    expect(currencyForCountry('')).toBe(GEO_CURRENCIES.KZT)
  })

  it('keeps the showcase rates the page used', () => {
    expect(GEO_CURRENCIES).toEqual({
      USD: { code: 'USD', symbol: '$', perUsd: 1 },
      KZT: { code: 'KZT', symbol: '₸', perUsd: 520 },
      RUB: { code: 'RUB', symbol: '₽', perUsd: 95 },
    })
  })
})
