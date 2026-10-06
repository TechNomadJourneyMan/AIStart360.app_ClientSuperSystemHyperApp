/**
 * lib/admin/ai-providers-http.ts — shared plumbing for the GIGA routes under
 * /api/giga-admin/ai-providers/* (LLM providers, API keys, models, routes,
 * budgets, spend). The routes only authorize (requireGiga), read the body and
 * call lib/ai/providers/service.ts; this file turns the outcome into JSON.
 *
 * Secret hygiene: an API key arrives only in the body of «add key» / «rotate
 * key». Every error message that leaves these routes (and every server log
 * line written here) is scrubbed of the submitted secret, so even a driver
 * error that echoes query parameters cannot leak it.
 */
import { NextResponse, type NextRequest } from 'next/server'
import type { z } from 'zod'
import type { GigaActor } from '@/lib/admin/giga-actor'
import { ProviderServiceError, type ProviderActor } from '@/lib/ai/providers/service'
import { safeErrorMessage } from '@/lib/api-error'

/** The GIGA actor as the provider service's audit actor. */
export function toProviderActor(actor: GigaActor, req: NextRequest): ProviderActor {
  return { kind: 'staff', id: actor.id, label: actor.email, role: actor.role, req }
}

/** Replace every occurrence of the given secrets (and their trimmed form) with a mask. */
export function scrubSecrets(text: string, secrets: ReadonlyArray<string | null | undefined> = []): string {
  let out = text
  for (const raw of secrets) {
    for (const s of new Set([raw ?? '', (raw ?? '').trim()])) {
      if (s.length >= 4) out = out.split(s).join('[REDACTED]')
    }
  }
  return out
}

/**
 * Map a failure to a response: ProviderServiceError → its own status and
 * Russian message; an unavailable audit journal → 503 (the change was refused
 * before it happened); anything else → 500 with safeErrorMessage.
 */
export function providerErrorResponse(tag: string, err: unknown, secrets: ReadonlyArray<string | null | undefined> = []): NextResponse {
  if (err instanceof ProviderServiceError) {
    return NextResponse.json({ ok: false, error: scrubSecrets(err.message, secrets), code: err.code }, { status: err.status })
  }
  const raw = err instanceof Error ? err.message : String(err)
  if (/Audit log unavailable/i.test(raw)) {
    return NextResponse.json({
      ok: false,
      error: 'Журнал аудита недоступен — изменение не выполнено. Повторите позже.',
      code: 'AUDIT_UNAVAILABLE',
    }, { status: 503 })
  }
  console.error(`[${tag}]`, scrubSecrets(raw, secrets))
  const fallback = 'Не удалось выполнить действие. Попробуйте позже.'
  // A request that carried a key never echoes a raw driver message (it could
  // hold the ciphertext or query parameters), not even in development.
  const message = secrets.some((x) => x) ? fallback : safeErrorMessage(err, fallback)
  return NextResponse.json({ ok: false, error: scrubSecrets(message, secrets) }, { status: 500 })
}

export type BodyResult<T> = { ok: true; data: T } | { ok: false; response: NextResponse }

/** Read a JSON body and validate it; 400 with a Russian message otherwise. */
export async function readBody<S extends z.ZodTypeAny>(req: NextRequest, schema: S): Promise<BodyResult<z.output<S>>> {
  const body: unknown = await req.json().catch(() => undefined)
  if (body === undefined) {
    return { ok: false, response: NextResponse.json({ ok: false, error: 'Ожидается JSON в теле запроса', code: 'VALIDATION' }, { status: 400 }) }
  }
  const r = schema.safeParse(body)
  if (!r.success) {
    const i = r.error.issues[0]
    const msg = i ? `${i.path.join('.') || 'значение'}: ${i.message}` : 'неверные данные'
    return { ok: false, response: NextResponse.json({ ok: false, error: msg, code: 'VALIDATION' }, { status: 400 }) }
  }
  return { ok: true, data: r.data }
}
