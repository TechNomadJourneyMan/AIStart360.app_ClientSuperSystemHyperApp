/**
 * Global network guard for the vitest process (R-010).
 *
 * Any outbound connection to a host other than 127.0.0.1 / localhost / ::1
 * fails with RealNetworkInTestsError — a test without a mock must not be able
 * to send e-mails, spend AI budget or write to a cloud database.
 *
 * Two layers:
 *  1. `globalThis.fetch` is wrapped (clear error, no DNS lookup). Tests that
 *     mock fetch (vi.stubGlobal / vi.spyOn(...).mockImplementation /
 *     `global.fetch = vi.fn()`) replace the wrapper and keep working; a spy
 *     without an implementation calls through into the guard.
 *  2. `net.Socket.prototype.connect` is patched, which covers http(s).request,
 *     undici, tls, pg and anything else that opens a TCP socket from JS.
 *     (Prisma's native engine is covered by DATABASE_URL being re-pointed in
 *     env-setup.ts.)
 *
 * Deliberate exceptions: the host of TEST_SUPABASE_URL (the disposable
 * Supabase project the opt-in integration suites use) and the comma-separated
 * TEST_NETWORK_ALLOW_HOSTS.
 */
import net from 'node:net'
import { isLocalHost } from './test-env-guard'

export class RealNetworkInTestsError extends TypeError {
  readonly code = 'E_TEST_REAL_NETWORK'
  constructor(readonly target: string, via: string) {
    super(
      `Реальная сеть в тестах запрещена: ${via} → ${target}. ` +
        `Замокайте fetch/клиент (vi.stubGlobal('fetch', …), vi.mock) или поднимите сервер на 127.0.0.1. ` +
        `Осознанное исключение — TEST_NETWORK_ALLOW_HOSTS. (Real network access is blocked in tests.)`,
    )
    this.name = 'RealNetworkInTestsError'
  }
}

function extraAllowedHosts(env: Record<string, string | undefined> = process.env): string[] {
  const hosts = (env.TEST_NETWORK_ALLOW_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
  if (env.TEST_SUPABASE_URL) {
    try {
      hosts.push(new URL(env.TEST_SUPABASE_URL.trim()).hostname.toLowerCase())
    } catch {
      /* malformed — the supabase gate reports it */
    }
  }
  return hosts
}

export function isHostAllowedInTests(host: string | null | undefined, env?: Record<string, string | undefined>): boolean {
  if (isLocalHost(host)) return true
  const h = (host ?? '').trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  return extraAllowedHosts(env).includes(h)
}

function requestUrl(input: unknown): URL | null {
  try {
    if (typeof input === 'string') return new URL(input)
    if (input instanceof URL) return input
    if (input && typeof (input as { url?: unknown }).url === 'string') return new URL((input as { url: string }).url)
  } catch {
    /* relative / malformed: let the real fetch report it */
  }
  return null
}

/** Where the target of a Socket#connect call is, or null for IPC paths. */
function socketTarget(args: unknown[]): string | null {
  let first = args[0]
  // net.connect() hands Socket#connect its already-normalized [options, cb] array.
  if (Array.isArray(first)) first = first[0]
  if (first && typeof first === 'object') {
    const o = first as { path?: unknown; host?: unknown }
    if (typeof o.path === 'string' && o.path) return null
    return typeof o.host === 'string' && o.host ? o.host : 'localhost'
  }
  if (typeof first === 'number' || (typeof first === 'string' && /^\d+$/.test(first))) {
    return typeof args[1] === 'string' && args[1] ? args[1] : 'localhost'
  }
  if (typeof first === 'string') return null // unix socket / named pipe
  return 'localhost'
}

interface GuardState {
  realFetch: typeof fetch | undefined
  guardedFetch: typeof fetch
  realConnect: typeof net.Socket.prototype.connect
}

const STATE = Symbol.for('aistart360.test.networkGuard')

export function installNetworkGuard(): void {
  const g = globalThis as unknown as Record<symbol, GuardState | undefined>
  let state = g[STATE]
  if (!state) {
    const realFetch = globalThis.fetch
    const guardedFetch = function guardedFetch(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) {
      const url = requestUrl(input)
      if (url && /^(https?|wss?):$/.test(url.protocol) && !isHostAllowedInTests(url.hostname)) {
        return Promise.reject(new RealNetworkInTestsError(url.host, 'fetch'))
      }
      if (!realFetch) return Promise.reject(new TypeError('fetch is not available'))
      return realFetch(input, init)
    } as typeof fetch

    const realConnect = net.Socket.prototype.connect
    net.Socket.prototype.connect = function guardedConnect(this: net.Socket, ...args: unknown[]) {
      const host = socketTarget(args)
      if (host !== null && !isHostAllowedInTests(host)) {
        const err = new RealNetworkInTestsError(host, 'socket')
        process.nextTick(() => this.destroy(err))
        return this
      }
      return (realConnect as (...a: unknown[]) => net.Socket).apply(this, args)
    } as typeof net.Socket.prototype.connect

    state = { realFetch, guardedFetch, realConnect }
    g[STATE] = state
  }
  // Each test file starts from the guarded fetch (a stub leaked by a previous
  // file in the same worker does not survive into the next one).
  globalThis.fetch = state.guardedFetch
}
