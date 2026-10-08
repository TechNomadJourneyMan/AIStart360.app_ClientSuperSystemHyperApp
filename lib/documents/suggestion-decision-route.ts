/**
 * Shared handler for POST /api/v1/onboarding/suggestions/[id]/{accept,reject}.
 */

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { acceptSuggestion, rejectSuggestion } from '@/lib/documents/survey-suggestions'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ERRORS: Record<string, { status: number; message: string }> = {
  not_found: { status: 404, message: 'Подсказка не найдена' },
  not_pending: { status: 409, message: 'Подсказка уже обработана' },
  already_answered: { status: 409, message: 'На этот вопрос уже есть ваш ответ — он сохранён без изменений' },
}

export async function decideSuggestion(id: string, action: 'accept' | 'reject'): Promise<NextResponse> {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  if (!UUID_RE.test(id)) return NextResponse.json({ ok: false, error: ERRORS.not_found.message }, { status: 404 })
  try {
    const svc = createServiceClient()
    const r = action === 'accept' ? await acceptSuggestion(svc, user.id, id) : await rejectSuggestion(svc, user.id, id)
    if (!r.ok) {
      const e = ERRORS[r.error]
      return NextResponse.json({ ok: false, error: e.message, code: r.error }, { status: e.status })
    }
    return NextResponse.json({ ok: true, data: { question_key: r.question_key, value: r.value } })
  } catch (err) {
    console.error(`[onboarding/suggestions] ${action} failed:`, err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'Не удалось сохранить решение' }, { status: 500 })
  }
}
