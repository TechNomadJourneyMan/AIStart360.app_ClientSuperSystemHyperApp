import { NextResponse } from 'next/server'

// POST /api/clients/:id/gri/calculate — ОТКЛЮЧЕНО.
// Раньше ставило Inngest-событие 'gri/calculate', обработчик которого намеренно
// бросает исключение (расчёт писал случайные числа — убрано по data-integrity).
// Эндпоинт возвращал 200 «queued», но расчёт никогда не выполнялся. Реальный GRI
// считается через /api/v1/gri/assessment. Отвечаем 410 Gone, чтобы не создавать
// ложное впечатление работы и не плодить падающие фоновые задачи.
export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error:
        'Этот способ расчёта GRI отключён. Используйте /api/v1/gri/assessment.',
    },
    { status: 410 },
  )
}
