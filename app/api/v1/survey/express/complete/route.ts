// ============================================================
// POST /api/v1/survey/express/complete — «Готово» of the express flow
// (spec 2026-10-23 §7.2; PO §18.3 item 1). Body: { minutes? }.
// The owner only (session); writes SURVEY_EXPRESS_COMPLETED once and notifies
// the assigned expert (lib/survey/express-complete.ts). It never marks the
// questionnaire as submitted: QUESTIONNAIRE_COMPLETED, the waiting-room exit
// and the end of the bot reminders stay with the full questionnaire. The
// browser then asks POST /api/v1/diagnostics/recalculate for the primary Point A.
// ============================================================
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { trackEventOnce } from '@/lib/events/track'
import { notifyStaff } from '@/lib/notifications/staff'
import { completeExpress } from '@/lib/survey/express-complete'

export const dynamic = 'force-dynamic'

export async function POST(req: Request): Promise<NextResponse> {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  if (await isRateLimitedKey(user.id, 'survey-express-complete', { max: 10, windowMs: 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Слишком много запросов. Попробуйте через минуту.' }, { status: 429 })
  }
  const body = (await req.json().catch(() => ({}))) as { minutes?: unknown }
  const service = createServiceClient()
  const result = await completeExpress({
    readAnswers: async (userId) => {
      const { data, error } = await sb.from('survey_answers').select('question_key, answer').eq('user_id', userId)
      if (error) throw new Error(error.code ?? 'read failed')
      return (data ?? []) as Array<{ question_key: string; answer: unknown }>
    },
    companyOf: async (userId) => {
      const { data } = await sb.from('companies').select('id, name').eq('user_id', userId).maybeSingle()
      const c = data as { id?: unknown; name?: unknown } | null
      return c?.id ? { id: String(c.id), name: typeof c.name === 'string' ? c.name : null } : null
    },
    assigneeOf: async (userId) => {
      const { data } = await service.from('user_assignments').select('assignee_id').eq('user_id', userId).maybeSingle()
      return (data as { assignee_id?: string | null } | null)?.assignee_id ?? null
    },
    trackOnce: (e) => trackEventOnce(e),
    notifyStaff: (n) => notifyStaff(n),
  }, { userId: user.id, minutes: typeof body.minutes === 'number' ? body.minutes : null })
  return NextResponse.json({ ok: true, data: result })
}
