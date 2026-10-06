/**
 * lib/crm/endpoint-guard.ts — which hosts the server may call on a user's behalf.
 *
 * CRM connect/sync fetch a host the user typed. Without a guard that is an
 * SSRF: the server could be pointed at internal addresses or cloud metadata.
 * Rules:
 *   - https only, no credentials/port tricks;
 *   - Bitrix24 cloud: <portal>.bitrix24.<tld>; amoCRM/Kommo: <account>.amocrm.ru|amocrm.com|kommo.com;
 *   - self-hosted Bitrix24 («коробка») only if the exact host is listed in
 *     CRM_ALLOWED_CUSTOM_HOSTS (comma-separated);
 *   - a Bitrix24 incoming-webhook URL must point at the same host and have the
 *     /rest/<user>/<secret>/ shape;
 *   - every host must resolve to public addresses only (private, loopback,
 *     link-local, CGNAT and metadata ranges are refused) — this also covers
 *     DNS that points an allowed-looking name inward.
 */
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { CrmProvider } from './types'

export type GuardResult =
  | { ok: true; host: string; webhookUrl: string | null }
  | { ok: false; error: string }

const BITRIX_CLOUD = /^[a-z0-9][a-z0-9-]{0,62}\.bitrix24\.(ru|kz|com|by|ua|de|eu|es|fr|it|pl|uk|in|tr|id|vn|co|mx|cn|jp|com\.br|com\.tr)$/
const AMO_CLOUD = /^[a-z0-9][a-z0-9-]{0,62}\.(amocrm\.ru|amocrm\.com|kommo\.com)$/

export type Resolver = (host: string) => Promise<string[]>

const defaultResolver: Resolver = async (host) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address)

function customHosts(): Set<string> {
  return new Set(
    (process.env.CRM_ALLOWED_CUSTOM_HOSTS ?? '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  )
}

/** True for addresses a server must never be pushed to. */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number)
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) ||           // link-local / cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    )
  }
  const v6 = ip.toLowerCase()
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7))
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80') || v6.startsWith('ff')
}

function parseHost(raw: string): string | null {
  const value = raw.trim()
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(value) ? value : `https://${value}`)
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null
    if (url.pathname !== '/' && url.pathname !== '') return null
    const host = url.hostname.toLowerCase()
    if (!host || isIP(host)) return null
    return host
  } catch {
    return null
  }
}

function hostAllowed(provider: CrmProvider, host: string): boolean {
  if (provider === 'amocrm') return AMO_CLOUD.test(host)
  return BITRIX_CLOUD.test(host) || customHosts().has(host)
}

export async function guardCrmEndpoint(
  provider: CrmProvider,
  baseUrl: string,
  token: string,
  resolve: Resolver = defaultResolver,
): Promise<GuardResult> {
  const host = parseHost(baseUrl)
  if (!host) return { ok: false, error: 'Укажите домен CRM без пути, например company.bitrix24.kz' }
  if (!hostAllowed(provider, host)) {
    return {
      ok: false,
      error: provider === 'amocrm'
        ? 'Домен amoCRM должен быть вида <аккаунт>.amocrm.ru, .amocrm.com или .kommo.com'
        : 'Домен Bitrix24 должен быть вида <портал>.bitrix24.<зона>. Коробочную версию добавляет администратор платформы.',
    }
  }

  let webhookUrl: string | null = null
  if (provider === 'bitrix24' && /^https?:\/\//i.test(token)) {
    try {
      const u = new URL(token.trim())
      if (u.protocol !== 'https:' || u.hostname.toLowerCase() !== host || u.username || u.password || (u.port && u.port !== '443')) {
        return { ok: false, error: 'Вебхук Bitrix24 должен быть https-адресом того же портала' }
      }
      if (!/^\/rest\/\d+\/[A-Za-z0-9]+\/?$/.test(u.pathname) || u.search || u.hash) {
        return { ok: false, error: 'Неверный формат вебхука Bitrix24 (ожидается /rest/<id>/<ключ>/)' }
      }
      webhookUrl = `https://${host}${u.pathname.replace(/\/?$/, '/')}`
    } catch {
      return { ok: false, error: 'Неверный адрес вебхука Bitrix24' }
    }
  }

  let addresses: string[]
  try {
    addresses = await resolve(host)
  } catch {
    return { ok: false, error: 'Домен CRM не найден' }
  }
  if (!addresses.length || addresses.some(isPrivateAddress)) {
    return { ok: false, error: 'Домен CRM указывает на недопустимый адрес' }
  }
  return { ok: true, host, webhookUrl }
}
