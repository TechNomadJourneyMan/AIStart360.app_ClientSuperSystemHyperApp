export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase-server'
import { isWizardVisibleKey } from '@/lib/survey/steps'
import { buildUserProfileSummary } from '@/lib/user-dashboard/summary'
import UserHome, { type UserHomeData } from '@/components/user-dashboard/UserHome'
import { visibleSectionsFor } from '@/lib/platform/sections'
import { visiblePagesFor } from '@/lib/cms/server'

export const metadata = { title: 'Мой профиль — AIStart360' }

// User Assessment Dashboard — the page a client lands on after the survey:
// what they told us (survey), what we measured (GRI), where to go next.
// All reads go through the session client, so RLS scopes them to the caller.
export default async function ClientHomePage({ searchParams }: { searchParams?: { unavailable?: string } }) {
  const sb = createServerClient()
  const { data: auth } = await sb.auth.getUser()
  const user = auth?.user
  if (!user) redirect('/login?from=/client/home')

  const [profileRes, answersRes, diagnosticsRes, griRes, docsRes, sectionsRes, pages] = await Promise.all([
    sb.from('profiles').select('full_name, email, status, created_at').eq('id', user.id).maybeSingle(),
    sb.from('survey_answers').select('question_key, answer, answered_at').eq('user_id', user.id),
    sb.from('diagnostics').select('overall_score, health_index, stage, calculated_at').eq('user_id', user.id).eq('is_current', true).order('calculated_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('gri_assessments').select('gri_index, created_at').eq('user_id', user.id).eq('is_current', true).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('documents').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
    visibleSectionsFor(user.id),
    visiblePagesFor(user.id),
  ])

  const rows = (answersRes.data ?? []).filter((r) => isWizardVisibleKey(String(r.question_key)))
  const answers: Record<string, unknown> = {}
  let firstAnswerAt: string | null = null
  let lastAnswerAt: string | null = null
  for (const r of rows) {
    answers[r.question_key] = (r.answer as { value?: unknown } | null)?.value
    const at = r.answered_at ? String(r.answered_at) : null
    if (at && (!firstAnswerAt || at < firstAnswerAt)) firstAnswerAt = at
    if (at && (!lastAnswerAt || at > lastAnswerAt)) lastAnswerAt = at
  }

  const profile = profileRes.data
  const data: UserHomeData = {
    fullName: profile?.full_name ?? '',
    email: profile?.email ?? user.email ?? '',
    status: profile?.status ?? 'pending_approval',
    surveyStartedAt: firstAnswerAt,
    surveyUpdatedAt: lastAnswerAt,
    summary: buildUserProfileSummary(answers),
    diagnostics: diagnosticsRes.data
      ? {
          overallScore: diagnosticsRes.data.overall_score == null ? null : Number(diagnosticsRes.data.overall_score),
          stage: diagnosticsRes.data.stage ?? null,
          calculatedAt: diagnosticsRes.data.calculated_at ?? null,
        }
      : null,
    gri: griRes.data ? { index: Number(griRes.data.gri_index), assessedAt: griRes.data.created_at } : null,
    documentsCount: docsRes.count ?? 0,
    // Cards of «Что дальше» follow the sections configured in GIGA-CRM.
    sections: sectionsRes.sections
      .filter((x) => ['point_a', 'point_b', 'cjm', 'documents', 'content'].includes(x.key))
      .map((x) => ({ key: x.key, title: x.title, description: x.description, icon: x.icon, href: x.nav_href })),
    materials: sectionsRes.sections.some((x) => x.key === 'content')
      ? pages.filter((p) => p.show_in_nav).slice(0, 6).map((p) => ({ slug: p.slug, title: p.title, summary: p.summary, icon: p.icon }))
      : [],
    unavailableSection: typeof searchParams?.unavailable === 'string' ? searchParams.unavailable.slice(0, 40) : null,
  }

  return <UserHome data={data} />
}
