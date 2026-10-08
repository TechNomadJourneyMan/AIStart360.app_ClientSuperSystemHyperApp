import { NextResponse, type NextRequest } from 'next/server'

/**
 * Проверка вызова cron: только заголовок `Authorization: Bearer ${CRON_SECRET}`
 * (так его присылает Vercel Cron). Секрет в query-строке НЕ принимается —
 * он оседает в логах прокси и истории браузера.
 *
 * Возвращает готовый ответ-ошибку или null, если вызов разрешён.
 */
export function rejectUnauthorizedCron(req: NextRequest | Request): NextResponse | null {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  return null
}
