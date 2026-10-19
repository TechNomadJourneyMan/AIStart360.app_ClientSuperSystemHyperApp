/**
 * lib/point-b/whatif-http.ts — what every client «Что если» route does first, in one place: the user from the
 * SESSION (never from the body), «от имени» (a read is allowed, a write is refused), the Pro gate of Point B
 * and the rate limit. Answers are `{ ok: false, error, code?, field? }` with a text for the user.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { gateFeature } from '@/lib/access/gate'
import { activeImpersonation } from '@/lib/impersonation/server'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { WhatIfInputError } from './model/whatif'
import { ModelInputError } from './model/types'
import { SavedStoreError } from './whatif-store'

export const fail = (error: string, status: number, extra: Record<string, unknown> = {}): NextResponse =>
  NextResponse.json({ ok: false, error, ...extra }, { status })

export const IMPERSONATION_TEXT = 'В режиме «от имени» сценарии «Что если» сохранять нельзя: их сохраняет и предлагает сам владелец.'
export const NO_COMPANY_TEXT = 'Сначала создайте компанию — «Что если» не к чему привязаться'

export interface WhatIfCaller {
  userId: string
  service: SupabaseClient
}

/**
 * 401 without a session · 403 when `write` and the session is «от имени» · 402 without Pro (staff are exempt) ·
 * 429 over `limit` requests in 10 minutes (`bucket` per user).
 */
export async function authorize(opts: { write: boolean; bucket?: string; max?: number }): Promise<{ ok: true; caller: WhatIfCaller } | { ok: false; response: NextResponse }> {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return { ok: false, response: NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 }) }
  if (opts.write && (await activeImpersonation(user.id))) return { ok: false, response: fail(IMPERSONATION_TEXT, 403, { code: 'impersonation' }) }
  const upgrade = await gateFeature(sb, user.id, 'point_b', { exemptStaff: true })
  if (upgrade) return { ok: false, response: upgrade }
  if (opts.bucket && (await isRateLimitedKey(user.id, opts.bucket, { max: opts.max ?? 30, windowMs: 10 * 60_000 }))) {
    return { ok: false, response: fail('Слишком много запросов подряд — подождите несколько минут', 429, { code: 'rate_limited' }) }
  }
  return { ok: true, caller: { userId: user.id, service: createServiceClient() } }
}

/** The answer for an error of the what-if domain; null for anything else (the caller answers 500). */
export function whatIfFailure(err: unknown): NextResponse | null {
  if (err instanceof WhatIfInputError) return fail(err.message, 400, { code: 'invalid_request', field: err.field })
  if (err instanceof ModelInputError) return fail(err.message, 400, { code: 'invalid_request' })
  if (err instanceof SavedStoreError && err.code === 'missing_table') {
    return fail('Сохранённые сценарии пока недоступны: раздел обновляется, попробуйте позже', 503, { code: 'unavailable' })
  }
  if (err instanceof SavedStoreError && err.code === 'limit') {
    return fail('Можно сохранить не больше 20 сценариев: удалите ненужные', 409, { code: 'limit' })
  }
  return null
}
