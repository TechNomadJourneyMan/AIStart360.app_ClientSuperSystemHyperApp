export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { createServiceClient } from '@/lib/supabase-service'

// GET /api/giga-admin/users/:id/gri — every assessment with answers, plus the
// unfinished draft. Answers are business self-assessment data → sensitive.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, ['gri.view', 'users.sensitive'])
  if (guard.response) return guard.response
  if (!UUID_RE.test(params.id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })
  const sb = createServiceClient()
  const [assessments, draft] = await Promise.all([
    sb.from('gri_assessments')
      .select('id, gri_index, section_avgs, scores, completed_sections, onboarding, top_5_limits, action_plan_90d, is_current, created_at, updated_at')
      .eq('user_id', params.id)
      .order('created_at', { ascending: false })
      .limit(50),
    sb.from('gri_assessment_drafts').select('state, updated_at').eq('user_id', params.id).maybeSingle(),
  ])
  if (assessments.error) return NextResponse.json({ ok: false, error: 'Не удалось загрузить GRI' }, { status: 500 })
  return NextResponse.json({
    ok: true,
    data: {
      assessments: (assessments.data ?? []).map((a) => ({ ...a, gri_index: Number(a.gri_index) })),
      draft: draft.data ?? null,
    },
  })
}
