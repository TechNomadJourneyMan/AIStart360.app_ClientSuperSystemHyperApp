import { ZodError, type ZodType } from 'zod'
import { DomainError } from './errors'

export async function parseJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    throw new DomainError('INVALID_JSON', 'Некорректный JSON', 400)
  }
  try {
    return schema.parse(payload)
  } catch (error) {
    if (error instanceof ZodError) {
      throw new DomainError('VALIDATION_ERROR', 'Ошибка проверки данных', 422, {
        issues: error.issues,
      })
    }
    throw error
  }
}

export function requiredQuery(url: URL, key: string): string {
  const value = url.searchParams.get(key)?.trim()
  if (!value) throw new DomainError('QUERY_PARAMETER_REQUIRED', `Параметр ${key} обязателен`, 400)
  return value
}

export function idempotentResponse(
  result: { status: number; body: object; replayed: boolean },
): Response {
  return Response.json(
    { ...result.body, meta: { replayed: result.replayed } },
    {
      status: result.status,
      headers: result.replayed ? { 'Idempotency-Replayed': 'true' } : undefined,
    },
  )
}
