import { NextResponse } from 'next/server'

/**
 * API error hygiene (BE-09).
 *
 * Many route handlers do `error instanceof Error ? error.message : '...'` and
 * return the raw driver/library message to the client — which leaks internal
 * detail (DB hosts, stack hints, SQL). Use these helpers instead:
 *
 *   - `safeErrorMessage(err, fallback)` — real message in dev (so local
 *     debugging still works), generic fallback in production.
 *   - `apiError(message, status, extra)` — a `{ ok:false, error }` JSON response.
 *
 * NODE_ENV is read at call time so tests can exercise both branches.
 */
export function safeErrorMessage(err: unknown, fallback = 'Внутренняя ошибка сервера'): string {
  if (process.env.NODE_ENV !== 'production' && err instanceof Error && err.message) {
    return err.message
  }
  return fallback
}

export function apiError(
  message: string,
  status = 500,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status })
}
