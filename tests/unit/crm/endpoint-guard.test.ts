import { afterEach, describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { guardCrmEndpoint, isPrivateAddress } from '@/lib/crm/endpoint-guard'
import { isSealed, openCrmToken, sealCrmToken } from '@/lib/crm/token-store'

const publicDns = async () => ['185.12.21.10']
const dns = (addrs: string[]) => async () => addrs

afterEach(() => {
  delete process.env.CRM_ALLOWED_CUSTOM_HOSTS
  delete process.env.SECRETS_ENCRYPTION_KEY
})

describe('CRM endpoint guard (SSRF)', () => {
  it('accepts cloud portals of Bitrix24 and amoCRM/Kommo', async () => {
    expect(await guardCrmEndpoint('bitrix24', 'company.bitrix24.kz', 'oauth-token', publicDns)).toEqual({ ok: true, host: 'company.bitrix24.kz', webhookUrl: null })
    expect(await guardCrmEndpoint('bitrix24', 'https://company.bitrix24.ru/', 'tok', publicDns)).toMatchObject({ ok: true, host: 'company.bitrix24.ru' })
    expect((await guardCrmEndpoint('amocrm', 'shop.amocrm.ru', 'tok', publicDns)).ok).toBe(true)
    expect((await guardCrmEndpoint('amocrm', 'shop.kommo.com', 'tok', publicDns)).ok).toBe(true)
  })

  it('normalises a valid Bitrix24 webhook to the same portal', async () => {
    const r = await guardCrmEndpoint('bitrix24', 'company.bitrix24.kz', 'https://company.bitrix24.kz/rest/1/abc123def/', publicDns)
    expect(r).toEqual({ ok: true, host: 'company.bitrix24.kz', webhookUrl: 'https://company.bitrix24.kz/rest/1/abc123def/' })
  })

  it.each([
    ['internal host', 'bitrix24', 'intranet.local', 'tok'],
    ['metadata IP', 'bitrix24', '169.254.169.254', 'tok'],
    ['plain http', 'amocrm', 'http://shop.amocrm.ru', 'tok'],
    ['custom port', 'bitrix24', 'https://company.bitrix24.kz:8443', 'tok'],
    ['path in domain', 'bitrix24', 'company.bitrix24.kz/admin', 'tok'],
    ['userinfo trick', 'bitrix24', 'https://company.bitrix24.kz@evil.example', 'tok'],
    ['lookalike domain', 'amocrm', 'shop.amocrm.ru.evil.example', 'tok'],
    ['webhook to another host', 'bitrix24', 'company.bitrix24.kz', 'https://evil.example/rest/1/abc/'],
    ['webhook wrong shape', 'bitrix24', 'company.bitrix24.kz', 'https://company.bitrix24.kz/admin/'],
    ['webhook over http', 'bitrix24', 'company.bitrix24.kz', 'http://company.bitrix24.kz/rest/1/abc/'],
  ] as const)('rejects %s', async (_name, provider, base, token) => {
    expect((await guardCrmEndpoint(provider, base, token, publicDns)).ok).toBe(false)
  })

  it('rejects allowed-looking names that resolve to private addresses', async () => {
    for (const addrs of [['10.0.0.5'], ['127.0.0.1'], ['192.168.1.10'], ['100.64.0.1'], ['::1'], ['fd00::1'], ['::ffff:10.1.2.3'], ['185.12.21.10', '172.16.0.1']]) {
      expect((await guardCrmEndpoint('bitrix24', 'company.bitrix24.kz', 'tok', dns(addrs))).ok, addrs.join(',')).toBe(false)
    }
  })

  it('allows a self-hosted Bitrix24 only when the admin listed its host', async () => {
    expect((await guardCrmEndpoint('bitrix24', 'crm.client.kz', 'tok', publicDns)).ok).toBe(false)
    process.env.CRM_ALLOWED_CUSTOM_HOSTS = 'crm.client.kz'
    expect((await guardCrmEndpoint('bitrix24', 'crm.client.kz', 'tok', publicDns)).ok).toBe(true)
    expect((await guardCrmEndpoint('bitrix24', 'crm.client.kz', 'tok', dns(['10.0.0.1']))).ok).toBe(false)
  })

  it('classifies addresses', () => {
    expect(isPrivateAddress('8.8.8.8')).toBe(false)
    expect(isPrivateAddress('172.32.0.1')).toBe(false)
    expect(isPrivateAddress('172.31.255.255')).toBe(true)
    expect(isPrivateAddress('2a00:1450::1')).toBe(false)
  })
})

describe('CRM token storage', () => {
  it('encrypts when a key is configured and reads both formats', () => {
    process.env.SECRETS_ENCRYPTION_KEY = randomBytes(32).toString('base64')
    const sealed = sealCrmToken('secret-token')
    expect(isSealed(sealed)).toBe(true)
    expect(sealed).not.toContain('secret-token')
    expect(openCrmToken(sealed)).toBe('secret-token')
    expect(openCrmToken('legacy-plain')).toBe('legacy-plain')
  })

  it('keeps working without a key (legacy plaintext)', () => {
    expect(sealCrmToken('plain')).toBe('plain')
  })
})
