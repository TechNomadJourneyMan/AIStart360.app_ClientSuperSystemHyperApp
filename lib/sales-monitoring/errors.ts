export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'DomainError'
  }
}

export function errorResponse(error: unknown): Response {
  if (error instanceof DomainError) {
    return Response.json(
      { error: error.code, message: error.message, details: error.details },
      { status: error.status },
    )
  }

  console.error('[sales-monitoring]', error)
  return Response.json(
    { error: 'INTERNAL_ERROR', message: 'Внутренняя ошибка сервера' },
    { status: 500 },
  )
}
