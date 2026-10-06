/**
 * lib/ai/providers/url-guard.ts — which base URLs an LLM provider may have.
 *
 * The owner types a provider base URL; the server then POSTs prompts and the
 * API key to it. Without a guard that is an SSRF (internal services, cloud
 * metadata) and a key-exfiltration path. Rules (same approach as the CRM guard,
 * lib/crm/endpoint-guard.ts, whose private-range check is reused):
 *   - https only, no userinfo, no query/fragment;
 *   - http://localhost and http://127.0.0.1 only outside production (local
 *     OpenAI-compatible servers in development);
 *   - in production: no IP literals, and the host must resolve to public
 *     addresses only (private, loopback, link-local, CGNAT, metadata refused).
 */
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { isPrivateAddress } from '@/lib/crm/endpoint-guard'

export type Resolver = (host: string) => Promise<string[]>

const defaultResolver: Resolver = async (host) =>
  (await lookup(host, { all: true, verbatim: true })).map((a) => a.address)

export type UrlGuardResult = { ok: true; url: string } | { ok: false; error: string }

const LOCAL_DEV_HOSTS = new Set(['localhost', '127.0.0.1'])

const isProduction = () => process.env.NODE_ENV === 'production'

/** Syntactic check (no DNS). Returns the normalised base URL without a trailing slash. */
export function checkBaseUrlSyntax(raw: string): UrlGuardResult {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return { ok: false, error: 'Неверный адрес провайдера' }
  }
  if (url.username || url.password) return { ok: false, error: 'Адрес не должен содержать логин или пароль' }
  if (url.search || url.hash) return { ok: false, error: 'Адрес не должен содержать параметры запроса' }
  const host = url.hostname.toLowerCase()
  if (url.protocol === 'http:') {
    if (isProduction() || !LOCAL_DEV_HOSTS.has(host)) {
      return { ok: false, error: 'Нужен https-адрес (http допустим только для localhost вне продакшена)' }
    }
  } else if (url.protocol !== 'https:') {
    return { ok: false, error: 'Нужен https-адрес' }
  }
  if (isProduction()) {
    const bare = host.replace(/^\[|\]$/g, '')
    if (isIP(bare)) return { ok: false, error: 'Укажите доменное имя, а не IP-адрес' }
    if (url.port && url.port !== '443') return { ok: false, error: 'Нестандартный порт запрещён' }
  }
  const path = url.pathname.replace(/\/+$/, '')
  return { ok: true, url: `${url.protocol}//${url.host}${path}` }
}

/**
 * Full check: syntax, then (in production) DNS → public addresses only.
 * Called when a provider is saved and before a key is verified.
 */
export async function guardProviderBaseUrl(raw: string, resolve: Resolver = defaultResolver): Promise<UrlGuardResult> {
  const syntax = checkBaseUrlSyntax(raw)
  if (!syntax.ok || !isProduction()) return syntax
  const host = new URL(syntax.url).hostname
  let addresses: string[]
  try {
    addresses = await resolve(host)
  } catch {
    return { ok: false, error: 'Домен провайдера не найден' }
  }
  if (!addresses.length || addresses.some(isPrivateAddress)) {
    return { ok: false, error: 'Домен провайдера указывает на недопустимый (внутренний) адрес' }
  }
  return syntax
}

/** API path inside the base URL: "/chat/completions", "/v2/rerank" … */
export function isSafeApiPath(p: string): boolean {
  return /^\/[A-Za-z0-9._~\-/]{0,199}$/.test(p) && !p.includes('..') && !p.includes('//')
}

/** Join base URL and API path without double slashes. */
export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}
