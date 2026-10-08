export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { createServiceClient } from '@/lib/supabase-service'
import { hasPermission } from '@/lib/admin/rbac'
import { maskEmail, maskPhone } from '@/lib/admin/mask'
import { isWizardVisibleKey } from '@/lib/survey/steps'
import { buildUserProfileSummary } from '@/lib/user-dashboard/summary'
import { guardClientAccess } from '@/lib/admin/client-scope'

// GET /api/giga-admin/surveys/:userId/preview — light data for the hover card
// in «Анкеты»: who, key business facts, fill per theme. Two queries only.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: NextRequest, { params }: { params: { userId: string } }) {
  const guard = await requireGiga(req, 'survey.view')
  if (guard.response) return guard.response
  const scopeDenied = await guardClientAccess(guard.actor, params.userId)
  if (scopeDenied) return scopeDenied
  if (!UUID_RE.test(params.userId)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })
  const sb = createServiceClient()
  const [profileRes, answersRes] = await Promise.all([
    sb.from('profiles').select('id, email, full_name, phone, status, role, organization, created_at').eq('id', params.userId).maybeSingle(),
    sb.from('survey_answers').select('question_key, answer, answered_at').eq('user_id', params.userId),
  ])
  if (!profileRes.data) return NextResponse.json({ ok: false, error: 'Пользователь не найден' }, { status: 404 })
  const answers: Record<string, unknown> = {}
  let first: string | null = null
  let last: string | null = null
  for (const r of answersRes.data ?? []) {
    if (!isWizardVisibleKey(String(r.question_key))) continue
    answers[r.question_key] = (r.answer as { value?: unknown } | null)?.value
    const at = r.answered_at ? String(r.answered_at) : null
    if (at && (!first || at < first)) first = at
    if (at && (!last || at > last)) last = at
  }
  const s = buildUserProfileSummary(answers)
  const sensitive = hasPermission(guard.actor.role, 'users.sensitive')
  const p = profileRes.data
  return NextResponse.json({
    ok: true,
    data: {
      id: p.id,
      name: p.full_name,
      email: sensitive ? p.email : maskEmail(p.email),
      phone: sensitive ? p.phone : maskPhone(p.phone),
      status: p.status,
      role: p.role,
      company: s.hero.company || p.organization,
      industry: s.hero.industry,
      employees: s.hero.employees,
      revenue: sensitive ? s.hero.revenue : '',
      goal12m: sensitive ? s.hero.goal12m : '',
      contact: sensitive ? s.hero.contact : '',
      percent: s.percent,
      startedSteps: s.startedSteps,
      totalSteps: s.totalSteps,
      answers: Object.keys(answers).length,
      startedAt: first,
      updatedAt: last,
      sections: s.sections.map((x) => ({ id: x.id, title: x.title, filled: x.filled, total: x.total })),
    },
  })
}
