export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { createServiceClient } from '@/lib/supabase-service'
import { buildAssistantContext } from '@/lib/assistant/context'
import { runValidation } from '@/lib/assistant/validators'

/**
 * GET /api/giga-admin/users/:id/quality — противоречия и пробелы в анкете.
 *
 * Зачем: диагностика по кривым данным даёт кривой результат, а увидеть это
 * можно было только вручную, сверяя ответы глазами. Проверки уже написаны для
 * ассистента клиента (lib/assistant/validators) — здесь мы просто смотрим тем
 * же взглядом, но со стороны сотрудника.
 *
 * LLM-слой намеренно выключен: сотруднику нужен быстрый и детерминированный
 * ответ, а не ожидание модели и счёт за токены на каждый просмотр карточки.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, ['survey.view', 'users.sensitive'])
  if (guard.response) return guard.response
  if (!UUID_RE.test(params.id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })

  try {
    const ctx = await buildAssistantContext(params.id, createServiceClient())
    const issues = await runValidation(ctx, { includeLlm: false })
    const counts = {
      error: issues.filter((i) => i.severity === 'error').length,
      warning: issues.filter((i) => i.severity === 'warning').length,
      info: issues.filter((i) => i.severity === 'info').length,
    }
    return NextResponse.json({ ok: true, data: { issues, counts } })
  } catch (e) {
    console.error('[giga-admin/users/quality]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ok: false, error: 'Не удалось проверить данные' }, { status: 500 })
  }
}
