import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { journeyIdentitySchema, type JourneyIdentity } from './schema'
import { isJourneyPublicDemoEnabled } from './public-demo'
import {
  JourneyAccessError,
  JourneyConflictError,
  JourneyPersistenceUnavailableError,
} from './persistence'

export const JOURNEY_DEVICE_COOKIE = 'aistart_journey_device'
export const STORE_JOURNEY_DEVICE_COOKIE = 'aistart_journey_store_device'
export const JOURNEY_DEVICE_COOKIE_MAX_AGE_SECONDS = 90 * 24 * 60 * 60
export const JOURNEY_SERVER_DEADLINE_MS = 18_000

export class JourneyAuthenticationError extends Error {
  constructor(message = 'В production рабочая область доступна только после входа.') {
    super(message)
    this.name = 'JourneyAuthenticationError'
  }
}

/** Anonymous workspaces are limited to local development and a deployment that
 * explicitly opts in with NEXT_PUBLIC_JOURNEY_PUBLIC_DEMO=1. Any other build
 * binds the token-gated workspace to the authenticated Supabase user.
 *
 * `VERCEL_ENV === 'preview'` used to be a third exemption. It is gone: a preview
 * URL is publicly reachable, so every preview deployment let anonymous callers
 * into the paid /api/v1/journey/chat and /documents routes. Preview builds that
 * really want the open demo set the flag like any other deployment. */
export async function resolveJourneyActor(): Promise<string | null> {
  const authConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  )
  if (authConfigured) {
    const supabase = await createClient()
    const { data: { user }, error } = await withJourneyDeadline(
      () => supabase.auth.getUser(),
      10_000,
    )
    if (!error && user) return user.id
  }
  if (
    process.env.NODE_ENV !== 'production' ||
    isJourneyPublicDemoEnabled()
  ) return null
  throw new JourneyAuthenticationError()
}

export async function withJourneyDeadline<T>(
  operation: () => Promise<T>,
  timeoutMs = JOURNEY_SERVER_DEADLINE_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new JourneyPersistenceUnavailableError(
            'Journey не ответил вовремя. Повторите попытку.',
          ))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function identityFromRequest(
  request: Request,
  fallback?: Partial<JourneyIdentity>,
): JourneyIdentity {
  const headerWorkspaceId = request.headers.get('x-journey-workspace-id') ?? undefined
  const headerAccessToken = request.headers.get('x-journey-access-token') ?? undefined
  if (fallback?.workspaceId && headerWorkspaceId && fallback.workspaceId !== headerWorkspaceId) {
    throw new JourneyAccessError('Workspace ID в заголовке и запросе не совпадает.')
  }
  if (fallback?.accessToken && headerAccessToken && fallback.accessToken !== headerAccessToken) {
    throw new JourneyAccessError('Workspace token в заголовке и запросе не совпадает.')
  }
  const cookieAccessToken = journeyDeviceCredentialFromRequest(request)
  const identity = journeyIdentitySchema.parse({
    workspaceId: headerWorkspaceId ?? fallback?.workspaceId,
    accessToken: headerAccessToken ?? fallback?.accessToken ?? cookieAccessToken,
  })
  if (!identity.accessToken) {
    throw new JourneyAccessError('Для рабочей области не передан credential.')
  }
  return identity
}

/** Inject the server-only cookie credential before strict request validation.
 * This keeps the device token out of client JavaScript while preserving the
 * legacy body/header contract for existing local workspaces. */
export function withJourneyRequestIdentity(
  request: Request,
  payload: unknown,
): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload
  const record = payload as Record<string, unknown>
  return {
    ...record,
    workspaceId: record.workspaceId ?? request.headers.get('x-journey-workspace-id') ?? undefined,
    accessToken:
      record.accessToken ??
      request.headers.get('x-journey-access-token') ??
      journeyDeviceCredentialFromRequest(request) ??
      undefined,
  }
}

export function journeyDeviceCredentialFromRequest(request: Request): string | undefined {
  return credentialCookieFromRequest(request, JOURNEY_DEVICE_COOKIE)
}

export function storeJourneyDeviceCredentialFromRequest(request: Request): string | undefined {
  return credentialCookieFromRequest(request, STORE_JOURNEY_DEVICE_COOKIE)
}

function credentialCookieFromRequest(
  request: Request,
  cookieName: string,
): string | undefined {
  const cookieHeader = request.headers.get('cookie')
  if (!cookieHeader) return undefined
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    if (part.slice(0, separator).trim() !== cookieName) continue
    const value = part.slice(separator + 1).trim()
    if (/^[A-Za-z0-9_-]{32,240}$/.test(value)) return value
  }
  return undefined
}

export function journeyErrorResponse(
  error: unknown,
  headers?: HeadersInit,
): NextResponse {
  if (error instanceof JourneyAuthenticationError) {
    return NextResponse.json(
      { error: { code: 'JOURNEY_AUTH_REQUIRED', message: error.message } },
      { status: 401, headers },
    )
  }
  if (error instanceof JourneyAccessError) {
    return NextResponse.json(
      { error: { code: 'JOURNEY_FORBIDDEN', message: error.message } },
      { status: 403, headers },
    )
  }
  if (error instanceof JourneyConflictError) {
    return NextResponse.json(
      {
        error: {
          code: 'JOURNEY_STATE_CONFLICT',
          message: error.message,
          currentRevision: error.currentRevision,
        },
      },
      { status: 409, headers },
    )
  }
  if (error instanceof JourneyPersistenceUnavailableError) {
    return NextResponse.json(
      { error: { code: 'JOURNEY_SYNC_UNAVAILABLE', message: error.message } },
      { status: 503, headers },
    )
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: 'INVALID_JOURNEY_REQUEST',
          message: 'Запрос не прошёл проверку безопасной схемой.',
          issues: error.issues.slice(0, 8).map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
        },
      },
      { status: 400, headers },
    )
  }
  console.error('[journey] unexpected route error', error)
  return NextResponse.json(
    { error: { code: 'JOURNEY_INTERNAL', message: 'Не удалось обработать запрос. Повторите позже.' } },
    { status: 500, headers },
  )
}
