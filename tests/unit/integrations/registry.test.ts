/**
 * Integration registry invariants (W7):
 *   • the provider keys of lib/integrations/registry.ts and the CHECK
 *     constraints of migration 105 are the same list;
 *   • every 'live' provider has a documented adapter and doc URLs and stays
 *     «не проверено вживую»; every 'file' provider has no adapter, no
 *     credential fields and a BLOCKED explanation (reason / input / unblock);
 *   • the connect form is validated (required fields, patterns) and splits
 *     secrets from plain settings.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { INTEGRATION_PROVIDER_KEYS, INTEGRATION_PROVIDERS, parseCredentials, providerCatalog } from '@/lib/integrations/registry'
import { LIVE_ADAPTERS } from '@/lib/integrations/providers'
import { FACT_KEYS } from '@/lib/integrations/facts'

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/105_integration_connections.sql'), 'utf8')

function checkList(constraint: string): string[] {
  const at = sql.indexOf(`ADD CONSTRAINT ${constraint}`)
  expect(at, constraint).toBeGreaterThan(0)
  const body = sql.slice(at, sql.indexOf(';', at))
  return [...body.matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1])
}

describe('integration registry', () => {
  it('provider keys equal the CHECK lists of migration 105 (connections and facts)', () => {
    expect(checkList('integration_connections_provider_check').sort()).toEqual([...INTEGRATION_PROVIDER_KEYS].sort())
    expect(checkList('integration_facts_provider_check').sort()).toEqual([...INTEGRATION_PROVIDER_KEYS].sort())
  })

  it('live providers have an adapter, docs and are not marked verified; file providers are BLOCKED without fields', () => {
    for (const key of INTEGRATION_PROVIDER_KEYS) {
      const def = INTEGRATION_PROVIDERS[key]
      expect(def.verifiedLive, key).toBe(false)
      expect(def.docs.length, key).toBeGreaterThan(0)
      expect(def.exportHint.length, key).toBeGreaterThan(10)
      if (def.mode === 'live') {
        expect(LIVE_ADAPTERS[key], key).toBeDefined()
        expect(def.fields.length, key).toBeGreaterThan(0)
        expect(def.fields.some((f) => f.target === 'secret'), key).toBe(true)
        expect(def.facts.length, key).toBeGreaterThan(0)
        for (const f of def.facts) expect(FACT_KEYS).toContain(f)
      } else {
        expect(LIVE_ADAPTERS[key], key).toBeUndefined()
        expect(def.fields, key).toEqual([])
        expect(def.authKind).toBe('file')
        expect(def.blocked?.reason.length, key).toBeGreaterThan(20)
        expect(def.blocked?.requiredInput.length, key).toBeGreaterThan(10)
        expect(def.blocked?.howToUnblock.length, key).toBeGreaterThan(10)
      }
    }
    for (const key of Object.keys(LIVE_ADAPTERS)) expect(INTEGRATION_PROVIDERS[key as keyof typeof INTEGRATION_PROVIDERS].mode).toBe('live')
  })

  it('the documented priority providers are live; Ozon and the ad cabinets are BLOCKED', () => {
    for (const k of ['moysklad', 'kaspi', 'wildberries', 'ga4', 'yandex_metrika'] as const) expect(INTEGRATION_PROVIDERS[k].mode).toBe('live')
    for (const k of ['ozon', 'meta_ads', 'yandex_direct', 'google_ads', 'tilda', 'insales', 'bitrix_shop'] as const) expect(INTEGRATION_PROVIDERS[k].mode).toBe('file')
  })

  it('the public catalogue carries no regex and no secret values', () => {
    const json = JSON.stringify(providerCatalog())
    expect(json).not.toContain('pattern')
    expect(json).not.toContain('invalid')
    expect(providerCatalog()).toHaveLength(INTEGRATION_PROVIDER_KEYS.length)
  })

  it('validates the connect form and splits secret / settings', () => {
    expect(parseCredentials('kaspi', {})).toMatchObject({ ok: false, field: 'token' })
    expect(parseCredentials('kaspi', { token: 'short' })).toMatchObject({ ok: false, field: 'token' })
    const ok = parseCredentials('kaspi', { token: '  abcdefghijklmnop0123  ', extra: 'ignored' })
    expect(ok).toEqual({ ok: true, secret: { token: 'abcdefghijklmnop0123' }, settings: {} })

    expect(parseCredentials('ga4', { property_id: 'abc', service_account_json: '{}' })).toMatchObject({ ok: false, field: 'property_id' })
    const ga = parseCredentials('ga4', { property_id: '123456789', service_account_json: `{"type":"service_account","client_email":"a@b.iam.gserviceaccount.com"}` })
    expect(ga.ok && ga.settings).toEqual({ property_id: '123456789' })
    expect(ga.ok && Object.keys(ga.secret)).toEqual(['service_account_json'])

    expect(parseCredentials('shopify', { shop_domain: 'shop.example.com', token: 'shpat_0123456789abcdef' })).toMatchObject({ ok: false, field: 'shop_domain' })
    expect(parseCredentials('ozon', { anything: 'x' })).toEqual({ ok: true, secret: {}, settings: {} })
  })
})
