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
 *     link-local, CGNAT, metadata, NAT64, 6to4 and Teredo ranges are refused, in every IPv6
 *     spelling of them — IPv4-compatible, -mapped and -translated forms included) — this also
 *     covers DNS that points an allowed-looking name inward.
 *
 * Accepted residual risk: DNS rebinding. The guard resolves the name, fetch()
 * resolves it again; a name that answers a public address to the guard and an
 * internal one to fetch would get through. Only allowlisted CRM cloud hosts (and
 * hosts the platform admin lists) reach this point, so the name is controlled by
 * Bitrix24 / amoCRM, not by the user; pinning the checked address into the
 * request is not done.
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

function privateV4(a: number, b: number): boolean {
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

/** The eight 16-bit groups of an IPv6 address (`::` expanded, a dotted IPv4 tail read, a zone id dropped); null when it is none. */
function v6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase()
  const zone = s.indexOf('%')
  if (zone >= 0) s = s.slice(0, zone)
  if (isIP(s) !== 6) return null
  const tail = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(s)
  if (tail) {
    const q = tail[2].split('.').map(Number)
    s = `${tail[1]}${((q[0] << 8) | q[1]).toString(16)}:${((q[2] << 8) | q[3]).toString(16)}`
  }
  const halves = s.split('::')
  const part = (h: string) => (h ? h.split(':').map((g) => Number.parseInt(g, 16)) : [])
  const head = part(halves[0])
  const rest = halves.length === 2 ? part(halves[1]) : []
  const groups = halves.length === 2 ? [...head, ...Array(8 - head.length - rest.length).fill(0), ...rest] : head
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null
}

/**
 * True for addresses a server must never be pushed to. Fails closed: anything that is not a readable
 * IPv4 / IPv6 address counts as private. IPv6 is read into its groups, so every spelling of an
 * address (hex or dotted tail, `::` anywhere, a zone id) is judged the same.
 */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number)
    return privateV4(a, b)
  }
  const g = v6Groups(ip)
  if (!g) return true
  const zero = (n: number) => g.slice(0, n).every((x) => x === 0)
  // An IPv4 address in the low 32 bits: IPv4-compatible ::a.b.c.d (also :: and ::1), IPv4-mapped
  // ::ffff:a.b.c.d, IPv4-translated ::ffff:0:a.b.c.d — judged as that IPv4 address.
  if (zero(6) || (zero(5) && g[5] === 0xffff) || (zero(4) && g[4] === 0xffff && g[5] === 0)) {
    return privateV4(g[6] >> 8, g[6] & 0xff)
  }
  return (
    (g[0] & 0xfe00) === 0xfc00 || // unique local fc00::/7
    (g[0] & 0xff80) === 0xfe80 || // link-local fe80::/10 and site-local fec0::/10
    (g[0] & 0xff00) === 0xff00 || // multicast ff00::/8
    // NAT64 (64:ff9b::/96, local-use 64:ff9b:1::/48), 6to4 (2002::/16) and Teredo (2001::/32) embed an
    // IPv4 address that may be internal: refused whole.
    (g[0] === 0x64 && g[1] === 0xff9b) ||
    g[0] === 0x2002 ||
    (g[0] === 0x2001 && g[1] === 0)
  )
}

/**
 * The system resolver bounded by `ms` (the CRM sync passes what is left of its budget, so a hung DNS
 * lookup cannot hold a run past its deadline). A timeout is a failed lookup («Домен CRM не найден»).
 */
export function resolverWithTimeout(ms: number, base: Resolver = defaultResolver): Resolver {
  return (host) =>
    new Promise<string[]>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('dns timeout')), Math.max(1, ms))
      base(host).then(
        (a) => { clearTimeout(timer); resolve(a) },
        (e: unknown) => { clearTimeout(timer); reject(e) },
      )
    })
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
