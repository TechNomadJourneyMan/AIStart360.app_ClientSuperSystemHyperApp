/**
 * lib/validation/http — request bodies through Zod (R-149).
 *
 * A route reads its JSON body with `parseJsonBody(req, Schema)`; a body that
 * is not JSON, too large or not of the schema answers 400 in the common format
 * of lib/api-error.ts:
 *
 *   { ok: false, error: '<текст для человека>', code: 'invalid_body', field?: 'a.b' }
 *
 * `field` names the first wrong field (dotted path), so a form can show the
 * message next to it. Schemas use `.strict()` where the callers are known: an
 * unknown key (user_id, partner_id, status…) is refused, never written.
 */
import type { NextResponse } from 'next/server'
import type { ZodError, ZodIssue, ZodTypeAny, output } from 'zod'
import { apiError } from '@/lib/api-error'

export const INVALID_BODY = 'invalid_body'

/** 256 KB: far above any form of the portal, low enough not to parse junk. */
export const DEFAULT_MAX_BODY_BYTES = 256 * 1024

export type BodyResult<T> = { ok: true; data: T } | { ok: false; response: NextResponse }

function pathOf(issue: ZodIssue): string {
  return issue.path.map(String).join('.')
}

/** A Russian message and the field of one Zod issue. */
export function describeIssue(issue: ZodIssue): { message: string; field: string | null } {
  if (issue.code === 'unrecognized_keys') {
    const base = pathOf(issue)
    const keys = issue.keys.map((k) => (base ? `${base}.${k}` : k))
    return { message: `Недопустимые поля: ${keys.join(', ')}`, field: keys[0] ?? null }
  }
  const field = pathOf(issue) || null
  const name = field ? `«${field}»` : 'запроса'
  switch (issue.code) {
    case 'invalid_type':
      return issue.received === 'undefined'
        ? { message: `Не заполнено поле ${name}`, field }
        : { message: `Поле ${name}: неверный тип значения`, field }
    case 'too_big':
      return issue.type === 'string'
        ? { message: `Поле ${name}: не длиннее ${issue.maximum} символов`, field }
        : issue.type === 'array'
          ? { message: `Поле ${name}: не больше ${issue.maximum} элементов`, field }
          : { message: `Поле ${name}: не больше ${issue.maximum}`, field }
    case 'too_small':
      return issue.type === 'string'
        ? { message: `Не заполнено поле ${name}`, field }
        : issue.type === 'array'
          ? { message: `Поле ${name}: нужно хотя бы ${issue.minimum}`, field }
          : { message: `Поле ${name}: не меньше ${issue.minimum}`, field }
    case 'invalid_enum_value':
      return { message: `Поле ${name}: недопустимое значение`, field }
    case 'custom':
      return { message: issue.message || `Некорректное значение поля ${name}`, field }
    default:
      return { message: `Некорректное значение поля ${name}`, field }
  }
}

/** 400 for a body that failed its schema (first issue; the rest are logged nowhere — they are the caller's). */
export function validationErrorResponse(error: ZodError, status = 400, extra?: Record<string, unknown>): NextResponse {
  const first = error.issues[0]
  const { message, field } = first ? describeIssue(first) : { message: 'Некорректный запрос', field: null }
  return apiError(message, status, { code: INVALID_BODY, ...(field ? { field } : {}), ...extra })
}

/** Validate an already-read value. */
export function parseBody<S extends ZodTypeAny>(raw: unknown, schema: S, status = 400): BodyResult<output<S>> {
  const parsed = schema.safeParse(raw)
  if (!parsed.success) return { ok: false, response: validationErrorResponse(parsed.error, status) }
  return { ok: true, data: parsed.data }
}

/** Read the request body as JSON with a size cap; null body → `undefined` is NOT accepted (400). */
export async function readJsonBody(
  req: Request,
  opts: { maxBytes?: number } = {},
): Promise<{ ok: true; value: unknown } | { ok: false; response: NextResponse }> {
  const max = opts.maxBytes ?? DEFAULT_MAX_BODY_BYTES
  const declared = Number(req.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > max) {
    return { ok: false, response: apiError('Слишком большой запрос', 413, { code: 'body_too_large' }) }
  }
  let text: string
  try {
    text = await req.text()
  } catch {
    return { ok: false, response: apiError('Некорректный запрос', 400, { code: INVALID_BODY }) }
  }
  if (text.length > max) {
    return { ok: false, response: apiError('Слишком большой запрос', 413, { code: 'body_too_large' }) }
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown }
  } catch {
    return { ok: false, response: apiError('Некорректный JSON в запросе', 400, { code: INVALID_BODY }) }
  }
}

/** Read + validate. `status` lets a route keep its historical status for a bad body (e.g. 422). */
export async function parseJsonBody<S extends ZodTypeAny>(
  req: Request,
  schema: S,
  opts: { maxBytes?: number; status?: number } = {},
): Promise<BodyResult<output<S>>> {
  const read = await readJsonBody(req, opts)
  if (!read.ok) return read
  return parseBody(read.value, schema, opts.status ?? 400)
}
